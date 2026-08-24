import json
import logging
import re
from datetime import datetime, date, timedelta
from typing import Annotated, List, Optional
from urllib.parse import quote

from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, Request, Response, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import io

from db import programs_col, sessions_col, mentors_col, seed_if_empty, new_id, now_iso
from excel_utils import time_to_minutes
from attendance_processor import process_attendance, process_attendance_batch, parse_teams_export
from schedule_parser import parse_schedule
from sow_export import build_sow_excel, build_provision_excel
import auth
import audit as audit_mod
import logic
import backup as backup_mod

# Interactive docs/schema hand an attacker a full map of the API surface for free —
# off by default, opt in for local debugging via ENABLE_API_DOCS=true.
_docs_enabled = os.environ.get("ENABLE_API_DOCS", "false").strip().lower() == "true"
app = FastAPI(
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)
api = APIRouter(prefix="/api")
logger = logging.getLogger("opshub")
logging.basicConfig(level=logging.INFO)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]

_last_backup = {"meta": None}


# --------------------------- Auth models ---------------------------
class LoginIn(BaseModel):
    username: str
    password: str


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str


class UserIn(BaseModel):
    username: str
    password: str
    name: str = ""
    role: str = "team_member"
    shared_program_ids: List[str] = []


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    shared_program_ids: Optional[List[str]] = None


# --------------------------- Models ---------------------------
class ProgramIn(BaseModel):
    name: str
    client: str
    project_code: str
    team_member: str
    mentors: List[str] = []
    status: str = "active"


class ProgramStatusIn(BaseModel):
    status: str


class SessionIn(BaseModel):
    program_id: Optional[str] = None
    date: str
    start_time: str
    end_time: str
    duration: Optional[float] = None
    topic: Optional[str] = ""
    mentor_name: str


class SessionUpdate(BaseModel):
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    duration: Optional[float] = None
    topic: Optional[str] = None
    mentor_name: Optional[str] = None


class MentorIn(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    notes: str = ""


class MentorUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class MentorUnavailabilityIn(BaseModel):
    mentor_name: str
    start_date: str
    end_date: str
    reason: str = ""


class ProvisionMentorIn(BaseModel):
    name: str
    cost_per_hour: float = 0.0


class ProvisionMentorUpdate(BaseModel):
    name: Optional[str] = None
    cost_per_hour: Optional[float] = None


class ProvisionChargeIn(BaseModel):
    month: str
    year: int
    trainer: str
    description: str
    total_cost: float


# --------------------------- Auth dependency aliases ---------------------------
# Annotated form (FastAPI's recommended style): declared once here so every
# route just names the alias instead of repeating Depends(...) at each site.
CurrentUser = Annotated[dict, Depends(auth.current_user_required)]
AdminUser = Annotated[dict, Depends(auth.require_role("admin"))]

# Common documented error responses, composed per-route to match whichever
# HTTPExceptions that route can actually raise.
_R400 = {400: {"description": "Invalid request"}}
_R401 = {401: {"description": "Not authenticated"}}
_R403 = {403: {"description": "Insufficient permissions"}}
_R404 = {404: {"description": "Not found"}}
_R409 = {409: {"description": "Conflict"}}
_R429 = {429: {"description": "Too many attempts"}}

# Pre-merged combos (rather than spreading these inline in each decorator) so the
# route's declared status codes are a single static reference, not a runtime-built
# dict — routes/tests that check documented status codes can follow the reference.
_R403_404 = {**_R404, **_R403}
_R400_404 = {**_R400, **_R404}
_R400_403_404 = {**_R400, **_R404, **_R403}
_R403_404_409 = {**_R404, **_R403, **_R409}
_R400_403_404_409 = {**_R400, **_R404, **_R403, **_R409}
_R401_429 = {**_R429, **_R401}
_R401_403_429 = {**_R429, **_R401, **_R403}

PROGRAM_NOT_FOUND = "Program not found"
SESSION_NOT_FOUND = "Session not found"
MENTOR_NOT_FOUND = "Mentor not found"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DATE_FMT_DDMMMYYYY = "%d %b %Y"


# --------------------------- Helpers ---------------------------
def session_hours(s):
    """Billable/scheduled hours for one session. The Start/End Time on the schedule
    is authoritative whenever it's usable — a stored `duration` field (which only
    ever comes from a schedule Excel's Duration/Hours column, never a deliberate
    manual override — there's no UI for that) is a fallback for the rare case where
    a session has no valid start/end time at all, not a value that overrides a real
    clock-time span."""
    st = time_to_minutes(s.get("start_time"))
    en = time_to_minutes(s.get("end_time"))
    if st is not None and en is not None and en > st:
        return round((en - st) / 60.0, 2)
    dur = s.get("duration")
    if dur is not None:
        try:
            return round(float(dur), 2)
        except Exception:
            pass
    return 0.0


def overlaps(a, b):
    return a["_s"] < b["_e"] and b["_s"] < a["_e"]


def conflict_message(mentor_name, conflict):
    """Human-readable 409 message for a check_availability conflict — either an
    existing double-booked session or the mentor being marked unavailable."""
    if conflict["kind"] == "unavailable":
        return (f"Mentor {mentor_name} is marked unavailable from {conflict['start_date']} "
                f"to {conflict['end_date']} ({conflict['reason']}). Please choose a different mentor.")
    return (f"Mentor {mentor_name} is already assigned to {conflict['program_name']} "
            f"from {conflict['start']} to {conflict['end']} on this date. "
            f"Please choose a different mentor or time.")


async def clean_sessions(query=None):
    out = []
    async for s in sessions_col.find(query or {}, {"_id": 0}):
        out.append(s)
    return out


async def programs_map():
    m = {}
    async for p in programs_col.find({}, {"_id": 0}):
        m[p["id"]] = p
    return m


def _clash_pair(a, b, pmap, dt):
    if not overlaps(a, b):
        return None
    pa = pmap.get(a["program_id"], {})
    pb = pmap.get(b["program_id"], {})
    return {
        "mentor": a["mentor_name"],
        "date": dt,
        "program_a": pa.get("name", "Unknown"),
        "program_b": pb.get("name", "Unknown"),
        "time_a": f"{a['start_time']} - {a['end_time']}",
        "time_b": f"{b['start_time']} - {b['end_time']}",
        "session_a": a["id"],
        "session_b": b["id"],
    }


def _clashes_in_group(group, pmap, dt):
    found = []
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            clash = _clash_pair(group[i], group[j], pmap, dt)
            if clash:
                found.append(clash)
    return found


async def compute_clashes():
    sessions = await clean_sessions()
    pmap = await programs_map()
    for s in sessions:
        s["_s"] = time_to_minutes(s["start_time"]) or 0
        s["_e"] = time_to_minutes(s["end_time"]) or 0
    by_key = {}
    for s in sessions:
        by_key.setdefault((s["mentor_name"].strip().lower(), s["date"]), []).append(s)
    clashes = []
    for (mentor, dt), group in by_key.items():
        if not mentor:
            continue
        clashes.extend(_clashes_in_group(group, pmap, dt))
    return clashes


# --------------------------- Dashboard ---------------------------
def _week_session_stats(sessions, today):
    """(sessions_this_week, mentor names, per-mentor session counts, hours this month)."""
    start_week = today - timedelta(days=today.weekday())
    end_week = start_week + timedelta(days=6)
    sessions_this_week = 0
    mentors = set()
    mentor_counts = {}
    hours_this_month = 0.0
    for s in sessions:
        mname = (s.get("mentor_name") or "").strip()
        if mname:
            mentors.add(mname)
            mentor_counts[mname] = mentor_counts.get(mname, 0) + 1
        try:
            d = datetime.strptime(s["date"], "%Y-%m-%d").date()
        except Exception:
            continue
        if start_week <= d <= end_week:
            sessions_this_week += 1
        if d.year == today.year and d.month == today.month:
            hours_this_month += session_hours(s)
    return sessions_this_week, mentors, mentor_counts, hours_this_month, start_week


async def _program_health_summary(sessions):
    """(per-program summary rows, health color distribution, average health score)."""
    summary = []
    async for p in programs_col.find({"status": {"$ne": "completed"}}, {"_id": 0}).sort("created_at", -1):
        sess = [s for s in sessions if s["program_id"] == p["id"]]
        summary.append({
            "id": p["id"], "name": p["name"], "client": p["client"],
            "project_code": p["project_code"], "team_member": p["team_member"],
            "session_count": len(sess),
            "health": await logic.compute_health(p["id"], sess),
        })
    health_distribution = {"green": 0, "amber": 0, "red": 0}
    for p in summary:
        health_distribution[p["health"]["color"]] = health_distribution.get(p["health"]["color"], 0) + 1
    avg_health_score = round(sum(p["health"]["score"] for p in summary) / len(summary), 1) if summary else 0.0
    return summary, health_distribution, avg_health_score


def _sessions_trend(sessions, start_week):
    """Sessions per week for the trailing 8 weeks (including this one)."""
    trend = []
    for i in range(7, -1, -1):
        ws = start_week - timedelta(days=7 * i)
        we = ws + timedelta(days=6)
        count = 0
        for s in sessions:
            try:
                d = datetime.strptime(s["date"], "%Y-%m-%d").date()
            except Exception:
                continue
            if ws <= d <= we:
                count += 1
        trend.append({"label": ws.strftime("%d %b"), "sessions": count})
    return trend


async def _recent_attendance_averages():
    recent_attendance = []
    async for r in logic.attendance_records_col.find({}, {"_id": 0}).sort("created_at", -1).limit(30):
        recent_attendance.append(r)
    if not recent_attendance:
        return 0, 0
    avg_attendance_pct = round(sum(r["attendance_pct"] for r in recent_attendance) / len(recent_attendance))
    avg_attentiveness_pct = round(sum(r["attentiveness_pct"] for r in recent_attendance) / len(recent_attendance))
    return avg_attendance_pct, avg_attentiveness_pct


@api.get("/dashboard")
async def dashboard(user: CurrentUser):
    total_programs = await programs_col.count_documents({"status": {"$ne": "completed"}})
    sessions = await clean_sessions()
    today = date.today()
    sessions_this_week, mentors, mentor_counts, hours_this_month, start_week = _week_session_stats(sessions, today)
    clashes = await compute_clashes()

    summary, health_distribution, avg_health_score = await _program_health_summary(sessions)
    sessions_trend = _sessions_trend(sessions, start_week)

    # top mentors by total session count
    mentor_workload = sorted(
        ({"mentor": m, "sessions": c} for m, c in mentor_counts.items()),
        key=lambda x: -x["sessions"],
    )[:8]

    avg_attendance_pct, avg_attentiveness_pct = await _recent_attendance_averages()

    return {
        "total_programs": total_programs,
        "sessions_this_week": sessions_this_week,
        "active_mentors": len(mentors),
        "clashes_detected": len(clashes),
        "total_sessions": len(sessions),
        "programs": summary,
        "health_distribution": health_distribution,
        "avg_health_score": avg_health_score,
        "sessions_trend": sessions_trend,
        "mentor_workload": mentor_workload,
        "hours_this_month": round(hours_this_month, 1),
        "avg_attendance_pct": avg_attendance_pct,
        "avg_attentiveness_pct": avg_attentiveness_pct,
    }


# --------------------------- Programs ---------------------------
def _assert_program_access(user, program):
    """The programs list already hides other people's programs from a team_member —
    but hiding something from a list view isn't access control if the same record
    is still fully readable/editable by ID. Enforce the same restriction here."""
    if user["role"] == "team_member" and program.get("created_by") != user["id"]:
        raise HTTPException(403, "You don't have access to this program")


async def serialize_program(p, with_health=True):
    sess = await clean_sessions({"program_id": p["id"]})
    sess_mentors = {s["mentor_name"].strip() for s in sess if s.get("mentor_name")}
    mentors = list(dict.fromkeys(list(p.get("mentors", [])) + sorted(sess_mentors)))
    out = {**p, "session_count": len(sess), "mentors": mentors}
    if with_health:
        out["health"] = await logic.compute_health(p["id"], sess)
    return out


@api.get("/programs")
async def list_programs(request: Request):
    user = await auth.current_user_required(request)
    out = []
    async for p in programs_col.find({}, {"_id": 0}).sort("created_at", -1):
        # team_member sees only programs they created (when logged in)
        if user and user["role"] == "team_member" and p.get("created_by") != user["id"]:
            continue
        out.append(await serialize_program(p))
    return out


@api.post("/programs")
async def create_program(body: ProgramIn, request: Request):
    user = await auth.current_user_required(request)
    doc = {"id": new_id(), "created_at": now_iso(), "created_by": user["id"] if user else None,
           **body.model_dump()}
    await programs_col.insert_one(doc)
    await audit_mod.log_action(user, "Program created", f"{body.name} ({body.project_code})")
    return await serialize_program({k: v for k, v in doc.items() if k != "_id"})


@api.get("/programs/{program_id}", responses=_R403_404)
async def get_program(program_id: str, user: CurrentUser):
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, p)
    sess = await clean_sessions({"program_id": program_id})
    sess.sort(key=lambda s: (s["date"], s["start_time"]))
    base = await serialize_program(p)
    return {**base, "sessions": sess}


@api.get("/programs/{program_id}/health", responses=_R403_404)
async def program_health(program_id: str, user: CurrentUser):
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, p)
    return await logic.compute_health(program_id)


@api.put("/programs/{program_id}", responses=_R403_404)
async def update_program(program_id: str, body: ProgramIn, request: Request):
    user = await auth.current_user_required(request)
    existing = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, existing)
    r = await programs_col.update_one({"id": program_id}, {"$set": body.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    await audit_mod.log_action(user, "Program edited", f"{body.name} ({body.project_code})")
    return await serialize_program(p)


@api.delete("/programs/{program_id}", responses=_R403_404)
async def delete_program(program_id: str, request: Request):
    user = await auth.current_user_required(request)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, p)
    r = await programs_col.delete_one({"id": program_id})
    if r.deleted_count == 0:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    await sessions_col.delete_many({"program_id": program_id})
    await audit_mod.log_action(user, "Program deleted", p.get("name", program_id) if p else program_id)
    return {"ok": True}


@api.patch("/programs/{program_id}/status", responses=_R400_403_404)
async def update_program_status(program_id: str, body: ProgramStatusIn, request: Request):
    user = await auth.current_user_required(request)
    if body.status not in ("active", "completed"):
        raise HTTPException(400, "Invalid status")
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, p)
    await programs_col.update_one({"id": program_id}, {"$set": {"status": body.status}})
    await audit_mod.log_action(user, "Program status changed", f"{p.get('name', program_id)} → {body.status}")
    return {"ok": True}


@api.post("/programs/{program_id}/schedule", responses=_R400_403_404)
async def upload_schedule(program_id: str, request: Request, file: Annotated[UploadFile, File(...)]):
    """Parse schedule, check mentor availability, and RETURN clean vs conflicting rows
    (nothing is committed yet — the UI resolves conflicts then calls /sessions/bulk)."""
    user = await auth.current_user_required(request)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, p)
    content = await file.read()
    try:
        parsed = parse_schedule(content)
    except Exception as e:
        raise HTTPException(400, f"Could not parse schedule: {e}")

    clean, conflicts = [], []
    for s in parsed:
        mentor = s["mentor_name"] or (p.get("mentors") or [""])[0]
        row = {"date": s["date"], "start_time": s["start_time"], "end_time": s["end_time"],
               "duration": s.get("duration"), "topic": s["topic"], "mentor_name": mentor}
        avail = await logic.check_availability(mentor, s["date"], s["start_time"], s["end_time"])
        if avail["available"]:
            clean.append(row)
        else:
            conflicts.append({"session": row, "conflicts": avail["conflicts"]})
    await audit_mod.log_action(user, "Schedule Excel uploaded",
                               f"file={file.filename}, program={p.get('name')}, "
                               f"clean={len(clean)}, conflicts={len(conflicts)}")
    return {"clean": clean, "conflicts": conflicts}


@api.post("/programs/{program_id}/schedule/replace", responses=_R400_403_404)
async def replace_schedule(program_id: str, request: Request, file: Annotated[UploadFile, File(...)]):
    """For a program with a lot of schedule changes, re-uploading a fresh Excel is
    faster than editing sessions one by one — this clears the program's existing
    sessions first (each logged as a schedule change, same as a manual delete) so
    the new file's rows are checked for conflicts against every OTHER program's
    sessions, not against the very slots they're about to replace. Nothing from
    the new file is committed yet — same clean/conflicts contract as
    upload_schedule, so the frontend reuses the same resolver + /sessions/bulk
    commit step. The program's own name/client/project code/team/mentors are
    untouched; only its sessions are replaced."""
    user = await auth.current_user_required(request)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, p)
    content = await file.read()
    try:
        parsed = parse_schedule(content)
    except Exception as e:
        raise HTTPException(400, f"Could not parse schedule: {e}")

    existing = await clean_sessions({"program_id": program_id})
    for s in existing:
        await logic.record_schedule_change(
            program_id, p.get("name", "Unknown"), s["id"], s.get("topic", ""), "removed",
            {f: s.get(f) for f in ("date", "start_time", "end_time", "duration")}, None,
            user.get("name") if user else "Unknown")
    if existing:
        await sessions_col.delete_many({"program_id": program_id})

    clean, conflicts = [], []
    for s in parsed:
        mentor = s["mentor_name"] or (p.get("mentors") or [""])[0]
        row = {"date": s["date"], "start_time": s["start_time"], "end_time": s["end_time"],
               "duration": s.get("duration"), "topic": s["topic"], "mentor_name": mentor}
        avail = await logic.check_availability(mentor, s["date"], s["start_time"], s["end_time"])
        if avail["available"]:
            clean.append(row)
        else:
            conflicts.append({"session": row, "conflicts": avail["conflicts"]})
    await audit_mod.log_action(
        user, "Schedule Excel re-uploaded (replaced existing sessions)",
        f"file={file.filename}, program={p.get('name')}, "
        f"removed={len(existing)}, clean={len(clean)}, conflicts={len(conflicts)}")
    return {"clean": clean, "conflicts": conflicts, "removed_count": len(existing)}


@api.post("/programs/{program_id}/sessions/bulk", responses=_R403_404)
async def bulk_sessions(program_id: str, request: Request, payload: Annotated[dict, Body(...)]):
    """Commit a list of (already-resolved) sessions; re-checks availability per row."""
    user = await auth.current_user_required(request)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, p)
    inserted, skipped = 0, []
    for s in payload.get("sessions", []):
        mentor = s.get("mentor_name") or (p.get("mentors") or [""])[0]
        avail = await logic.check_availability(mentor, s["date"], s["start_time"], s["end_time"])
        if not avail["available"]:
            skipped.append({"session": s, "conflicts": avail["conflicts"]})
            continue
        doc = {"id": new_id(), "program_id": program_id,
               "date": s["date"], "start_time": s["start_time"],
               "end_time": s["end_time"], "topic": s.get("topic", ""),
               "mentor_name": mentor}
        if s.get("duration") is not None:
            doc["duration"] = s.get("duration")
        await sessions_col.insert_one(doc)
        inserted += 1
    await audit_mod.log_action(user, "Schedule committed",
                               f"program={p.get('name')}, inserted={inserted}, skipped={len(skipped)}")
    return {"inserted": inserted, "skipped": skipped}


@api.post("/availability/check")
async def availability_check(user: CurrentUser, payload: Annotated[dict, Body(...)]):
    return await logic.check_availability(
        payload.get("mentor_name", ""), payload.get("date", ""),
        payload.get("start_time", ""), payload.get("end_time", ""),
        payload.get("exclude_session_id"),
    )


# --------------------------- Sessions ---------------------------
@api.post("/sessions", responses=_R400_403_404_409)
async def create_session(body: SessionIn, request: Request):
    if not body.program_id:
        raise HTTPException(400, "program_id required")
    user = await auth.current_user_required(request)
    owner_prog = await programs_col.find_one({"id": body.program_id}, {"_id": 0})
    if not owner_prog:
        raise HTTPException(404, PROGRAM_NOT_FOUND)
    _assert_program_access(user, owner_prog)
    avail = await logic.check_availability(body.mentor_name, body.date, body.start_time, body.end_time)
    if not avail["available"]:
        raise HTTPException(409, conflict_message(body.mentor_name, avail["conflicts"][0]))
    doc = {"id": new_id(), **body.model_dump()}
    await sessions_col.insert_one(doc)
    await audit_mod.log_action(user, "Session added", f"{body.topic} · {body.date} · {body.mentor_name}")
    return {k: v for k, v in doc.items() if k != "_id"}


_SCHEDULE_FIELDS = ("date", "start_time", "end_time", "duration")


@api.put("/sessions/{session_id}", responses=_R403_404_409)
async def update_session(session_id: str, body: SessionUpdate, request: Request):
    user = await auth.current_user_required(request)
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    existing = await sessions_col.find_one({"id": session_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, SESSION_NOT_FOUND)
    owner_prog = await programs_col.find_one({"id": existing.get("program_id")}, {"_id": 0})
    if owner_prog:
        _assert_program_access(user, owner_prog)
    merged = {**existing, **upd}
    avail = await logic.check_availability(merged["mentor_name"], merged["date"],
                                           merged["start_time"], merged["end_time"],
                                           exclude_session_id=session_id)
    if not avail["available"]:
        raise HTTPException(409, conflict_message(merged["mentor_name"], avail["conflicts"][0]))
    rescheduled = any(existing.get(f) != merged.get(f) for f in _SCHEDULE_FIELDS)
    await sessions_col.update_one({"id": session_id}, {"$set": upd})
    s = await sessions_col.find_one({"id": session_id}, {"_id": 0})
    if rescheduled:
        p = await programs_col.find_one({"id": existing.get("program_id")}, {"_id": 0})
        await logic.record_schedule_change(
            existing.get("program_id"), p.get("name", "Unknown") if p else "Unknown",
            session_id, s.get("topic", ""), "rescheduled",
            {f: existing.get(f) for f in _SCHEDULE_FIELDS}, {f: merged.get(f) for f in _SCHEDULE_FIELDS},
            user.get("name") if user else "Unknown")
    await audit_mod.log_action(user, "Session edited", f"{s.get('topic')} · {s.get('date')}")
    return s


@api.delete("/sessions/{session_id}", responses=_R403_404)
async def delete_session(session_id: str, request: Request):
    user = await auth.current_user_required(request)
    s = await sessions_col.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, SESSION_NOT_FOUND)
    p = await programs_col.find_one({"id": s.get("program_id")}, {"_id": 0})
    if p:
        _assert_program_access(user, p)
    r = await sessions_col.delete_one({"id": session_id})
    if r.deleted_count == 0:
        raise HTTPException(404, SESSION_NOT_FOUND)
    await logic.record_schedule_change(
        s.get("program_id"), p.get("name", "Unknown") if p else "Unknown",
        session_id, s.get("topic", ""), "removed",
        {f: s.get(f) for f in _SCHEDULE_FIELDS}, None,
        user.get("name") if user else "Unknown")
    await audit_mod.log_action(user, "Session deleted", s.get("topic", session_id))
    return {"ok": True}


# --------------------------- Calendar / Clashes ---------------------------
def _sessions_for_month(sessions, pmap, month, year, clash_ids):
    out = []
    for s in sessions:
        try:
            d = datetime.strptime(s["date"], "%Y-%m-%d").date()
        except Exception:
            continue
        if d.month != month or d.year != year:
            continue
        p = pmap.get(s["program_id"], {})
        out.append({
            **s,
            "program_name": p.get("name", "Unknown"),
            "client": p.get("client", ""),
            "project_code": p.get("project_code", ""),
            "team_member": p.get("team_member", ""),
            "has_clash": s["id"] in clash_ids,
        })
    return out


def _merge_comentor_rows(out):
    """A schedule row with co-mentors becomes one session record per mentor —
    SOW billing and clash detection both need that per-mentor granularity —
    but on the calendar it's one occurrence and should show as one entry
    with every mentor's name, not a duplicate block per mentor."""
    merged, order = {}, []
    for s in out:
        key = (s["program_id"], s["date"], s["start_time"], s["end_time"], s.get("topic", ""))
        if key not in merged:
            merged[key] = {**s, "mentor_names": [s["mentor_name"]] if s.get("mentor_name") else []}
            order.append(key)
        else:
            m = merged[key]
            name = s.get("mentor_name")
            if name and name not in m["mentor_names"]:
                m["mentor_names"].append(name)
            m["has_clash"] = m["has_clash"] or s["has_clash"]
    result = []
    for key in order:
        m = merged.pop(key)
        m["mentor_name"] = ", ".join(m["mentor_names"])
        del m["mentor_names"]
        result.append(m)
    return result


@api.get("/calendar")
async def calendar(month: int, year: int, user: CurrentUser):
    pmap = await programs_map()
    sessions = await clean_sessions()
    clashes = await compute_clashes()
    clash_ids = set()
    for c in clashes:
        clash_ids.add(c["session_a"])
        clash_ids.add(c["session_b"])

    out = _sessions_for_month(sessions, pmap, month, year, clash_ids)
    result = _merge_comentor_rows(out)
    return {"sessions": result, "clashes": clashes}


@api.get("/clashes")
async def get_clashes(user: CurrentUser):
    return {"clashes": await compute_clashes()}


@api.get("/schedule-changes/recent")
async def schedule_changes_recent(user: CurrentUser):
    return {"changes": await logic.recent_schedule_changes(days=7)}


@api.get("/meta")
async def meta(user: CurrentUser):
    pmap = await programs_map()
    sessions = await clean_sessions()
    mentors = set()
    team_members = set()
    for p in pmap.values():
        mentors.update(p.get("mentors", []))
        if p.get("team_member"):
            team_members.add(p["team_member"])
    for s in sessions:
        if s.get("mentor_name"):
            mentors.add(s["mentor_name"].strip())
    async for d in mentors_col.find({}, {"_id": 0, "name": 1}):
        if d.get("name"):
            mentors.add(d["name"].strip())
    return {
        "mentors": sorted(m for m in mentors if m),
        "team_members": sorted(t for t in team_members if t),
        "programs": [{"id": p["id"], "name": p["name"]} for p in
                     sorted(pmap.values(), key=lambda x: x["name"])],
    }


# --------------------------- Mentors ---------------------------
def _aggregate_mentor_activity(pmap, sessions):
    """{mentor_name: {sessions, programs}} from program rosters + actual scheduled sessions."""
    agg = {}
    for p in pmap.values():
        for m in p.get("mentors", []):
            m = m.strip()
            if not m:
                continue
            agg.setdefault(m, {"sessions": 0, "programs": set()})
            agg[m]["programs"].add(p["name"])
    for s in sessions:
        m = (s.get("mentor_name") or "").strip()
        if not m:
            continue
        agg.setdefault(m, {"sessions": 0, "programs": set()})
        agg[m]["sessions"] += 1
        prog = pmap.get(s["program_id"])
        if prog:
            agg[m]["programs"].add(prog["name"])
    return agg


def _merge_mentor_directory(agg, directory):
    out = []
    for name in set(agg.keys()) | set(directory.keys()):
        d = directory.get(name, {})
        a = agg.get(name, {"sessions": 0, "programs": set()})
        out.append({
            "id": d.get("id"),
            "name": name,
            "email": d.get("email", ""),
            "phone": d.get("phone", ""),
            "notes": d.get("notes", ""),
            "status": d.get("status", "active"),
            "sessions_count": a["sessions"],
            "programs": sorted(a["programs"]),
            "source": "directory" if name in directory else "schedule",
            "created_at": d.get("created_at"),
        })
    out.sort(key=lambda x: x["name"].lower())
    return out


@api.get("/mentors")
async def list_mentors(user: CurrentUser):
    pmap = await programs_map()
    sessions = await clean_sessions()
    agg = _aggregate_mentor_activity(pmap, sessions)

    directory = {}
    async for d in mentors_col.find({}, {"_id": 0}):
        directory[d["name"]] = d

    return _merge_mentor_directory(agg, directory)


@api.post("/mentors", responses=_R400)
async def add_mentor(body: MentorIn, request: Request):
    user = await auth.current_user_required(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    existing = await mentors_col.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
    if existing:
        raise HTTPException(409, "A mentor with this name already exists in the directory")
    doc = {
        "id": new_id(), "name": name, "email": body.email.strip(), "phone": body.phone.strip(),
        "notes": body.notes.strip(), "status": "active",
        "created_at": now_iso(), "created_by": user["id"] if user else None,
    }
    await mentors_col.insert_one(doc)
    await audit_mod.log_action(user, "Mentor added", name)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/mentors/{mentor_id}", responses=_R400_404)
async def edit_mentor(mentor_id: str, body: MentorUpdate, request: Request):
    user = await auth.current_user_required(request)
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "name" in upd:
        upd["name"] = upd["name"].strip()
        if not upd["name"]:
            raise HTTPException(400, "Name cannot be empty")
    if not upd:
        raise HTTPException(400, "Nothing to update")
    r = await mentors_col.update_one({"id": mentor_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, MENTOR_NOT_FOUND)
    await audit_mod.log_action(user, "Mentor updated", mentor_id)
    return {"ok": True}


@api.delete("/mentors/{mentor_id}", responses=_R404)
async def remove_mentor(mentor_id: str, request: Request):
    user = await auth.current_user_required(request)
    r = await mentors_col.delete_one({"id": mentor_id})
    if r.deleted_count == 0:
        raise HTTPException(404, MENTOR_NOT_FOUND)
    await audit_mod.log_action(user, "Mentor removed", mentor_id)
    return {"ok": True}


@api.get("/mentor-unavailability")
async def get_mentor_unavailability(user: CurrentUser, mentor: str = ""):
    return await logic.list_mentor_unavailability(mentor_name=mentor or None)


@api.post("/mentor-unavailability", responses=_R400)
async def add_mentor_unavailability(body: MentorUnavailabilityIn, request: Request):
    user = await auth.current_user_required(request)
    mentor_name = body.mentor_name.strip()
    if not mentor_name:
        raise HTTPException(400, "Mentor name is required")
    if body.start_date > body.end_date:
        raise HTTPException(400, "Start date must be on or before end date")
    doc = await logic.add_mentor_unavailability(
        mentor_name, body.start_date, body.end_date, body.reason,
        user["id"] if user else None,
    )
    await audit_mod.log_action(user, "Mentor marked unavailable",
                                f"{mentor_name} ({body.start_date} to {body.end_date})")
    return doc


@api.delete("/mentor-unavailability/{period_id}", responses=_R404)
async def remove_mentor_unavailability(period_id: str, request: Request):
    user = await auth.current_user_required(request)
    ok = await logic.delete_mentor_unavailability(period_id)
    if not ok:
        raise HTTPException(404, "Unavailability period not found")
    await audit_mod.log_action(user, "Mentor unavailability removed", period_id)
    return {"ok": True}


# --------------------------- SOW ---------------------------
def _month_to_int(month):
    try:
        return int(month)
    except (ValueError, TypeError):
        for i, n in enumerate(MONTH_NAMES, start=1):
            if n.lower() == str(month).lower():
                return i
    return None


def _sow_session_excluded(s, mnum, year, mentor_filter, program_filter, include_names, exclude_names):
    """Whether this session should be left out of the SOW/Provision aggregation."""
    try:
        d = datetime.strptime(s["date"], "%Y-%m-%d").date()
    except Exception:
        return True
    if mnum and d.month != mnum:
        return True
    if year and d.year != int(year):
        return True
    mname = s.get("mentor_name", "")
    if include_names is not None and mname not in include_names:
        return True
    if exclude_names is not None and mname in exclude_names:
        return True
    if mentor_filter and mname not in mentor_filter:
        return True
    if program_filter and s.get("program_id") not in program_filter:
        return True
    return False


def _billing_row_for(agg, s, pmap, month_label):
    mname = s.get("mentor_name", "")
    p = pmap.get(s["program_id"], {})
    key = (mname, s["program_id"])
    if key not in agg:
        agg[key] = {"mentor": mname,
                    "program_id": s["program_id"],
                    "program_name": p.get("name", "Unknown"),
                    "project_code": p.get("project_code", ""),
                    "client": p.get("client", ""),
                    "month": month_label,
                    "sessions_conducted": 0, "total_hours": 0.0,
                    "_dates": set()}
    return agg[key]


def _aggregate_sow_sessions(sessions, pmap, mnum, year, month_label, mentor_filter, program_filter,
                            include_names=None, exclude_names=None):
    """Groups sessions into per (mentor, program) billing rows, applying the month/year
    window plus optional mentor/program filters and an include/exclude mentor-name set
    (Provision vs. regular SOW use opposite sides of that same filter)."""
    agg = {}
    for s in sessions:
        if _sow_session_excluded(s, mnum, year, mentor_filter, program_filter, include_names, exclude_names):
            continue
        row = _billing_row_for(agg, s, pmap, month_label)
        row["sessions_conducted"] += 1
        row["total_hours"] += session_hours(s)
        row["_dates"].add(s["date"])
    return agg


def _finalize_billing_row(row):
    """Rolls up a row's collected _dates into total_hours/dates/start_date/end_date,
    shared by the regular SOW and Provision exports (see build_sow_data /
    build_provision_data) since both produce the same per-row date fields."""
    row["total_hours"] = round(row["total_hours"], 2)
    # format dates like "2 May, 9 May, 16 May"
    sorted_dates = sorted(row.pop("_dates"))
    row["dates"] = ", ".join(
        datetime.strptime(d, "%Y-%m-%d").strftime("%-d %b") for d in sorted_dates
    )
    row["start_date"] = datetime.strptime(sorted_dates[0], "%Y-%m-%d").strftime(DATE_FMT_DDMMMYYYY)
    row["end_date"] = datetime.strptime(sorted_dates[-1], "%Y-%m-%d").strftime(DATE_FMT_DDMMMYYYY)
    row["project_manager"] = "Santosh"


async def build_sow_data(month, year, mentors, programs):
    mnum = _month_to_int(month)
    mentor_filter = [m for m in (mentors or "").split(",") if m] if mentors else None
    program_filter = [p for p in (programs or "").split(",") if p] if programs else None
    pmap = await programs_map()
    sessions = await clean_sessions()
    month_label = f"{MONTH_NAMES[mnum-1]} {year}" if mnum else str(year)
    # Provision mentors are billed separately (see build_provision_data) — keep
    # them out of the regular SOW so nobody gets billed for the same hours twice.
    provision_names = {m["name"] for m in await logic.list_provision_mentors()}

    agg = _aggregate_sow_sessions(sessions, pmap, mnum, year, month_label, mentor_filter, program_filter,
                                  exclude_names=provision_names)

    by_mentor = {}
    for row in agg.values():
        _finalize_billing_row(row)
        by_mentor.setdefault(row["mentor"], []).append(row)

    grouped = []
    for mentor in sorted(by_mentor.keys()):
        rows = sorted(by_mentor[mentor], key=lambda r: r["program_name"])
        grouped.append({
            "mentor": mentor,
            "rows": rows,
            "subtotal_sessions": sum(r["sessions_conducted"] for r in rows),
            "subtotal_hours": round(sum(r["total_hours"] for r in rows), 2),
        })
    grand = {
        "sessions": sum(g["subtotal_sessions"] for g in grouped),
        "hours": round(sum(g["subtotal_hours"] for g in grouped), 2),
    }
    return grouped, grand, month_label


@api.get("/sow")
async def sow(request: Request, month: str, year: int, mentors: str = "", programs: str = ""):
    user = await auth.current_user_required(request)
    grouped, grand, month_label = await build_sow_data(month, year, mentors, programs)
    changes = await logic.diff_sow_changes(month_label, year, grouped)
    await logic.sow_records_col.insert_one({
        "id": new_id(), "month": month_label, "mentors": mentors, "programs": programs,
        "total_sessions": grand["sessions"], "total_hours": grand["hours"],
        "generated_by": (user.get("name") if user else "Anonymous"),
        "created_at": now_iso(),
    })
    await audit_mod.log_action(user, "SOW generated",
                               f"{month_label}; mentors=[{mentors}]; programs=[{programs}]")
    return {"grouped": grouped, "grand_total": grand, "month_label": month_label, "changes": changes}


@api.get("/sow/download")
async def sow_download(request: Request, month: str, year: int, mentors: str = "", programs: str = ""):
    user = await auth.current_user_required(request)
    grouped, grand, month_label = await build_sow_data(month, year, mentors, programs)
    data = build_sow_excel(grouped, month_label)
    fname = f"SOW_{month_label.replace(' ', '_')}.xlsx"
    generated_by = user.get("name") if user else "Unknown"
    await logic.record_sow_snapshot(month_label, year, grouped, generated_by)
    await logic.record_sow_history(month, month_label, year, mentors, programs, grand, fname, generated_by)
    await audit_mod.log_action(user, "SOW downloaded",
                               f"{month_label}; mentors=[{mentors}]; programs=[{programs}]")
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.post("/sow/download")
async def sow_download_with_previous(
    request: Request,
    month: str,
    year: int,
    previous_sow: Annotated[UploadFile | None, File()] = None,
    mentors: str = "",
    programs: str = "",
):
    user = await auth.current_user_required(request)
    grouped, grand, month_label = await build_sow_data(month, year, mentors, programs)
    prev_bytes = await previous_sow.read() if previous_sow else None
    data = build_sow_excel(grouped, month_label, previous_sow_bytes=prev_bytes)
    fname = f"SOW_{month_label.replace(' ', '_')}.xlsx"
    generated_by = user.get("name") if user else "Unknown"
    await logic.record_sow_snapshot(month_label, year, grouped, generated_by)
    await logic.record_sow_history(month, month_label, year, mentors, programs, grand, fname, generated_by)
    await audit_mod.log_action(user, "SOW downloaded",
                               f"{month_label}; mentors=[{mentors}]; programs=[{programs}]; previous_sow={previous_sow.filename if previous_sow else 'none'}")
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.get("/sow/history")
async def sow_history(user: CurrentUser):
    return {"history": await logic.list_sow_history()}


# --------------------------- Provision (admin only) ---------------------------
# A small set of mentors (Ashutosh, Harish, Gagandeep, ... — see logic.DEFAULT_PROVISION_MENTORS)
# are billed separately from the regular client SOW: their sessions are raised as
# a standalone Provision SOW with a per-mentor hourly rate, plus flat monthly
# service charges (retainers, vendor fees) that aren't tied to any session at all.
async def build_provision_data(month, year, mentors, programs):
    mnum = _month_to_int(month)
    prov_mentors = await logic.list_provision_mentors()
    prov_names = {m["name"] for m in prov_mentors}
    rate_by_name = {m["name"]: m["cost_per_hour"] for m in prov_mentors}
    mentor_filter = [m for m in (mentors or "").split(",") if m] if mentors else None
    program_filter = [p for p in (programs or "").split(",") if p] if programs else None
    pmap = await programs_map()
    sessions = await clean_sessions()
    month_label = f"{MONTH_NAMES[mnum-1]} {year}" if mnum else str(year)

    agg = _aggregate_sow_sessions(sessions, pmap, mnum, year, month_label, mentor_filter, program_filter,
                                  include_names=prov_names)

    rows = []
    for row in agg.values():
        _finalize_billing_row(row)
        rate = rate_by_name.get(row["mentor"], 0.0)
        row["cost_per_hour"] = rate
        row["total_cost"] = round(row["total_hours"] * rate, 2)
        rows.append(row)
    rows.sort(key=lambda r: (r["mentor"], r["program_name"]))

    charges = await logic.list_provision_charges(month_label, year)
    grand_hours = round(sum(r["total_hours"] for r in rows), 2)
    grand_cost = round(sum(r["total_cost"] for r in rows) + sum(c["total_cost"] for c in charges), 2)
    return rows, charges, month_label, grand_hours, grand_cost


@api.get("/provision/mentors")
async def get_provision_mentors(user: AdminUser):
    return await logic.list_provision_mentors()


@api.post("/provision/mentors")
async def add_provision_mentor_ep(body: ProvisionMentorIn, user: AdminUser):
    m = await logic.add_provision_mentor(body.name, body.cost_per_hour)
    await audit_mod.log_action(user, "Provision mentor added", f"{m['name']} (₹{m['cost_per_hour']}/hr)")
    return m


@api.put("/provision/mentors/{mentor_id}", responses=_R404)
async def edit_provision_mentor_ep(mentor_id: str, body: ProvisionMentorUpdate, user: AdminUser):
    ok = await logic.update_provision_mentor(mentor_id, body.name, body.cost_per_hour)
    if not ok:
        raise HTTPException(404, MENTOR_NOT_FOUND)
    await audit_mod.log_action(user, "Provision mentor updated", mentor_id)
    return {"ok": True}


@api.delete("/provision/mentors/{mentor_id}", responses=_R404)
async def remove_provision_mentor_ep(mentor_id: str, user: AdminUser):
    ok = await logic.delete_provision_mentor(mentor_id)
    if not ok:
        raise HTTPException(404, MENTOR_NOT_FOUND)
    await audit_mod.log_action(user, "Provision mentor removed", mentor_id)
    return {"ok": True}


@api.get("/provision")
async def provision(request: Request, user: AdminUser, month: str, year: int, mentors: str = "", programs: str = ""):
    rows, charges, month_label, grand_hours, grand_cost = await build_provision_data(
        month, year, mentors, programs)
    return {"rows": rows, "charges": charges, "month_label": month_label,
            "grand_total": {"hours": grand_hours, "cost": grand_cost}}


@api.get("/provision/download")
async def provision_download(request: Request, user: AdminUser, month: str, year: int,
                             mentors: str = "", programs: str = ""):
    rows, charges, month_label, _, _ = await build_provision_data(
        month, year, mentors, programs)
    data = build_provision_excel(rows, charges, month_label)
    fname = f"Provision_{month_label.replace(' ', '_')}.xlsx"
    await audit_mod.log_action(user, "Provision SOW downloaded",
                               f"{month_label}; mentors=[{mentors}]; programs=[{programs}]")
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.post("/provision/charges")
async def add_provision_charge_ep(body: ProvisionChargeIn, user: AdminUser):
    mnum = _month_to_int(body.month)
    month_label = f"{MONTH_NAMES[mnum-1]} {body.year}" if mnum else str(body.year)
    c = await logic.add_provision_charge(month_label, body.year, body.trainer, body.description,
                                         body.total_cost, user.get("name"))
    await audit_mod.log_action(user, "Provision charge added",
                               f"{body.trainer} - {body.description} (₹{body.total_cost})")
    return c


@api.delete("/provision/charges/{charge_id}", responses=_R404)
async def remove_provision_charge_ep(charge_id: str, user: AdminUser):
    ok = await logic.delete_provision_charge(charge_id)
    if not ok:
        raise HTTPException(404, "Charge not found")
    await audit_mod.log_action(user, "Provision charge removed", charge_id)
    return {"ok": True}


# --------------------------- Attendance ---------------------------
@api.post("/attendance/update", responses=_R400)
async def attendance_update(
    request: Request,
    tracker: Annotated[UploadFile, File()],
    teams: Annotated[UploadFile, File()],
    session_name: Annotated[str, Form()],
    session_date: Annotated[str, Form()],
    threshold: Annotated[int, Form()] = 50,
    program_id: Annotated[str, Form()] = "",
):
    user = await auth.current_user_required(request)
    tracker_bytes = await tracker.read()
    teams_bytes = await teams.read()
    scheduled_minutes = await _scheduled_minutes_for(program_id, session_date)
    try:
        out_bytes, out_name, info = process_attendance(
            tracker_bytes, tracker.filename, teams_bytes, teams.filename,
            session_name, session_date, threshold, scheduled_minutes,
        )
    except Exception as e:
        logger.exception("attendance processing failed")
        raise HTTPException(400, f"Processing failed: {e}")

    # Auto-save attendance summary to feed the program Health Score
    if program_id:
        await logic.save_attendance_record(
            program_id, session_name, session_date, info,
            info.get("avg_attendance_pct", 0.0), info.get("avg_attentiveness_pct", 0.0),
            tracker.filename)

    await audit_mod.log_action(user, "Attendance processed",
                               f"session={session_name}, date={session_date}, file={tracker.filename}")

    info_header = quote(json.dumps(info))
    return StreamingResponse(
        io.BytesIO(out_bytes),
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{out_name}"',
            "X-Process-Info": info_header,
            "X-Output-Filename": quote(out_name),
        },
    )


async def _scheduled_minutes_for(program_id, date_str):
    """This program's planned session duration on this date, in minutes — or None
    if there's no scheduled session there (attendance then falls back to the
    Teams export's own reported duration, unchanged from before this existed)."""
    if not program_id or not date_str:
        return None
    s = await sessions_col.find_one({"program_id": program_id, "date": date_str}, {"_id": 0})
    if not s:
        return None
    return session_hours(s) * 60


async def _sessions_by_date_for_program(program_id):
    """{iso_date: {module_name, faculty}} built from a program's schedule — used to
    fill in the Date/Module Name/Faculty a raw feedback export doesn't carry itself."""
    sessions = await clean_sessions({"program_id": program_id})
    by_date = {}
    for s in sessions:
        d = s.get("date")
        if not d:
            continue
        entry = by_date.setdefault(d, {"topics": [], "mentors": []})
        topic = (s.get("topic") or "").strip()
        if topic and topic not in entry["topics"]:
            entry["topics"].append(topic)
        mentor = (s.get("mentor_name") or "").strip()
        if mentor and mentor not in entry["mentors"]:
            entry["mentors"].append(mentor)
    return {d: {"module_name": "; ".join(v["topics"]), "faculty": ", ".join(v["mentors"])}
            for d, v in by_date.items()}


@api.post("/attendance/update-batch", responses=_R400)
async def attendance_update_batch(
    request: Request,
    tracker: Annotated[UploadFile, File()],
    teams_files: Annotated[List[UploadFile], File()],
    session_names: Annotated[List[str], Form()],
    session_dates: Annotated[List[str], Form()],
    feedback: Annotated[UploadFile | None, File()] = None,
    threshold: Annotated[int, Form()] = 50,
    program_id: Annotated[str, Form()] = "",
):
    user = await auth.current_user_required(request)
    if not teams_files:
        raise HTTPException(400, "Upload at least one Teams export")
    if not (len(teams_files) == len(session_names) == len(session_dates)):
        raise HTTPException(400, "Each Teams export needs a matching session name and date")
    if feedback is not None and not program_id:
        raise HTTPException(400, "Select a program so feedback can be matched against its schedule")

    tracker_bytes = await tracker.read()
    sessions = []
    for f, name, date in zip(teams_files, session_names, session_dates):
        sessions.append({
            "bytes": await f.read(), "filename": f.filename,
            "session_name": name, "session_date_iso": date,
        })

    feedback_bytes = await feedback.read() if feedback is not None else None
    sessions_by_date = await _sessions_by_date_for_program(program_id) if feedback is not None else None
    scheduled_minutes_by_date = None
    if program_id:
        scheduled_minutes_by_date = {
            date: await _scheduled_minutes_for(program_id, date) for date in set(session_dates)
        }

    try:
        out_bytes, out_name, summary = process_attendance_batch(
            tracker_bytes, tracker.filename, sessions, threshold,
            feedback_bytes=feedback_bytes,
            sessions_by_date=sessions_by_date,
            scheduled_minutes_by_date=scheduled_minutes_by_date,
        )
    except Exception as e:
        logger.exception("batch attendance processing failed")
        raise HTTPException(400, f"Processing failed: {e}")

    # Auto-save one attendance summary per consolidated day to feed the program Health Score
    if program_id:
        for day in summary["days"]:
            await logic.save_attendance_record(
                program_id, day["session_name"], day["session_date"], day,
                day.get("avg_attendance_pct", 0.0), day.get("avg_attentiveness_pct", 0.0),
                tracker.filename)

    audit_detail = f"sessions={len(sessions)}, file={tracker.filename}"
    if feedback is not None:
        audit_detail += f", feedback={feedback.filename}"
    await audit_mod.log_action(user, "Attendance batch processed", audit_detail)

    info_header = quote(json.dumps(summary))
    return StreamingResponse(
        io.BytesIO(out_bytes),
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{out_name}"',
            "X-Process-Info": info_header,
            "X-Output-Filename": quote(out_name),
        },
    )


@api.post("/attendance/detect-date")
async def attendance_detect_date(user: CurrentUser, teams: Annotated[UploadFile, File()]):
    teams_bytes = await teams.read()
    try:
        parsed = parse_teams_export(teams_bytes, teams.filename)
        return {"session_date": parsed.get("session_date")}
    except Exception:
        return {"session_date": None}


# --------------------------- Auth ---------------------------
async def _authenticate(body: LoginIn):
    """Shared username/password check for /auth/login and /auth/viewer-login —
    raises the same lockout/invalid-credentials HTTPExceptions either way."""
    uname = body.username.strip().lower()
    if auth.is_locked_out(uname):
        raise HTTPException(429, "Too many failed login attempts. Try again in a few minutes.")
    user = await auth.get_user_by_username(uname)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        auth.record_failed_login(uname)
        raise HTTPException(401, "Invalid username or password")
    auth.clear_failed_logins(uname)
    return user


@api.post("/auth/login", responses=_R401_429)
async def login(body: LoginIn, response: Response):
    user = await _authenticate(body)
    token = auth.create_access_token(user)
    auth.set_auth_cookie(response, token)
    await audit_mod.log_action(auth._clean(user), "User login", f"username={user['username']}")
    return auth._clean(user)


@api.post("/auth/viewer-login", responses=_R401_403_429)
async def viewer_login(body: LoginIn, response: Response):
    user = await _authenticate(body)
    if user["role"] != "viewer":
        raise HTTPException(403, "This login is for viewers only")
    token = auth.create_access_token(user)
    auth.set_auth_cookie(response, token)
    await audit_mod.log_action(auth._clean(user), "User login", f"viewer={user['username']}")
    return auth._clean(user)


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    user = await auth.current_user_optional(request)
    auth.clear_auth_cookie(response)
    if user:
        await audit_mod.log_action(user, "User logout", f"username={user['username']}")
    return {"ok": True}


@api.get("/auth/me")
async def me(request: Request):
    return await auth.current_user_optional(request)


@api.post("/auth/change-password", responses=_R400)
async def change_password(body: ChangePwIn, request: Request):
    user = await auth.current_user_required(request)
    full = await auth.get_user_by_id(user["id"])
    if not auth.verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    if len(body.new_password) < auth.MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"New password must be at least {auth.MIN_PASSWORD_LENGTH} characters")
    await auth.users_col.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": auth.hash_password(body.new_password),
                  "must_change_password": False}})
    await audit_mod.log_action(user, "Password changed", f"username={user['username']}")
    return {"ok": True}


# --------------------------- User management (admin) ---------------------------
@api.get("/users")
async def get_users(user: AdminUser):
    return await auth.list_users()


@api.post("/users")
async def add_user(body: UserIn, request: Request, user: AdminUser):
    created = await auth.create_user(body.username, body.password, body.name, body.role,
                                     body.shared_program_ids)
    await audit_mod.log_action(user, "User account created", f"{body.username} ({body.role})")
    return created


@api.put("/users/{user_id}", responses=_R400_404)
async def edit_user(user_id: str, body: UserUpdateIn, request: Request, user: AdminUser):
    upd = {}
    if body.name is not None:
        upd["name"] = body.name
    if body.role is not None:
        upd["role"] = body.role
    if body.shared_program_ids is not None:
        upd["shared_program_ids"] = body.shared_program_ids
    if body.password:
        if len(body.password) < auth.MIN_PASSWORD_LENGTH:
            raise HTTPException(400, f"Password must be at least {auth.MIN_PASSWORD_LENGTH} characters")
        upd["password_hash"] = auth.hash_password(body.password)
    if not upd:
        raise HTTPException(400, "Nothing to update")
    r = await auth.users_col.update_one({"id": user_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "User not found")
    await audit_mod.log_action(user, "User account edited", user_id)
    return {"ok": True}


@api.delete("/users/{user_id}", responses=_R400_404)
async def remove_user(user_id: str, request: Request, user: AdminUser):
    target = await auth.get_user_by_id(user_id)
    if target and target["role"] == "admin":
        admins = await auth.users_col.count_documents({"role": "admin"})
        if admins <= 1:
            raise HTTPException(400, "Cannot delete the last admin")
    r = await auth.users_col.delete_one({"id": user_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "User not found")
    await audit_mod.log_action(user, "User account deleted", user_id)
    return {"ok": True}


# --------------------------- Audit log (admin) ---------------------------
@api.get("/audit")
async def get_audit(request: Request, user: AdminUser, user_name: str = "", action: str = "",
                    date_from: str = "", date_to: str = ""):
    rows = await audit_mod.query_audit(user_name or None, action or None,
                                       date_from or None, date_to or None)
    return {
        "rows": rows,
        "users": await audit_mod.distinct_users(),
        "actions": await audit_mod.distinct_actions(),
    }


@api.get("/audit/export")
async def export_audit(user: AdminUser):
    data = await audit_mod.audit_csv_bytes()
    return StreamingResponse(
        io.BytesIO(data), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit_log.csv"'})


# --------------------------- Backup (admin) ---------------------------
@api.get("/admin/backup")
async def download_backup(request: Request, user: AdminUser):
    data, fname, meta = await backup_mod.build_backup(user.get("name", "admin"))
    _last_backup["meta"] = meta
    await audit_mod.log_action(user, "Data backup downloaded", fname)
    return StreamingResponse(
        io.BytesIO(data), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@api.get("/admin/backup/last")
async def last_backup(user: AdminUser):
    return {"last_backup": _last_backup["meta"]}


@api.get("/")
async def root():
    return {"message": "Delivery Automation API"}


app.include_router(api)

# Same-origin deployments (e.g. the nginx reverse-proxy setup used on Azure App
# Service, where the browser only ever talks to the frontend's origin) don't
# need any cross-origin entries at all — CORS_ORIGINS only has to list origins
# the browser will call this API from *directly*.
_default_cors_origins = "http://localhost:3000,http://localhost:8001,http://127.0.0.1:3000,http://127.0.0.1:8001"
_cors_origins = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", _default_cors_origins).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    # NOTE: "*" is not honored as a wildcard for credentialed requests (browsers only
    # expose CORS-safelisted headers unless named explicitly) — list the custom
    # response headers the frontend actually reads.
    expose_headers=["Content-Disposition", "X-Process-Info", "X-Output-Filename"],
)


@app.on_event("startup")
async def startup():
    await auth.seed_admin()
    await seed_if_empty()
    await logic.seed_provision_mentors_if_empty()
