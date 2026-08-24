"""Parse program schedule Excel -> list of session dicts."""
import io
import re
import openpyxl

from excel_utils import parse_date_flexible, parse_time_to_24h, parse_duration_to_minutes


def _cell_str(c):
    return "" if c is None else str(c).strip()


def _find_header_row(rows):
    """Search the first 15 rows for one containing 'date' plus a schedule-related column."""
    for i, r in enumerate(rows[:15]):
        low = [_cell_str(c).lower() for c in r]
        if any("date" == x or "date" in x for x in low) and any(
            ("time" in x or "start" in x or "session" in x or "topic" in x or "module" in x) for x in low
        ):
            return i
    return 0


def _find_col(header, *keys):
    for ci, h in enumerate(header):
        for k in keys:
            if k in h:
                return ci
    return None


def _find_columns(header):
    return {
        "date": _find_col(header, "date"),
        "start": _find_col(header, "start"),
        "end": _find_col(header, "end"),
        "time": _find_col(header, "session time", "time"),
        "topic": _find_col(header, "topic", "session name", "course module", "module", "session/topic"),
        "duration": _find_col(header, "duration", "hours", "session duration",
                              "duration (mins)", "duration (hrs)", "hrs"),
        "mentor_cols": [ci for ci, h in enumerate(header)
                       if "mentor" in h or "trainer" in h or "faculty" in h],
    }


def _cell(r, col):
    return r[col] if col is not None and col < len(r) else None


def _parse_start_end(r, cols):
    start = end = None
    start_raw = _cell(r, cols["start"])
    if start_raw is not None:
        start = parse_time_to_24h(start_raw)
    end_raw = _cell(r, cols["end"])
    if end_raw is not None:
        end = parse_time_to_24h(end_raw)
    if start is None or end is None:
        rng = _cell_str(_cell(r, cols["time"]))
        # Alternation kept free of surrounding \s* (avoids a backtracking-prone shape) —
        # parse_time_to_24h already strips whitespace from each side itself.
        parts = re.split(r'-|to|–|—', rng, maxsplit=1)
        if len(parts) == 2:
            start = start or parse_time_to_24h(parts[0])
            end = end or parse_time_to_24h(parts[1])
    return start or "00:00", end or start or "00:00"


def _parse_duration(r, cols):
    raw_dur = _cell(r, cols["duration"])
    if raw_dur is None or not str(raw_dur).strip():
        return None
    if isinstance(raw_dur, (int, float)):
        return round(float(raw_dur), 2)
    raw_s = str(raw_dur).strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", raw_s):
        return round(float(raw_s), 2)
    return round(parse_duration_to_minutes(raw_s) / 60.0, 2)


def _parse_mentors(r, cols):
    mentors = []
    for mc in cols["mentor_cols"]:
        if mc < len(r):
            val = _cell_str(r[mc])
            if val:
                mentors.extend(p.strip() for p in re.split(r'[,/]', val) if p.strip())
    return mentors or [""]


def parse_schedule(file_bytes):
    """Return list of {date, start_time, end_time, topic, mentor_name}.
    Handles separate Start/End columns or a combined time-range column, multi-mentor cells."""
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    header_idx = _find_header_row(rows)
    header = [_cell_str(c).lower() for c in rows[header_idx]]
    cols = _find_columns(header)

    sessions = []
    for r in rows[header_idx + 1:]:
        if r is None:
            continue
        date_iso = parse_date_flexible(_cell(r, cols["date"]))
        if not date_iso:
            continue

        start, end = _parse_start_end(r, cols)
        topic = _cell_str(_cell(r, cols["topic"]))
        duration = _parse_duration(r, cols)

        for mentor in _parse_mentors(r, cols):
            sessions.append({
                "date": date_iso,
                "start_time": start,
                "end_time": end,
                "duration": duration,
                "topic": topic,
                "mentor_name": mentor,
            })
    return sessions
