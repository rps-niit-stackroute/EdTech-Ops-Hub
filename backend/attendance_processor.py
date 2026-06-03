"""Attendance tracker append processor — parses Teams export and appends to 3 sheets,
preserving exact format/colors/merges by copying existing cell styles."""
import io
import csv
import re
from copy import copy

import openpyxl
from openpyxl.utils import get_column_letter

from excel_utils import (
    parse_duration_to_minutes, normalize_teams_name, copy_cell_style,
    rename_with_new_date,
)


# ----------------------------- Teams export parsing -----------------------------
def _decode_bytes(b):
    for enc in ("utf-16", "utf-8-sig", "utf-8", "latin-1"):
        try:
            return b.decode(enc)
        except Exception:
            continue
    return b.decode("utf-8", errors="ignore")


def _rows_from_csv(b):
    text = _decode_bytes(b)
    delim = "\t" if text.count("\t") >= text.count(",") else ","
    rows = []
    for line in text.splitlines():
        rows.append(next(csv.reader([line], delimiter=delim)))
    return rows


def _rows_from_xlsx(b):
    wb = openpyxl.load_workbook(io.BytesIO(b), data_only=True)
    ws = wb.active
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append(["" if c is None else str(c) for c in r])
    return rows


def parse_teams_export(file_bytes, filename):
    """Returns dict: {participants:[{raw,name,minutes,attentiveness,first_join,last_leave}],
                      session_minutes: float, attentiveness_available: bool}"""
    if filename.lower().endswith((".xlsx", ".xls")):
        rows = _rows_from_xlsx(file_bytes)
    else:
        rows = _rows_from_csv(file_bytes)

    # Meeting duration from summary
    session_minutes = 0.0
    for r in rows:
        for i, c in enumerate(r):
            if c and re.search(r'meeting\s+duration', str(c), re.I):
                # value in same row, next non-empty cell
                for j in range(i + 1, len(r)):
                    if str(r[j]).strip():
                        session_minutes = parse_duration_to_minutes(r[j])
                        break
                if session_minutes:
                    break
        if session_minutes:
            break

    # Find participants header row
    header_idx = None
    col_map = {}
    for idx, r in enumerate(rows):
        low = [str(c).strip().lower() for c in r]
        if "name" in low and any("duration" in x for x in low):
            header_idx = idx
            for ci, val in enumerate(low):
                if val == "name" and "name" not in col_map:
                    col_map["name"] = ci
                elif "first join" in val:
                    col_map["first_join"] = ci
                elif "last leave" in val:
                    col_map["last_leave"] = ci
                elif "duration" in val:
                    col_map["duration"] = ci
                elif "attentiveness" in val or "attention" in val:
                    col_map["attentiveness"] = ci
            break

    participants = []
    if header_idx is not None and "name" in col_map and "duration" in col_map:
        for r in rows[header_idx + 1:]:
            if not r:
                continue
            # stop at next section marker like "3. In-Meeting Activities"
            first_cell = str(r[0]).strip() if r else ""
            if re.match(r'^\d+\.\s+\w', first_cell):
                break
            name_raw = str(r[col_map["name"]]).strip() if col_map["name"] < len(r) else ""
            if not name_raw:
                continue
            # skip a repeated header row ("Name" / "Join Time" ...)
            if name_raw.strip().lower() == "name":
                continue
            dur = r[col_map["duration"]] if col_map["duration"] < len(r) else ""
            minutes = parse_duration_to_minutes(dur)
            participants.append({
                "raw": name_raw,
                "name": normalize_teams_name(name_raw),
                "minutes": minutes,
                "first_join": str(r[col_map["first_join"]]).strip() if col_map.get("first_join", 99) < len(r) else "",
                "last_leave": str(r[col_map["last_leave"]]).strip() if col_map.get("last_leave", 99) < len(r) else "",
            })

    if not session_minutes:
        session_minutes = max((p["minutes"] for p in participants), default=0.0)

    # Highest duration among all participants -> denominator for attentiveness
    max_minutes = max((p["minutes"] for p in participants), default=0.0)

    return {
        "participants": participants,
        "session_minutes": session_minutes or 0.0,
        "max_minutes": max_minutes or 0.0,
        "session_date": _detect_session_date(rows, participants),
    }


def _detect_session_date(rows, participants):
    """Detect the session date (ISO) from Teams summary 'Meeting Start Time' or a participant join."""
    candidates = []
    for r in rows:
        for i, c in enumerate(r):
            if c and re.search(r'meeting\s+start', str(c), re.I):
                for j in range(i + 1, len(r)):
                    if str(r[j]).strip():
                        candidates.append(str(r[j]))
                        break
    if participants:
        candidates.append(participants[0].get("first_join", ""))
    for cand in candidates:
        iso = _parse_teams_datetime(cand)
        if iso:
            return iso
    return None


def _parse_teams_datetime(s):
    if not s:
        return None
    first = str(s).split(",")[0].strip()
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            from datetime import datetime as _dt
            return _dt.strptime(first, fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    return None


# ----------------------------- Name matching -----------------------------
def _norm(s):
    return re.sub(r'\s+', ' ', str(s or "").lower()).strip()


def match_participants(enrolled_names, participants, session_minutes, threshold_pct, max_minutes=0.0):
    """Returns (results_by_enrolled, unmatched_participants).
    results_by_enrolled[name] = {present, attentiveness, matched, uncertain}"""
    results = {}
    used = set()
    p_norm = [(_norm(p["name"]), p) for p in participants]

    for enrolled in enrolled_names:
        en = _norm(enrolled)
        en_parts = en.split()
        match = None
        uncertain = False
        # exact
        for i, (pn, p) in enumerate(p_norm):
            if i in used:
                continue
            if pn == en:
                match, used_i = p, i
                break
        else:
            used_i = None
        # partial: all enrolled tokens present in participant name
        if match is None:
            for i, (pn, p) in enumerate(p_norm):
                if i in used:
                    continue
                pset = set(pn.split())
                if en_parts and all(t in pset for t in en_parts):
                    match, used_i = p, i
                    break
        # first name only (uncertain)
        if match is None and en_parts:
            for i, (pn, p) in enumerate(p_norm):
                if i in used:
                    continue
                if en_parts[0] and en_parts[0] in pn.split():
                    match, used_i = p, i
                    uncertain = True
                    break
        if match is not None:
            used.add(used_i)
            present = (match["minutes"] / session_minutes) >= (threshold_pct / 100.0) if session_minutes else False
            # Attentiveness = participant duration / highest duration among all participants
            attentiveness = round(match["minutes"] / max_minutes, 4) if max_minutes else 0.0
            results[enrolled] = {
                "present": present,
                "attentiveness": attentiveness,
                "matched": True,
                "uncertain": uncertain,
                "minutes": match["minutes"],
            }
        else:
            # Absent participant -> 0 (matches existing sheet's absent format)
            results[enrolled] = {"present": False, "attentiveness": 0.0,
                                 "matched": False, "uncertain": False, "minutes": 0}

    unmatched = [p["raw"] for i, (pn, p) in enumerate(p_norm) if i not in used]
    return results, unmatched


# ----------------------------- Sheet helpers -----------------------------
def _find_name_column(ws, max_scan_rows=3):
    for r in range(1, max_scan_rows + 1):
        for c in range(1, min(ws.max_column, 10) + 1):
            v = ws.cell(row=r, column=c).value
            if v and "name" in str(v).lower():
                return c
    return 2  # default column B


def _enrolled_rows(ws, name_col, start_row):
    rows = []
    for r in range(start_row, ws.max_row + 1):
        v = ws.cell(row=r, column=name_col).value
        if v and str(v).strip():
            rows.append((r, str(v).strip()))
    return rows


# ----------------------------- Append logic -----------------------------
def _append_consolidated(ws, header_label, results):
    name_col = _find_name_column(ws)
    rows = _enrolled_rows(ws, name_col, 3)
    max_col = ws.max_column
    new_att = max_col + 1
    new_atten = max_col + 2

    # find template attendance/attentiveness group from row 2
    tmpl_att = tmpl_atten = None
    for c in range(max_col, 1, -1):
        val = ws.cell(row=2, column=c).value
        if val and str(val).strip().lower() == "attentiveness":
            tmpl_atten = c
            tmpl_att = c - 1
            break
    if tmpl_att is None:
        for c in range(max_col, 1, -1):
            if str(ws.cell(row=2, column=c).value or "").strip().lower() == "attendance":
                tmpl_att = c
                tmpl_atten = c
                break

    # Row 1 merged header across both new columns
    ws.merge_cells(start_row=1, start_column=new_att, end_row=1, end_column=new_atten)
    h = ws.cell(row=1, column=new_att, value=header_label)
    if tmpl_att:
        copy_cell_style(ws.cell(row=1, column=tmpl_att), h)
    # Row 2 sub headers
    a2 = ws.cell(row=2, column=new_att, value="Attendance")
    b2 = ws.cell(row=2, column=new_atten, value="Attentiveness")
    if tmpl_att:
        copy_cell_style(ws.cell(row=2, column=tmpl_att), a2)
    if tmpl_atten:
        copy_cell_style(ws.cell(row=2, column=tmpl_atten), b2)

    for r, name in rows:
        res = results.get(name, {})
        ac = ws.cell(row=r, column=new_att, value="Yes" if res.get("present") else "No")
        att = res.get("attentiveness", 0.0) or 0.0
        bc = ws.cell(row=r, column=new_atten, value=att)
        if tmpl_att:
            copy_cell_style(ws.cell(row=r, column=tmpl_att), ac)
        if tmpl_atten:
            copy_cell_style(ws.cell(row=r, column=tmpl_atten), bc)
        bc.number_format = "0.00%"  # display computed attentiveness as a percentage


def _append_overall(ws, header_label, results):
    name_col = _find_name_column(ws)
    rows = _enrolled_rows(ws, name_col, 3)
    max_col = ws.max_column
    new_col = max_col + 1

    tmpl_col = None
    for c in range(max_col, 1, -1):
        if str(ws.cell(row=2, column=c).value or "").strip().lower() == "attendance":
            tmpl_col = c
            break

    h = ws.cell(row=1, column=new_col, value=header_label)
    sub = ws.cell(row=2, column=new_col, value="Attendance")
    if tmpl_col:
        copy_cell_style(ws.cell(row=1, column=tmpl_col), h)
        copy_cell_style(ws.cell(row=2, column=tmpl_col), sub)

    for r, name in rows:
        res = results.get(name, {})
        cell = ws.cell(row=r, column=new_col, value="Yes" if res.get("present") else "No")
        if tmpl_col:
            copy_cell_style(ws.cell(row=r, column=tmpl_col), cell)


def _append_login(ws, header_label, participants):
    # groups: 4 cols + 1 gap, starting col 1 -> starts at 1,6,11,...
    # find rightmost group by scanning row 3 for 'Name'
    starts = []
    for c in range(1, ws.max_column + 1):
        v = ws.cell(row=3, column=c).value
        if v and str(v).strip().lower() == "name":
            starts.append(c)
    if starts:
        last_start = starts[-1]
        new_start = last_start + 5
        tmpl_start = last_start
    else:
        new_start = 1
        tmpl_start = None
    cols = [new_start, new_start + 1, new_start + 2, new_start + 3]

    # row1-2 merged header
    ws.merge_cells(start_row=1, start_column=cols[0], end_row=2, end_column=cols[3])
    h = ws.cell(row=1, column=cols[0], value=header_label)
    if tmpl_start:
        copy_cell_style(ws.cell(row=1, column=tmpl_start), h)
    # row3 subheaders
    labels = ["Name", "First Join", "Last Leave", "In-Meeting Duration"]
    for i, lab in enumerate(labels):
        cell = ws.cell(row=3, column=cols[i], value=lab)
        if tmpl_start:
            copy_cell_style(ws.cell(row=3, column=tmpl_start + i), cell)
    # data rows from row 4 — copy style from the template group's first data row (row 4)
    for di, p in enumerate(participants):
        r = 4 + di
        vals = [p["raw"], p.get("first_join", ""), p.get("last_leave", ""), _fmt_minutes(p["minutes"])]
        for i, val in enumerate(vals):
            cell = ws.cell(row=r, column=cols[i], value=val)
            if tmpl_start:
                copy_cell_style(ws.cell(row=4, column=tmpl_start + i), cell)


def _fmt_minutes(mins):
    h = int(mins // 60)
    m = int(mins % 60)
    s = int(round((mins - int(mins)) * 60))
    parts = []
    if h:
        parts.append(f"{h}h")
    if m:
        parts.append(f"{m}m")
    if s:
        parts.append(f"{s}s")
    return " ".join(parts) if parts else "0m"


def process_attendance(tracker_bytes, tracker_name, teams_bytes, teams_name,
                       session_name, session_date_iso, threshold_pct):
    """Main entry. Returns (output_bytes, output_filename, info_dict)."""
    parsed = parse_teams_export(teams_bytes, teams_name)
    participants = parsed["participants"]
    session_minutes = parsed["session_minutes"]
    max_minutes = parsed["max_minutes"]

    wb = openpyxl.load_workbook(io.BytesIO(tracker_bytes))
    sheetnames = wb.sheetnames

    # locate sheets by best match
    def find_sheet(keys, default_idx):
        for sn in sheetnames:
            low = sn.lower()
            if any(k in low for k in keys):
                return wb[sn]
        return wb[sheetnames[default_idx]] if default_idx < len(sheetnames) else None

    ws_consol = find_sheet(["consolidated", "report"], 0)
    ws_overall = find_sheet(["overall", "attendance %"], 1)
    ws_login = find_sheet(["login"], 2)

    enrolled = []
    if ws_consol is not None:
        nc = _find_name_column(ws_consol)
        enrolled = [n for _, n in _enrolled_rows(ws_consol, nc, 3)]

    results, unmatched = match_participants(enrolled, participants, session_minutes, threshold_pct, max_minutes)

    # date label like (22-05-26)
    from datetime import datetime
    dt = datetime.strptime(session_date_iso, "%Y-%m-%d")
    date_label = dt.strftime("%d-%m-%y")
    header_label = f"{session_name} ({date_label})"

    if ws_consol is not None:
        _append_consolidated(ws_consol, header_label, results)
    if ws_overall is not None:
        _append_overall(ws_overall, header_label, results)
    if ws_login is not None:
        _append_login(ws_login, header_label, participants)

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)

    out_name = rename_with_new_date(tracker_name, session_date_iso)

    matched_atts = [r["attentiveness"] for r in results.values() if r.get("matched")]
    present_count = sum(1 for r in results.values() if r.get("present"))
    avg_attendance_pct = round((present_count / len(enrolled)) * 100, 1) if enrolled else 0.0
    avg_attentiveness_pct = round((sum(matched_atts) / len(matched_atts)) * 100, 1) if matched_atts else 0.0

    info = {
        "unmatched": unmatched,
        "uncertain": [n for n, r in results.items() if r.get("uncertain")],
        "total_participants": len(participants),
        "matched": sum(1 for r in results.values() if r.get("matched")),
        "present": present_count,
        "enrolled": len(enrolled),
        "session_minutes": round(session_minutes, 1),
        "avg_attendance_pct": avg_attendance_pct,
        "avg_attentiveness_pct": avg_attentiveness_pct,
        "output_filename": out_name,
    }
    return out.getvalue(), out_name, info
