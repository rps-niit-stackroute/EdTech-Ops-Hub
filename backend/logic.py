"""Business logic: program health scores, mentor availability, attendance records."""
import uuid
from datetime import datetime, date, timezone

from db import db
from excel_utils import time_to_minutes

attendance_records_col = db["attendance_records"]
sow_records_col = db["sow_records"]


def _today():
    return date.today()


def health_color(score):
    if score >= 75:
        return "green"
    if score >= 50:
        return "amber"
    return "red"


async def compute_health(program_id, sessions=None):
    """Equal-weighted (33.33% each): attendance %, attentiveness %, completion rate."""
    if sessions is None:
        sessions = []
        async for s in db["sessions"].find({"program_id": program_id}, {"_id": 0}):
            sessions.append(s)

    # attendance & attentiveness from saved attendance records
    recs = []
    async for r in attendance_records_col.find({"program_id": program_id}, {"_id": 0}):
        recs.append(r)
    if recs:
        attendance = round(sum(r["attendance_pct"] for r in recs) / len(recs), 1)
        attentiveness = round(sum(r["attentiveness_pct"] for r in recs) / len(recs), 1)
    else:
        attendance = 0.0
        attentiveness = 0.0

    # session completion rate: conducted (date <= today) / total scheduled
    total = len(sessions)
    today = _today()
    conducted = 0
    for s in sessions:
        try:
            d = datetime.strptime(s["date"], "%Y-%m-%d").date()
            if d <= today:
                conducted += 1
        except Exception:
            pass
    completion = round((conducted / total) * 100, 1) if total else 0.0

    score = round((attendance + attentiveness + completion) / 3.0, 1)
    return {
        "score": score,
        "color": health_color(score),
        "attendance": attendance,
        "attentiveness": attentiveness,
        "completion": completion,
        "conducted": conducted,
        "total_sessions": total,
        "has_attendance_data": bool(recs),
    }


def _overlap(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end


async def check_availability(mentor_name, date_str, start_time, end_time, exclude_session_id=None):
    """Returns {available: bool, conflicts: [{program_name, start, end, topic, session_id}]}."""
    if not mentor_name or not date_str:
        return {"available": True, "conflicts": []}
    a_start = time_to_minutes(start_time)
    a_end = time_to_minutes(end_time)
    if a_start is None or a_end is None:
        return {"available": True, "conflicts": []}

    conflicts = []
    async for s in db["sessions"].find(
        {"mentor_name": {"$regex": f"^{_escape(mentor_name.strip())}$", "$options": "i"},
         "date": date_str}, {"_id": 0}
    ):
        if exclude_session_id and s["id"] == exclude_session_id:
            continue
        b_start = time_to_minutes(s["start_time"])
        b_end = time_to_minutes(s["end_time"])
        if b_start is None or b_end is None:
            continue
        if _overlap(a_start, a_end, b_start, b_end):
            prog = await db["programs"].find_one({"id": s["program_id"]}, {"_id": 0})
            conflicts.append({
                "program_name": prog.get("name", "Unknown") if prog else "Unknown",
                "start": s["start_time"], "end": s["end_time"],
                "topic": s.get("topic", ""), "session_id": s["id"],
            })
    return {"available": len(conflicts) == 0, "conflicts": conflicts}


def _escape(s):
    import re
    return re.escape(s)


async def save_attendance_record(program_id, session_name, date_str, info, attendance_pct,
                                 attentiveness_pct, filename):
    doc = {
        "id": str(uuid.uuid4()),
        "program_id": program_id,
        "session_name": session_name,
        "date": date_str,
        "attendance_pct": round(attendance_pct, 1),
        "attentiveness_pct": round(attentiveness_pct, 1),
        "present": info.get("present", 0),
        "enrolled": info.get("enrolled", 0),
        "filename": filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await attendance_records_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}
