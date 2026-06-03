"""Parse program schedule Excel -> list of session dicts."""
import io
import re
import openpyxl

from excel_utils import parse_date_flexible, parse_time_to_24h


def _cell_str(c):
    return "" if c is None else str(c).strip()


def parse_schedule(file_bytes, filename):
    """Return list of {date, start_time, end_time, topic, mentor_name}.
    Handles separate Start/End columns or a combined time-range column, multi-mentor cells."""
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    # Find header row (search first 10 rows for one containing 'date')
    header_idx = None
    for i, r in enumerate(rows[:15]):
        low = [_cell_str(c).lower() for c in r]
        if any("date" == x or "date" in x for x in low) and any(
            ("time" in x or "start" in x or "session" in x or "topic" in x or "module" in x) for x in low
        ):
            header_idx = i
            break
    if header_idx is None:
        header_idx = 0

    header = [_cell_str(c).lower() for c in rows[header_idx]]

    def find_col(*keys, exact=False):
        for ci, h in enumerate(header):
            for k in keys:
                if (h == k) if exact else (k in h):
                    return ci
        return None

    col_date = find_col("date")
    col_start = find_col("start")
    col_end = find_col("end")
    col_time = find_col("session time", "time")
    col_topic = find_col("topic", "session name", "course module", "module", "session/topic")
    col_client = find_col("client", "customer")
    # mentor columns (could be multiple: Mentor 1/2/3)
    mentor_cols = [ci for ci, h in enumerate(header) if "mentor" in h or "trainer" in h or "faculty" in h]

    sessions = []
    for r in rows[header_idx + 1:]:
        if r is None:
            continue
        date_iso = parse_date_flexible(r[col_date]) if col_date is not None and col_date < len(r) else None
        if not date_iso:
            continue

        start = end = None
        if col_start is not None and col_start < len(r):
            start = parse_time_to_24h(r[col_start])
        if col_end is not None and col_end < len(r):
            end = parse_time_to_24h(r[col_end])
        if (start is None or end is None) and col_time is not None and col_time < len(r):
            rng = _cell_str(r[col_time])
            parts = re.split(r'\s*(?:-|to|–|—)\s*', rng, maxsplit=1)
            if len(parts) == 2:
                start = start or parse_time_to_24h(parts[0])
                end = end or parse_time_to_24h(parts[1])
        if not start:
            start = "00:00"
        if not end:
            end = start

        topic = _cell_str(r[col_topic]) if col_topic is not None and col_topic < len(r) else ""

        mentors = []
        for mc in mentor_cols:
            if mc < len(r):
                val = _cell_str(r[mc])
                if val:
                    for part in re.split(r'[,/]', val):
                        p = part.strip()
                        if p:
                            mentors.append(p)
        if not mentors:
            mentors = [""]

        for mentor in mentors:
            sessions.append({
                "date": date_iso,
                "start_time": start,
                "end_time": end,
                "topic": topic,
                "mentor_name": mentor,
            })
    return sessions
