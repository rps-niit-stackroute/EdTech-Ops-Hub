"""Business logic: program health scores, mentor availability, attendance records."""
import uuid
from datetime import datetime, date, timezone, timedelta

from db import db
from excel_utils import time_to_minutes

attendance_records_col = db["attendance_records"]
sow_records_col = db["sow_records"]
sow_snapshots_col = db["sow_snapshots"]
sow_history_col = db["sow_history"]
schedule_changes_col = db["schedule_changes"]
provision_mentors_col = db["provision_mentors"]
provision_charges_col = db["provision_charges"]
mentor_unavailability_col = db["mentor_unavailability"]

# Starting Provision roster — billed separately from the regular Mentor SOW.
# Seeded once; admins can rename (to match real session mentor names) or
# add/remove from here on via the Provision UI.
DEFAULT_PROVISION_MENTORS = [
    "Ashutosh", "RNP", "Harish", "Swaminathan", "Gagandeep", "Nitin", "Sandeep R Diddi",
]


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
        attendance = round(sum(r["attendance_pct"] for r in recs) / len(recs))
        attentiveness = round(sum(r["attentiveness_pct"] for r in recs) / len(recs))
    else:
        attendance = 0
        attentiveness = 0

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
    completion = round((conducted / total) * 100) if total else 0

    score = round((attendance + attentiveness + completion) / 3.0)
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


async def _conflict_for_session(s, a_start, a_end, exclude_session_id):
    """The conflict dict for one candidate session, or None if it doesn't actually conflict."""
    if exclude_session_id and s["id"] == exclude_session_id:
        return None
    b_start = time_to_minutes(s["start_time"])
    b_end = time_to_minutes(s["end_time"])
    if b_start is None or b_end is None or not _overlap(a_start, a_end, b_start, b_end):
        return None
    prog = await db["programs"].find_one({"id": s["program_id"]}, {"_id": 0})
    return {
        "kind": "session",
        "program_name": prog.get("name", "Unknown") if prog else "Unknown",
        "start": s["start_time"], "end": s["end_time"],
        "topic": s.get("topic", ""), "session_id": s["id"],
    }


def _mentor_name_query(name):
    """Case-insensitive exact-match query fragment for a mentor_name field."""
    return {"$regex": f"^{_escape(name.strip())}$", "$options": "i"}


async def _unavailability_conflict(mentor_name, date_str):
    """The active unavailability period covering this date, or None. Whole-day —
    unlike a session conflict, this doesn't depend on the requested time window."""
    doc = await mentor_unavailability_col.find_one(
        {"mentor_name": _mentor_name_query(mentor_name),
         "start_date": {"$lte": date_str}, "end_date": {"$gte": date_str}},
        {"_id": 0},
    )
    if not doc:
        return None
    return {
        "kind": "unavailable",
        "reason": doc.get("reason") or "Marked unavailable",
        "start_date": doc["start_date"],
        "end_date": doc["end_date"],
        "unavailability_id": doc["id"],
    }


async def check_availability(mentor_name, date_str, start_time, end_time, exclude_session_id=None):
    """Returns {available: bool, conflicts: [...]}. Each conflict is either a session
    double-booking ({kind:"session", program_name, start, end, topic, session_id}) or
    the mentor being marked unavailable that day ({kind:"unavailable", reason,
    start_date, end_date, unavailability_id})."""
    if not mentor_name or not date_str:
        return {"available": True, "conflicts": []}

    conflicts = []
    unavailable = await _unavailability_conflict(mentor_name, date_str)
    if unavailable:
        conflicts.append(unavailable)

    a_start = time_to_minutes(start_time)
    a_end = time_to_minutes(end_time)
    if a_start is not None and a_end is not None:
        async for s in db["sessions"].find(
            {"mentor_name": _mentor_name_query(mentor_name), "date": date_str}, {"_id": 0}
        ):
            conflict = await _conflict_for_session(s, a_start, a_end, exclude_session_id)
            if conflict:
                conflicts.append(conflict)
    return {"available": len(conflicts) == 0, "conflicts": conflicts}


def _escape(s):
    import re
    return re.escape(s)


async def list_mentor_unavailability(mentor_name=None, upcoming_only=False):
    query = {}
    if mentor_name:
        query["mentor_name"] = _mentor_name_query(mentor_name)
    if upcoming_only:
        query["end_date"] = {"$gte": _today()}
    out = []
    async for d in mentor_unavailability_col.find(query, {"_id": 0}).sort("start_date", 1):
        out.append(d)
    return out


async def add_mentor_unavailability(mentor_name, start_date, end_date, reason, created_by):
    doc = {
        "id": str(uuid.uuid4()), "mentor_name": mentor_name.strip(),
        "start_date": start_date, "end_date": end_date,
        "reason": (reason or "").strip(), "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await mentor_unavailability_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def delete_mentor_unavailability(period_id):
    r = await mentor_unavailability_col.delete_one({"id": period_id})
    return r.deleted_count > 0


async def diff_sow_changes(month_label, year, grouped):
    """Compare freshly computed SOW rows against the last-downloaded baseline for the
    same program+mentor+month. Read-only — does not touch the stored baseline.
    Surfaces schedule drift (added/removed/rescheduled sessions) since the SOW was
    last actually generated, so a team member doesn't have to remember the schedule
    changed after the fact."""
    changes = []
    seen_keys = set()
    for grp in grouped:
        mentor = grp["mentor"]
        for row in grp["rows"]:
            seen_keys.add((row["program_id"], mentor))
            baseline = await sow_snapshots_col.find_one(
                {"program_id": row["program_id"], "mentor": mentor,
                 "month_label": month_label, "year": year}, {"_id": 0})
            if not baseline:
                continue
            sessions_changed = baseline["sessions_conducted"] != row["sessions_conducted"]
            hours_changed = abs(baseline["total_hours"] - row["total_hours"]) > 0.01
            if sessions_changed or hours_changed:
                changes.append({
                    "program_id": row["program_id"], "program_name": row["program_name"],
                    "project_code": row["project_code"], "mentor": mentor,
                    "prev_sessions": baseline["sessions_conducted"], "prev_hours": baseline["total_hours"],
                    "new_sessions": row["sessions_conducted"], "new_hours": row["total_hours"],
                    "prev_dates": baseline.get("dates", ""), "new_dates": row["dates"],
                    "last_generated_at": baseline.get("generated_at"), "removed": False,
                })

    # combos that had a baseline for this month but no longer appear at all
    # (schedule cleared/moved — still worth flagging as a change)
    async for baseline in sow_snapshots_col.find({"month_label": month_label, "year": year}, {"_id": 0}):
        key = (baseline["program_id"], baseline["mentor"])
        if key in seen_keys or baseline["sessions_conducted"] == 0:
            continue
        changes.append({
            "program_id": baseline["program_id"], "program_name": baseline["program_name"],
            "project_code": baseline.get("project_code", ""), "mentor": baseline["mentor"],
            "prev_sessions": baseline["sessions_conducted"], "prev_hours": baseline["total_hours"],
            "new_sessions": 0, "new_hours": 0.0,
            "prev_dates": baseline.get("dates", ""), "new_dates": "",
            "last_generated_at": baseline.get("generated_at"), "removed": True,
        })
    return changes


async def record_sow_snapshot(month_label, year, grouped, generated_by):
    """Persist current SOW numbers as the new baseline. Called when the SOW is
    actually downloaded (the artifact that gets billed/shared), not on preview."""
    now = datetime.now(timezone.utc).isoformat()
    for grp in grouped:
        mentor = grp["mentor"]
        for row in grp["rows"]:
            key = {"program_id": row["program_id"], "mentor": mentor,
                   "month_label": month_label, "year": year}
            await sow_snapshots_col.update_one(
                key,
                {"$set": {**key,
                          "program_name": row["program_name"], "project_code": row["project_code"],
                          "sessions_conducted": row["sessions_conducted"], "total_hours": row["total_hours"],
                          "dates": row["dates"], "generated_at": now, "generated_by": generated_by}},
                upsert=True,
            )


async def record_sow_history(month, month_label, year, mentors, programs, grand, filename, downloaded_by):
    """One entry per actual SOW download (the billed artifact) — not previews.
    Powers the SOW History tab so a team member can see what's already gone out
    and re-download a past month without re-entering the filters."""
    doc = {
        "id": str(uuid.uuid4()), "month": month, "month_label": month_label, "year": year,
        "mentors": mentors, "programs": programs,
        "total_sessions": grand["sessions"], "total_hours": grand["hours"],
        "filename": filename, "downloaded_by": downloaded_by,
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
    }
    await sow_history_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def list_sow_history(limit=100):
    out = []
    async for d in sow_history_col.find({}, {"_id": 0}).sort("downloaded_at", -1).limit(limit):
        out.append(d)
    return out


async def record_schedule_change(program_id, program_name, session_id, topic,
                                 change_type, before, after, changed_by):
    """Log a date/time/duration edit or removal so it can be surfaced as a
    time-limited reminder — team members forget a schedule change happened,
    and the mentor SOW for that program can go stale silently otherwise."""
    doc = {
        "id": str(uuid.uuid4()),
        "program_id": program_id,
        "program_name": program_name,
        "session_id": session_id,
        "topic": topic,
        "change_type": change_type,  # "rescheduled" | "removed"
        "before": before,
        "after": after,
        "changed_by": changed_by,
        "changed_at": datetime.now(timezone.utc).isoformat(),
    }
    await schedule_changes_col.insert_one(doc)


async def recent_schedule_changes(days=7):
    """Changes older than the window just stop being returned — no cleanup job needed."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    out = []
    async for d in schedule_changes_col.find({"changed_at": {"$gte": cutoff}}, {"_id": 0}).sort("changed_at", -1):
        out.append(d)
    return out


async def seed_provision_mentors_if_empty():
    if await provision_mentors_col.count_documents({}) > 0:
        return
    now = datetime.now(timezone.utc).isoformat()
    for name in DEFAULT_PROVISION_MENTORS:
        await provision_mentors_col.insert_one({
            "id": str(uuid.uuid4()), "name": name, "cost_per_hour": 0.0, "created_at": now,
        })


async def list_provision_mentors():
    out = []
    async for m in provision_mentors_col.find({}, {"_id": 0}).sort("name", 1):
        out.append(m)
    return out


async def add_provision_mentor(name, cost_per_hour):
    doc = {
        "id": str(uuid.uuid4()), "name": name.strip(), "cost_per_hour": float(cost_per_hour),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await provision_mentors_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_provision_mentor(mentor_id, name=None, cost_per_hour=None):
    upd = {}
    if name is not None:
        upd["name"] = name.strip()
    if cost_per_hour is not None:
        upd["cost_per_hour"] = float(cost_per_hour)
    if not upd:
        return True
    r = await provision_mentors_col.update_one({"id": mentor_id}, {"$set": upd})
    return r.matched_count > 0


async def delete_provision_mentor(mentor_id):
    r = await provision_mentors_col.delete_one({"id": mentor_id})
    return r.deleted_count > 0


async def list_provision_charges(month_label, year):
    out = []
    async for c in provision_charges_col.find(
        {"month_label": month_label, "year": year}, {"_id": 0}
    ).sort("created_at", 1):
        out.append(c)
    return out


async def add_provision_charge(month_label, year, trainer, description, total_cost, created_by):
    doc = {
        "id": str(uuid.uuid4()), "month_label": month_label, "year": year,
        "trainer": trainer.strip(), "description": description.strip(),
        "total_cost": float(total_cost), "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await provision_charges_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def delete_provision_charge(charge_id):
    r = await provision_charges_col.delete_one({"id": charge_id})
    return r.deleted_count > 0


async def save_attendance_record(program_id, session_name, date_str, info, attendance_pct,
                                 attentiveness_pct, filename):
    doc = {
        "id": str(uuid.uuid4()),
        "program_id": program_id,
        "session_name": session_name,
        "date": date_str,
        "attendance_pct": round(attendance_pct),
        "attentiveness_pct": round(attentiveness_pct),
        "present": info.get("present", 0),
        "enrolled": info.get("enrolled", 0),
        "filename": filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await attendance_records_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}
