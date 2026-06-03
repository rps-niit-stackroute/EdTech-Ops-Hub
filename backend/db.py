"""MongoDB connection, helpers and seed data."""
import os
import uuid
from datetime import datetime, timezone, date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

programs_col = db["programs"]
sessions_col = db["sessions"]


def new_id():
    return str(uuid.uuid4())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def seed_if_empty():
    if await programs_col.count_documents({}) > 0:
        return
    today = date.today()

    def d(offset):
        return (today + timedelta(days=offset)).strftime("%Y-%m-%d")

    seed = [
        {
            "name": "CTS - CNA Level 1", "client": "CTS",
            "project_code": "S01518-SMP001ISDL001N001", "team_member": "Santosh",
            "mentors": ["Manoj Ajmer"],
            "att_pct": 92.0, "attn_pct": 86.0,
            "sessions": [
                {"date": d(0), "start_time": "09:30", "end_time": "12:00",
                 "topic": "Architecture Concepts, Techniques and Tools", "mentor_name": "Manoj Ajmer"},
                # clash: same mentor, same day, overlapping window
                {"date": d(0), "start_time": "11:00", "end_time": "13:00",
                 "topic": "Applying Design Thinking", "mentor_name": "Manoj Ajmer"},
                {"date": d(3), "start_time": "09:30", "end_time": "12:00",
                 "topic": "Architecture Patterns", "mentor_name": "Manoj Ajmer"},
                {"date": d(9), "start_time": "09:30", "end_time": "12:00",
                 "topic": "GenAI and Prompt Engg for Architects", "mentor_name": "Manoj Ajmer"},
            ],
        },
        {
            "name": "Engineering Beyond Code Program", "client": "Lowes",
            "project_code": "S01600-LOWES01ISDL001N001", "team_member": "Kavya",
            "mentors": ["Kishore"],
            "att_pct": 64.0, "attn_pct": 58.0,
            "sessions": [
                {"date": d(1), "start_time": "18:00", "end_time": "20:00",
                 "topic": "Data-Intensive Design Core", "mentor_name": "Kishore"},
                {"date": d(4), "start_time": "18:00", "end_time": "20:00",
                 "topic": "Domain & Data Modelling Strategy", "mentor_name": "Kishore"},
                {"date": d(11), "start_time": "18:00", "end_time": "20:00",
                 "topic": "Cloud-Native Reference Architectures", "mentor_name": "Kishore"},
            ],
        },
        {
            "name": "UST - Aspiring Architect Batch 5", "client": "UST",
            "project_code": "S01128-SMP001ISDL001N001", "team_member": "Santosh",
            "mentors": ["Ashish Juyal"],
            "att_pct": 89.0, "attn_pct": 82.0,
            "sessions": [
                {"date": d(2), "start_time": "10:00", "end_time": "12:30",
                 "topic": "Solution Architecture Foundations", "mentor_name": "Ashish Juyal"},
                {"date": d(6), "start_time": "10:00", "end_time": "12:30",
                 "topic": "Microservices & Patterns", "mentor_name": "Ashish Juyal"},
            ],
        },
        {
            "name": "DXC - Project Manager Batch 1", "client": "DXC",
            "project_code": "S01470-SMP001ISDL001N001", "team_member": "Rohit",
            "mentors": ["Anupam"],
            "att_pct": 42.0, "attn_pct": 38.0,
            "sessions": [
                {"date": d(2), "start_time": "14:00", "end_time": "16:00",
                 "topic": "Agile Delivery Essentials", "mentor_name": "Anupam"},
                {"date": d(5), "start_time": "14:00", "end_time": "16:00",
                 "topic": "Risk & Stakeholder Management", "mentor_name": "Anupam"},
                {"date": d(12), "start_time": "14:00", "end_time": "16:00",
                 "topic": "Program Governance", "mentor_name": "Anupam"},
            ],
        },
    ]

    for p in seed:
        pid = new_id()
        sessions = p.pop("sessions")
        att = p.pop("att_pct")
        attn = p.pop("attn_pct")
        doc = {"id": pid, "created_at": now_iso(), **p}
        await programs_col.insert_one(doc)
        for s in sessions:
            await sessions_col.insert_one({"id": new_id(), "program_id": pid, **s})
        # seed two attendance summary records so Health Scores are meaningful
        for k in range(2):
            await db["attendance_records"].insert_one({
                "id": new_id(), "program_id": pid,
                "session_name": f"{p['name']} — Session {k+1}",
                "date": d(-7 + k * 3),
                "attendance_pct": att, "attentiveness_pct": attn,
                "present": int(att / 10), "enrolled": 10,
                "filename": "seed.xlsx", "created_at": now_iso(),
            })
