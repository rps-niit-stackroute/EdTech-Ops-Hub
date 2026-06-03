"""Username/password JWT auth with bcrypt + httpOnly cookies + roles."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from fastapi import Request, HTTPException, Depends

from db import db

JWT_ALGORITHM = "HS256"
users_col = db["users"]

ROLES = {"admin", "team_member", "viewer"}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user) -> str:
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookie(response, token: str):
    response.set_cookie(key="access_token", value=token, httponly=True,
                        secure=False, samesite="lax", max_age=604800, path="/")


def clear_auth_cookie(response):
    response.delete_cookie(key="access_token", path="/")


def _clean(user):
    if not user:
        return None
    user = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return user


async def get_user_by_username(username: str):
    return await users_col.find_one({"username": username.strip().lower()})


async def get_user_by_id(uid: str):
    return await users_col.find_one({"id": uid})


async def current_user_optional(request: Request):
    """Returns user dict (no hash) or None. Never raises."""
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
        user = await get_user_by_id(payload["sub"])
        return _clean(user)
    except Exception:
        return None


async def current_user_required(request: Request):
    user = await current_user_optional(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_role(*roles):
    async def dep(request: Request):
        user = await current_user_required(request)
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dep


async def seed_admin():
    await users_col.create_index("username", unique=True)
    username = os.environ.get("ADMIN_USERNAME", "admin").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await users_col.find_one({"username": username})
    if existing is None:
        await users_col.insert_one({
            "id": str(uuid.uuid4()),
            "username": username,
            "password_hash": hash_password(password),
            "name": "Administrator",
            "role": "admin",
            "must_change_password": True,
            "shared_program_ids": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })


async def create_user(username, password, name, role, shared_program_ids=None):
    username = username.strip().lower()
    if role not in ROLES:
        raise HTTPException(400, "Invalid role")
    if await users_col.find_one({"username": username}):
        raise HTTPException(409, "Username already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": hash_password(password),
        "name": name or username,
        "role": role,
        "must_change_password": False,
        "shared_program_ids": shared_program_ids or [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await users_col.insert_one(doc)
    return _clean(doc)


async def list_users():
    out = []
    async for u in users_col.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1):
        out.append(u)
    return out
