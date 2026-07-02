import json
import logging
from datetime import datetime, date, timedelta
from typing import List, Optional
from urllib.parse import quote

from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, Request, Response, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import io

from db import programs_col, sessions_col, seed_if_empty, new_id, now_iso
from excel_utils import time_to_minutes
from attendance_processor import process_attendance, parse_teams_export
from schedule_parser import parse_schedule
from sow_export import build_sow_excel
import auth
import audit as audit_mod
import logic
import backup as backup_mod

app = FastAPI()
api = APIRouter(prefix="/api")
logger = logging.getLogger("opshub")
logging.basicConfig(level=logging.INFO)

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


class SessionIn(BaseModel):
    program_id: Optional[str] = None
    date: str
    start_time: str
    end_time: str
    topic: Optional[str] = ""
    mentor_name: str


class SessionUpdate(BaseModel):
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    topic: Optional[str] = None
    mentor_name: Optional[str] = None


# --------------------------- Helpers ---------------------------
def session_hours(s):
    st = time_to_minutes(s.get("start_time"))
    en = time_to_minutes(s.get("end_time"))
    if st is None or en is None or en <= st:
        return 0.0
    return round((en - st) / 60.0, 2)


def overlaps(a, b):
    return a["_s"] < b["_e"] and b["_s"] < a["_e"]


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


async def compute_clashes():
    sessions = await clean_sessions()
    pmap = await programs_map()
    for s in sessions:
        s["_s"] = time_to_minutes(s["start_time"]) or 0
        s["_e"] = time_to_minutes(s["end_time"]) or 0
    clashes = []
    by_key = {}
    for s in sessions:
        by_key.setdefault((s["mentor_name"].strip().lower(), s["date"]), []).append(s)
    for (mentor, dt), group in by_key.items():
        if not mentor:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if overlaps(a, b):
                    pa = pmap.get(a["program_id"], {})
                    pb = pmap.get(b["program_id"], {})
                    clashes.append({
                        "mentor": a["mentor_name"],
                        "date": dt,
                        "program_a": pa.get("name", "Unknown"),
                        "program_b": pb.get("name", "Unknown"),
                        "time_a": f"{a['start_time']} - {a['end_time']}",
                        "time_b": f"{b['start_time']} - {b['end_time']}",
                        "session_a": a["id"],
                        "session_b": b["id"],
                    })
    return clashes


# --------------------------- Dashboard ---------------------------
@api.get("/dashboard")
async def dashboard():
    total_programs = await programs_col.count_documents({})
    sessions = await clean_sessions()
    today = date.today()
    start_week = today - timedelta(days=today.weekday())
    end_week = start_week + timedelta(days=6)
    sessions_this_week = 0
    mentors = set()
    for s in sessions:
        if s.get("mentor_name"):
            mentors.add(s["mentor_name"].strip())
        try:
            d = datetime.strptime(s["date"], "%Y-%m-%d").date()
            if start_week <= d <= end_week:
                sessions_this_week += 1
        except Exception:
            pass
    clashes = await compute_clashes()

    # program summary with health scores
    summary = []
    async for p in programs_col.find({}, {"_id": 0}).sort("created_at", -1):
        sess = [s for s in sessions if s["program_id"] == p["id"]]
        summary.append({
            "id": p["id"], "name": p["name"], "client": p["client"],
            "project_code": p["project_code"], "team_member": p["team_member"],
            "session_count": len(sess),
            "health": await logic.compute_health(p["id"], sess),
        })

    return {
        "total_programs": total_programs,
        "sessions_this_week": sessions_this_week,
        "active_mentors": len(mentors),
        "clashes_detected": len(clashes),
        "total_sessions": len(sessions),
        "programs": summary,
    }


# --------------------------- Programs ---------------------------
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
    user = await auth.current_user_optional(request)
    out = []
    async for p in programs_col.find({}, {"_id": 0}).sort("created_at", -1):
        # team_member sees only programs they created (when logged in)
        if user and user["role"] == "team_member" and p.get("created_by") != user["id"]:
            continue
        out.append(await serialize_program(p))
    return out


@api.post("/programs")
async def create_program(body: ProgramIn, request: Request):
    user = await auth.current_user_optional(request)
    doc = {"id": new_id(), "created_at": now_iso(), "created_by": user["id"] if user else None,
           **body.model_dump()}
    await programs_col.insert_one(doc)
    await audit_mod.log_action(user, "Program created", f"{body.name} ({body.project_code})")
    return await serialize_program({k: v for k, v in doc.items() if k != "_id"})


@api.get("/programs/{program_id}")
async def get_program(program_id: str):
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program not found")
    sess = await clean_sessions({"program_id": program_id})
    sess.sort(key=lambda s: (s["date"], s["start_time"]))
    base = await serialize_program(p)
    return {**base, "sessions": sess}


@api.get("/programs/{program_id}/health")
async def program_health(program_id: str):
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program not found")
    return await logic.compute_health(program_id)


@api.put("/programs/{program_id}")
async def update_program(program_id: str, body: ProgramIn, request: Request):
    user = await auth.current_user_optional(request)
    r = await programs_col.update_one({"id": program_id}, {"$set": body.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, "Program not found")
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    await audit_mod.log_action(user, "Program edited", f"{body.name} ({body.project_code})")
    return await serialize_program(p)


@api.delete("/programs/{program_id}")
async def delete_program(program_id: str, request: Request):
    user = await auth.current_user_optional(request)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    r = await programs_col.delete_one({"id": program_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Program not found")
    await sessions_col.delete_many({"program_id": program_id})
    await audit_mod.log_action(user, "Program deleted", p.get("name", program_id) if p else program_id)
    return {"ok": True}


@api.post("/programs/{program_id}/schedule")
async def upload_schedule(program_id: str, request: Request, file: UploadFile = File(...)):
    """Parse schedule, check mentor availability, and RETURN clean vs conflicting rows
    (nothing is committed yet — the UI resolves conflicts then calls /sessions/bulk)."""
    user = await auth.current_user_optional(request)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program not found")
    content = await file.read()
    try:
        parsed = parse_schedule(content, file.filename)
    except Exception as e:
        raise HTTPException(400, f"Could not parse schedule: {e}")

    clean, conflicts = [], []
    for s in parsed:
        mentor = s["mentor_name"] or (p.get("mentors") or [""])[0]
        row = {"date": s["date"], "start_time": s["start_time"], "end_time": s["end_time"],
               "topic": s["topic"], "mentor_name": mentor}
        avail = await logic.check_availability(mentor, s["date"], s["start_time"], s["end_time"])
        if avail["available"]:
            clean.append(row)
        else:
            conflicts.append({"session": row, "conflicts": avail["conflicts"]})
    await audit_mod.log_action(user, "Schedule Excel uploaded",
                               f"file={file.filename}, program={p.get('name')}, "
                               f"clean={len(clean)}, conflicts={len(conflicts)}")
    return {"clean": clean, "conflicts": conflicts}


@api.post("/programs/{program_id}/sessions/bulk")
async def bulk_sessions(program_id: str, request: Request, payload: dict = Body(...)):
    """Commit a list of (already-resolved) sessions; re-checks availability per row."""
    user = await auth.current_user_optional(request)
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program not found")
    inserted, skipped = 0, []
    for s in payload.get("sessions", []):
        mentor = s.get("mentor_name") or (p.get("mentors") or [""])[0]
        avail = await logic.check_availability(mentor, s["date"], s["start_time"], s["end_time"])
        if not avail["available"]:
            skipped.append({"session": s, "conflicts": avail["conflicts"]})
            continue
        await sessions_col.insert_one({"id": new_id(), "program_id": program_id,
                                       "date": s["date"], "start_time": s["start_time"],
                                       "end_time": s["end_time"], "topic": s.get("topic", ""),
                                       "mentor_name": mentor})
        inserted += 1
    await audit_mod.log_action(user, "Schedule committed",
                               f"program={p.get('name')}, inserted={inserted}, skipped={len(skipped)}")
    return {"inserted": inserted, "skipped": skipped}


@api.post("/availability/check")
async def availability_check(payload: dict = Body(...)):
    return await logic.check_availability(
        payload.get("mentor_name", ""), payload.get("date", ""),
        payload.get("start_time", ""), payload.get("end_time", ""),
        payload.get("exclude_session_id"),
    )


# --------------------------- Sessions ---------------------------
@api.post("/sessions")
async def create_session(body: SessionIn, request: Request):
    if not body.program_id:
        raise HTTPException(400, "program_id required")
    user = await auth.current_user_optional(request)
    avail = await logic.check_availability(body.mentor_name, body.date, body.start_time, body.end_time)
    if not avail["available"]:
        c = avail["conflicts"][0]
        raise HTTPException(409, f"Mentor {body.mentor_name} is already assigned to "
                                 f"{c['program_name']} from {c['start']} to {c['end']} on this date. "
                                 f"Please choose a different mentor or time.")
    doc = {"id": new_id(), **body.model_dump()}
    await sessions_col.insert_one(doc)
    await audit_mod.log_action(user, "Session added", f"{body.topic} · {body.date} · {body.mentor_name}")
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/sessions/{session_id}")
async def update_session(session_id: str, body: SessionUpdate, request: Request):
    user = await auth.current_user_optional(request)
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    existing = await sessions_col.find_one({"id": session_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Session not found")
    merged = {**existing, **upd}
    avail = await logic.check_availability(merged["mentor_name"], merged["date"],
                                           merged["start_time"], merged["end_time"],
                                           exclude_session_id=session_id)
    if not avail["available"]:
        c = avail["conflicts"][0]
        raise HTTPException(409, f"Mentor {merged['mentor_name']} is already assigned to "
                                 f"{c['program_name']} from {c['start']} to {c['end']} on this date. "
                                 f"Please choose a different mentor or time.")
    await sessions_col.update_one({"id": session_id}, {"$set": upd})
    s = await sessions_col.find_one({"id": session_id}, {"_id": 0})
    await audit_mod.log_action(user, "Session edited", f"{s.get('topic')} · {s.get('date')}")
    return s


@api.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    user = await auth.current_user_optional(request)
    s = await sessions_col.find_one({"id": session_id}, {"_id": 0})
    r = await sessions_col.delete_one({"id": session_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Session not found")
    await audit_mod.log_action(user, "Session deleted", (s.get("topic") if s else session_id))
    return {"ok": True}


# --------------------------- Calendar / Clashes ---------------------------
@api.get("/calendar")
async def calendar(month: int, year: int):
    pmap = await programs_map()
    sessions = await clean_sessions()
    clashes = await compute_clashes()
    clash_ids = set()
    for c in clashes:
        clash_ids.add(c["session_a"])
        clash_ids.add(c["session_b"])
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
    return {"sessions": out, "clashes": clashes}


@api.get("/clashes")
async def get_clashes():
    return {"clashes": await compute_clashes()}


@api.get("/meta")
async def meta():
    pmap = await programs_map()
    sessions = await clean_sessions()
    mentors = set()
    team_members = set()
    for p in pmap.values():
        for m in p.get("mentors", []):
            mentors.add(m)
        if p.get("team_member"):
            team_members.add(p["team_member"])
    for s in sessions:
        if s.get("mentor_name"):
            mentors.add(s["mentor_name"].strip())
    return {
        "mentors": sorted(m for m in mentors if m),
        "team_members": sorted(t for t in team_members if t),
        "programs": [{"id": p["id"], "name": p["name"]} for p in
                     sorted(pmap.values(), key=lambda x: x["name"])],
    }


# --------------------------- SOW ---------------------------
def _month_to_int(month):
    try:
        return int(month)
    except (ValueError, TypeError):
        for i, n in enumerate(MONTH_NAMES, start=1):
            if n.lower() == str(month).lower():
                return i
    return None


async def build_sow_data(month, year, mentors, programs):
    mnum = _month_to_int(month)
    mentor_filter = [m for m in (mentors or "").split(",") if m] if mentors else None
    program_filter = [p for p in (programs or "").split(",") if p] if programs else None
    pmap = await programs_map()
    sessions = await clean_sessions()
    month_label = f"{MONTH_NAMES[mnum-1]} {year}" if mnum else str(year)

    agg = {}
    for s in sessions:
        try:
            d = datetime.strptime(s["date"], "%Y-%m-%d").date()
        except Exception:
            continue
        if mnum and d.month != mnum:
            continue
        if year and d.year != int(year):
            continue
        if mentor_filter and s.get("mentor_name") not in mentor_filter:
            continue
        if program_filter and s.get("program_id") not in program_filter:
            continue
        p = pmap.get(s["program_id"], {})
        key = (s.get("mentor_name", ""), s["program_id"])
        if key not in agg:
            agg[key] = {"mentor": s.get("mentor_name", ""),
                        "program_name": p.get("name", "Unknown"),
                        "project_code": p.get("project_code", ""),
                        "client": p.get("client", ""),
                        "month": month_label,
                        "sessions_conducted": 0, "total_hours": 0.0,
                        "_dates": set()}
        agg[key]["sessions_conducted"] += 1
        agg[key]["total_hours"] += session_hours(s)
        agg[key]["_dates"].add(s["date"])

    by_mentor = {}
    for row in agg.values():
        row["total_hours"] = round(row["total_hours"], 2)
        # format dates like "2 May, 9 May, 16 May"
        sorted_dates = sorted(row.pop("_dates"))
        row["dates"] = ", ".join(
            datetime.strptime(d, "%Y-%m-%d").strftime("%-d %b") for d in sorted_dates
        )
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
    user = await auth.current_user_optional(request)
    grouped, grand, month_label = await build_sow_data(month, year, mentors, programs)
    await logic.sow_records_col.insert_one({
        "id": new_id(), "month": month_label, "mentors": mentors, "programs": programs,
        "total_sessions": grand["sessions"], "total_hours": grand["hours"],
        "generated_by": (user.get("name") if user else "Anonymous"),
        "created_at": now_iso(),
    })
    await audit_mod.log_action(user, "SOW generated",
                               f"{month_label}; mentors=[{mentors}]; programs=[{programs}]")
    return {"grouped": grouped, "grand_total": grand, "month_label": month_label}


@api.get("/sow/download")
async def sow_download(request: Request, month: str, year: int, mentors: str = "", programs: str = ""):
    user = await auth.current_user_optional(request)
    grouped, grand, month_label = await build_sow_data(month, year, mentors, programs)
    data = build_sow_excel(grouped, month_label)
    fname = f"SOW_{month_label.replace(' ', '_')}.xlsx"
    await audit_mod.log_action(user, "SOW downloaded",
                               f"{month_label}; mentors=[{mentors}]; programs=[{programs}]")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# --------------------------- Attendance ---------------------------
@api.post("/attendance/update")
async def attendance_update(
    request: Request,
    tracker: UploadFile = File(...),
    teams: UploadFile = File(...),
    session_name: str = Form(...),
    session_date: str = Form(...),
    threshold: int = Form(50),
    program_id: str = Form(""),
):
    user = await auth.current_user_optional(request)
    tracker_bytes = await tracker.read()
    teams_bytes = await teams.read()
    try:
        out_bytes, out_name, info = process_attendance(
            tracker_bytes, tracker.filename, teams_bytes, teams.filename,
            session_name, session_date, threshold,
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
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{out_name}"',
            "X-Process-Info": info_header,
            "X-Output-Filename": quote(out_name),
        },
    )


@api.post("/attendance/detect-date")
async def attendance_detect_date(teams: UploadFile = File(...)):
    teams_bytes = await teams.read()
    try:
        parsed = parse_teams_export(teams_bytes, teams.filename)
        return {"session_date": parsed.get("session_date")}
    except Exception:
        return {"session_date": None}


# --------------------------- Auth ---------------------------
@api.post("/auth/login")
async def login(body: LoginIn, response: Response):
    user = await auth.get_user_by_username(body.username)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    token = auth.create_access_token(user)
    auth.set_auth_cookie(response, token)
    await audit_mod.log_action(auth._clean(user), "User login", f"username={user['username']}")
    return auth._clean(user)


@api.post("/auth/viewer-login")
async def viewer_login(body: LoginIn, response: Response):
    user = await auth.get_user_by_username(body.username)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
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


@api.post("/auth/change-password")
async def change_password(body: ChangePwIn, request: Request):
    user = await auth.current_user_required(request)
    full = await auth.get_user_by_id(user["id"])
    if not auth.verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(400, "New password must be at least 6 characters")
    await auth.users_col.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": auth.hash_password(body.new_password),
                  "must_change_password": False}})
    await audit_mod.log_action(user, "Password changed", f"username={user['username']}")
    return {"ok": True}


# --------------------------- User management (admin) ---------------------------
@api.get("/users")
async def get_users(user=Depends(auth.require_role("admin"))):
    return await auth.list_users()


@api.post("/users")
async def add_user(body: UserIn, request: Request, user=Depends(auth.require_role("admin"))):
    created = await auth.create_user(body.username, body.password, body.name, body.role,
                                     body.shared_program_ids)
    await audit_mod.log_action(user, "User account created", f"{body.username} ({body.role})")
    return created


@api.put("/users/{user_id}")
async def edit_user(user_id: str, body: UserUpdateIn, request: Request,
                    user=Depends(auth.require_role("admin"))):
    upd = {}
    if body.name is not None:
        upd["name"] = body.name
    if body.role is not None:
        upd["role"] = body.role
    if body.shared_program_ids is not None:
        upd["shared_program_ids"] = body.shared_program_ids
    if body.password:
        upd["password_hash"] = auth.hash_password(body.password)
    if not upd:
        raise HTTPException(400, "Nothing to update")
    r = await auth.users_col.update_one({"id": user_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "User not found")
    await audit_mod.log_action(user, "User account edited", user_id)
    return {"ok": True}


@api.delete("/users/{user_id}")
async def remove_user(user_id: str, request: Request, user=Depends(auth.require_role("admin"))):
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
async def get_audit(request: Request, user_name: str = "", action: str = "",
                    date_from: str = "", date_to: str = "",
                    user=Depends(auth.require_role("admin"))):
    rows = await audit_mod.query_audit(user_name or None, action or None,
                                       date_from or None, date_to or None)
    return {
        "rows": rows,
        "users": await audit_mod.distinct_users(),
        "actions": await audit_mod.distinct_actions(),
    }


@api.get("/audit/export")
async def export_audit(user=Depends(auth.require_role("admin"))):
    data = await audit_mod.audit_csv_bytes()
    return StreamingResponse(
        io.BytesIO(data), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit_log.csv"'})


# --------------------------- Backup (admin) ---------------------------
@api.get("/admin/backup")
async def download_backup(request: Request, user=Depends(auth.require_role("admin"))):
    data, fname, meta = await backup_mod.build_backup(user.get("name", "admin"))
    _last_backup["meta"] = meta
    await audit_mod.log_action(user, "Data backup downloaded", fname)
    return StreamingResponse(
        io.BytesIO(data), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@api.get("/admin/backup/last")
async def last_backup(user=Depends(auth.require_role("admin"))):
    return {"last_backup": _last_backup["meta"]}


@api.get("/")
async def root():
    return {"message": "EdTech Ops Hub API"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8001",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await auth.seed_admin()
    await seed_if_empty()
