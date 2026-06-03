import json
import logging
from datetime import datetime, date, timedelta
from typing import List, Optional
from urllib.parse import quote

from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import io

from db import programs_col, sessions_col, seed_if_empty, new_id, now_iso
from excel_utils import time_to_minutes
from attendance_processor import process_attendance
from schedule_parser import parse_schedule
from sow_export import build_sow_excel

app = FastAPI()
api = APIRouter(prefix="/api")
logger = logging.getLogger("opshub")
logging.basicConfig(level=logging.INFO)

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


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
    return {
        "total_programs": total_programs,
        "sessions_this_week": sessions_this_week,
        "active_mentors": len(mentors),
        "clashes_detected": len(clashes),
        "total_sessions": len(sessions),
    }


# --------------------------- Programs ---------------------------
async def serialize_program(p):
    sess = await clean_sessions({"program_id": p["id"]})
    sess_mentors = {s["mentor_name"].strip() for s in sess if s.get("mentor_name")}
    mentors = list(dict.fromkeys(list(p.get("mentors", [])) + sorted(sess_mentors)))
    return {**p, "session_count": len(sess), "mentors": mentors}


@api.get("/programs")
async def list_programs():
    out = []
    async for p in programs_col.find({}, {"_id": 0}).sort("created_at", -1):
        out.append(await serialize_program(p))
    return out


@api.post("/programs")
async def create_program(body: ProgramIn):
    doc = {"id": new_id(), "created_at": now_iso(), **body.model_dump()}
    await programs_col.insert_one(doc)
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


@api.put("/programs/{program_id}")
async def update_program(program_id: str, body: ProgramIn):
    r = await programs_col.update_one({"id": program_id}, {"$set": body.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, "Program not found")
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    return await serialize_program(p)


@api.delete("/programs/{program_id}")
async def delete_program(program_id: str):
    r = await programs_col.delete_one({"id": program_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Program not found")
    await sessions_col.delete_many({"program_id": program_id})
    return {"ok": True}


@api.post("/programs/{program_id}/schedule")
async def upload_schedule(program_id: str, file: UploadFile = File(...)):
    p = await programs_col.find_one({"id": program_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program not found")
    content = await file.read()
    try:
        parsed = parse_schedule(content, file.filename)
    except Exception as e:
        raise HTTPException(400, f"Could not parse schedule: {e}")
    inserted = 0
    for s in parsed:
        mentor = s["mentor_name"] or (p.get("mentors") or [""])[0]
        await sessions_col.insert_one({"id": new_id(), "program_id": program_id,
                                       "date": s["date"], "start_time": s["start_time"],
                                       "end_time": s["end_time"], "topic": s["topic"],
                                       "mentor_name": mentor})
        inserted += 1
    return {"inserted": inserted}


# --------------------------- Sessions ---------------------------
@api.post("/sessions")
async def create_session(body: SessionIn):
    if not body.program_id:
        raise HTTPException(400, "program_id required")
    doc = {"id": new_id(), **body.model_dump()}
    await sessions_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/sessions/{session_id}")
async def update_session(session_id: str, body: SessionUpdate):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    r = await sessions_col.update_one({"id": session_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Session not found")
    s = await sessions_col.find_one({"id": session_id}, {"_id": 0})
    return s


@api.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    r = await sessions_col.delete_one({"id": session_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Session not found")
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
                        "sessions_conducted": 0, "total_hours": 0.0}
        agg[key]["sessions_conducted"] += 1
        agg[key]["total_hours"] += session_hours(s)

    by_mentor = {}
    for row in agg.values():
        row["total_hours"] = round(row["total_hours"], 2)
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
async def sow(month: str, year: int, mentors: str = "", programs: str = ""):
    grouped, grand, month_label = await build_sow_data(month, year, mentors, programs)
    return {"grouped": grouped, "grand_total": grand, "month_label": month_label}


@api.get("/sow/download")
async def sow_download(month: str, year: int, mentors: str = "", programs: str = ""):
    grouped, grand, month_label = await build_sow_data(month, year, mentors, programs)
    data = build_sow_excel(grouped, month_label)
    fname = f"SOW_{month_label.replace(' ', '_')}.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# --------------------------- Attendance ---------------------------
@api.post("/attendance/update")
async def attendance_update(
    tracker: UploadFile = File(...),
    teams: UploadFile = File(...),
    session_name: str = Form(...),
    session_date: str = Form(...),
    threshold: int = Form(50),
):
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


@api.get("/")
async def root():
    return {"message": "EdTech Ops Hub API"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Process-Info", "X-Output-Filename"],
)


@app.on_event("startup")
async def startup():
    await seed_if_empty()
