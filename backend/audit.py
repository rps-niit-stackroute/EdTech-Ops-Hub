"""Audit logging for ISO traceability."""
import uuid
import io
import csv
from datetime import datetime, timezone

from db import db

audit_col = db["audit_logs"]


async def log_action(user, action, details=""):
    """user: dict (from auth) or None. Records an immutable audit entry."""
    doc = {
        "id": str(uuid.uuid4()),
        "user_name": (user.get("name") or user.get("username")) if user else "Anonymous",
        "role": user.get("role") if user else "public",
        "action": action,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await audit_col.insert_one(doc)


async def query_audit(user=None, action=None, date_from=None, date_to=None, limit=1000):
    q = {}
    if user:
        q["user_name"] = user
    if action:
        q["action"] = action
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to + "T23:59:59"
        q["timestamp"] = rng
    out = []
    async for d in audit_col.find(q, {"_id": 0}).sort("timestamp", -1).limit(limit):
        out.append(d)
    return out


async def audit_csv_bytes():
    rows = await query_audit(limit=100000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "user_name", "role", "action", "details", "timestamp"])
    for r in rows:
        w.writerow([r["id"], r["user_name"], r["role"], r["action"], r["details"], r["timestamp"]])
    return buf.getvalue().encode("utf-8")


async def distinct_actions():
    return sorted(await audit_col.distinct("action"))


async def distinct_users():
    return sorted(await audit_col.distinct("user_name"))
