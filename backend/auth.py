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

# ----------------------------- Login brute-force protection -----------------------------
# In-memory is fine here: single backend process, and a restart resetting the
# window is an acceptable tradeoff for a small internal tool with no external
# rate-limiting infra in front of it.
_failed_logins = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_LOCKOUT_SECONDS = 300


def is_locked_out(username: str) -> bool:
    now = datetime.now(timezone.utc).timestamp()
    attempts = [t for t in _failed_logins.get(username, []) if now - t < LOGIN_LOCKOUT_SECONDS]
    _failed_logins[username] = attempts
    return len(attempts) >= MAX_LOGIN_ATTEMPTS


def record_failed_login(username: str):
    now = datetime.now(timezone.utc).timestamp()
    _failed_logins.setdefault(username, []).append(now)


def clear_failed_logins(username: str):
    _failed_logins.pop(username, None)


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


def _cookie_kwargs():
    # Secure cookies require HTTPS — off by default for local/plain-HTTP docker-compose
    # use, but must be turned on (COOKIE_SECURE=true) once this sits behind real TLS.
    secure = os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"
    samesite = os.environ.get("COOKIE_SAMESITE", "lax").strip().lower()
    # Unset by default (host-only cookie) so a single-host deployment is unaffected.
    # Set to a shared parent domain (e.g. ".example.com") when the frontend and API
    # are split across sibling subdomains, so the browser sends the cookie to both.
    domain = os.environ.get("COOKIE_DOMAIN", "").strip() or None
    return {"secure": secure, "samesite": samesite, "domain": domain}


def set_auth_cookie(response, token: str):
    response.set_cookie(key="access_token", value=token, httponly=True,
                        max_age=604800, path="/", **_cookie_kwargs())


def clear_auth_cookie(response):
    # domain/samesite/secure must match what the cookie was set with, or the
    # browser treats delete_cookie's Set-Cookie as a different cookie and the
    # original one is never actually cleared.
    kwargs = _cookie_kwargs()
    response.delete_cookie(key="access_token", path="/",
                           domain=kwargs["domain"], samesite=kwargs["samesite"],
                           secure=kwargs["secure"])


def _clean(user):
    if not user:
        return None
    user = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return user


async def get_user_by_username(username: str):
    return await users_col.find_one({"username": username.strip().lower()})


async def get_user_by_id(uid: str):
    return await users_col.find_one({"id": uid})


async def get_user_by_aad_oid(oid: str):
    return await users_col.find_one({"aad_oid": oid})


async def create_user_from_aad(oid: str, name: str, email: str):
    """Auto-provision an account on a user's first Azure AD sign-in, once this
    app sits behind Azure App Service Authentication ("Easy Auth"). Defaults to
    the least-privileged role — an existing admin promotes them from Settings
    after they've signed in at least once. No password_hash is set, so the
    local username/password login naturally never works for this account."""
    username = (email or oid).strip().lower()
    doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": None,
        "name": name or username,
        "role": "viewer",
        "must_change_password": False,
        "shared_program_ids": [],
        "aad_oid": oid,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await users_col.insert_one(doc)
    except Exception:
        # Concurrent request from the same brand-new user already created it.
        existing = await get_user_by_aad_oid(oid)
        if existing:
            return _clean(existing)
        raise
    return _clean(doc)


async def current_user_optional(request: Request):
    """Returns user dict (no hash) or None. Never raises.

    Prefers this app's own JWT session (local username/password login, still
    used in local dev where there's no Azure proxy in front). Falls back to
    the identity Azure App Service Authentication injects as
    X-MS-CLIENT-PRINCIPAL-* headers once Easy Auth is enabled in front of this
    app — those headers are only ever present on requests Azure has already
    verified against Azure AD, so trusting them here is safe."""
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        try:
            payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
            user = await get_user_by_id(payload["sub"])
            if user:
                return _clean(user)
        except Exception:
            pass

    oid = request.headers.get("X-MS-CLIENT-PRINCIPAL-ID")
    if oid:
        user = await get_user_by_aad_oid(oid)
        if user:
            return _clean(user)
        name = request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME", "")
        return await create_user_from_aad(oid, name, name)
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
    password = os.environ.get("ADMIN_PASSWORD")
    existing = await users_col.find_one({"username": username})
    if existing is None:
        if not password:
            raise RuntimeError(
                "ADMIN_PASSWORD environment variable must be set to seed the initial admin account")
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


MIN_PASSWORD_LENGTH = 8


async def create_user(username, password, name, role, shared_program_ids=None):
    username = username.strip().lower()
    if role not in ROLES:
        raise HTTPException(400, "Invalid role")
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
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
