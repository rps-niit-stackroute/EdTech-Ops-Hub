"""Tests for the 5 new features: Health Score, Availability, Auth/Roles, Audit, Backup."""
import io
import os
import zipfile
from datetime import date

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ADMIN_USER = "admin"
ADMIN_PASS = "admin123"
NEW_ADMIN_PASS = "admin123!new"


@pytest.fixture(scope="module", autouse=True)
def _reset_auth_state():
    """Reset users + audit_logs to ensure fresh must_change_password state for this module."""
    import asyncio, uuid, bcrypt
    from datetime import datetime, timezone
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv("/app/backend/.env")

    async def _run():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db["users"].delete_many({})
        await db["audit_logs"].delete_many({})
        pw = bcrypt.hashpw(ADMIN_PASS.encode(), bcrypt.gensalt()).decode()
        await db["users"].insert_one({
            "id": str(uuid.uuid4()), "username": "admin", "password_hash": pw,
            "name": "Administrator", "role": "admin",
            "must_change_password": True, "shared_program_ids": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_run())
    yield


# --------------------------- Fixtures ---------------------------
@pytest.fixture(scope="module")
def anon():
    return requests.Session()


@pytest.fixture(scope="module")
def admin():
    """Logged-in admin session. Resets users collection-state via change-pwd flow."""
    s = requests.Session()
    # try fresh admin first
    r = s.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    if r.status_code != 200:
        # try with prior-changed password (in case run twice)
        r = s.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return s


# --------------------------- FEATURE 1: Health ---------------------------
class TestHealth:
    def test_dashboard_includes_health_per_program(self, anon):
        r = anon.get(f"{API}/dashboard", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "programs" in d and len(d["programs"]) >= 4
        for p in d["programs"]:
            h = p["health"]
            for k in ("score", "color", "attendance", "attentiveness", "completion"):
                assert k in h
            assert h["color"] in ("green", "amber", "red")
            if h["score"] >= 75:
                assert h["color"] == "green"
            elif h["score"] >= 50:
                assert h["color"] == "amber"
            else:
                assert h["color"] == "red"

    def test_seeded_health_buckets(self, anon):
        d = anon.get(f"{API}/dashboard", timeout=20).json()
        by_name = {p["name"]: p["health"] for p in d["programs"]}
        # Spec: CTS ~76 green, UST ~57 amber, Lowes(EBC)/DXC red
        cts = next((v for k, v in by_name.items() if "CTS" in k.upper()), None)
        ust = next((v for k, v in by_name.items() if "UST" in k.upper()), None)
        dxc = next((v for k, v in by_name.items() if "DXC" in k.upper()), None)
        # 4th seeded program is "Engineering Beyond Code Program" (Lowes per spec)
        ebc = next((v for k, v in by_name.items()
                    if "ENGINEERING BEYOND" in k.upper() or "LOW" in k.upper()), None)
        assert cts and cts["color"] == "green", f"CTS health: {cts}"
        assert ust and ust["color"] == "amber", f"UST health: {ust}"
        assert dxc and dxc["color"] == "red", f"DXC health: {dxc}"
        assert ebc and ebc["color"] == "red", f"EBC/Lowes health: {ebc}"
        # Color counts: 1 green, 1 amber, 2 red
        colors = [p["health"]["color"] for p in d["programs"]]
        assert colors.count("green") >= 1
        assert colors.count("amber") >= 1
        assert colors.count("red") >= 2

    def test_health_equal_weight_math(self, anon):
        d = anon.get(f"{API}/dashboard", timeout=20).json()
        for p in d["programs"]:
            h = p["health"]
            expected = round((h["attendance"] + h["attentiveness"] + h["completion"]) / 3.0, 1)
            assert abs(expected - h["score"]) <= 0.2, f"{p['name']} math off: {h}"


# --------------------------- FEATURE 2: Availability ---------------------------
class TestAvailability:
    def test_availability_no_conflict(self, anon):
        r = anon.post(f"{API}/availability/check", json={
            "mentor_name": "Manoj Ajmer", "date": "2099-12-31",
            "start_time": "06:00", "end_time": "07:00"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["available"] is True
        assert d["conflicts"] == []

    def test_availability_detects_conflict_and_session_409(self, anon):
        # Find one existing seeded session for Manoj
        r = anon.get(f"{API}/clashes", timeout=15)
        cl = r.json()["clashes"]
        assert cl, "expected at least one seeded clash"
        c = cl[0]
        # Use same mentor/date/time -> should report conflict
        a = anon.post(f"{API}/availability/check", json={
            "mentor_name": c["mentor"], "date": c["date"],
            "start_time": c["time_a"].split(" - ")[0],
            "end_time": c["time_a"].split(" - ")[1]}, timeout=15)
        assert a.status_code == 200
        ad = a.json()
        assert ad["available"] is False
        assert len(ad["conflicts"]) >= 1
        assert "program_name" in ad["conflicts"][0]

        # Now try to CREATE a session that overlaps -> must 409
        # Need an existing program id
        progs = anon.get(f"{API}/programs", timeout=15).json()
        pid = progs[0]["id"]
        st, en = c["time_a"].split(" - ")
        body = {"program_id": pid, "date": c["date"],
                "start_time": st, "end_time": en,
                "topic": "TEST_conflict", "mentor_name": c["mentor"]}
        cr = anon.post(f"{API}/sessions", json=body, timeout=15)
        assert cr.status_code == 409, cr.text

    def test_schedule_upload_preview(self, anon):
        """POST /programs/{id}/schedule returns clean[] and conflicts[] without committing."""
        import openpyxl as _ox
        import time as _t
        progs = anon.get(f"{API}/programs", timeout=15).json()
        pid = progs[0]["id"]
        # Use a unique TEST mentor so re-runs don't conflict with previously inserted
        mentor = f"TEST_M_{int(_t.time())}"
        wb = _ox.Workbook()
        ws = wb.active
        ws.append(["Date", "Start Time", "End Time", "Topic", "Mentor"])
        ws.append(["2099-11-01", "09:00", "10:00", "Intro", mentor])
        ws.append(["2099-11-02", "10:00", "11:00", "Next", mentor])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        files = {"file": ("sched.xlsx", buf.read(),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = anon.post(f"{API}/programs/{pid}/schedule", files=files, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "clean" in d and "conflicts" in d
        assert len(d["clean"]) == 2  # both unique
        b = anon.post(f"{API}/programs/{pid}/sessions/bulk",
                      json={"sessions": d["clean"]}, timeout=30)
        assert b.status_code == 200
        bd = b.json()
        assert bd["inserted"] == 2


# --------------------------- FEATURE 3: Auth ---------------------------
class TestAuth:
    """Run with a fresh users-collection (admin/admin123, must_change_password=true)."""

    def test_login_sets_cookie_and_must_change(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["username"] == "admin"
        assert u["role"] == "admin"
        assert u.get("must_change_password") is True
        assert "access_token" in s.cookies.get_dict()

    def test_me_with_cookie(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
        r = s.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_login_invalid(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"username": "admin", "password": "WRONG"}, timeout=15)
        assert r.status_code == 401

    def test_change_password_clears_flag(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
        r = s.post(f"{API}/auth/change-password",
                   json={"current_password": ADMIN_PASS, "new_password": NEW_ADMIN_PASS},
                   timeout=15)
        assert r.status_code == 200, r.text
        # /me should now show must_change_password=False
        me = s.get(f"{API}/auth/me", timeout=15).json()
        assert me["must_change_password"] is False
        # old password no longer works
        s2 = requests.Session()
        r2 = s2.post(f"{API}/auth/login",
                     json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
        assert r2.status_code == 401
        # new password works
        s3 = requests.Session()
        r3 = s3.post(f"{API}/auth/login",
                     json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        assert r3.status_code == 200

    def test_logout_clears_cookie(self, admin):
        r = admin.post(f"{API}/auth/logout", timeout=15)
        assert r.status_code == 200
        # /me should now be null (cookie cleared) — admin fixture is scoped module, so
        # we use a temp session
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        s.post(f"{API}/auth/logout", timeout=15)
        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200
        assert me.json() is None

    def test_bcrypt_hash_format(self):
        """Sanity: stored password hash must be bcrypt $2b$."""
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv("/app/backend/.env")
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        async def _check():
            u = await db["users"].find_one({"username": "admin"})
            return u["password_hash"]
        h = asyncio.run(_check())
        assert h.startswith("$2b$") or h.startswith("$2a$"), f"not bcrypt: {h[:10]}"


# --------------------------- FEATURE 4: Audit ---------------------------
class TestAudit:
    def test_audit_401_without_cookie(self, anon):
        r = anon.get(f"{API}/audit", timeout=15)
        assert r.status_code == 401

    def test_audit_returns_rows_for_admin(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        r = s.get(f"{API}/audit", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("rows", "users", "actions"):
            assert k in d
        assert len(d["rows"]) >= 1
        # Must include login event from our test
        assert any(row["action"] == "User login" for row in d["rows"])

    def test_audit_filter_by_action(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        r = s.get(f"{API}/audit", params={"action": "User login"}, timeout=15)
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert all(row["action"] == "User login" for row in rows)

    def test_audit_403_for_viewer(self):
        # Create a viewer and try
        s_admin = requests.Session()
        s_admin.post(f"{API}/auth/login",
                     json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        s_admin.post(f"{API}/users",
                     json={"username": "TEST_viewer1", "password": "v1pass",
                           "name": "TestViewer", "role": "viewer"}, timeout=15)
        v = requests.Session()
        rv = v.post(f"{API}/auth/login",
                    json={"username": "TEST_viewer1", "password": "v1pass"}, timeout=15)
        assert rv.status_code == 200
        rr = v.get(f"{API}/audit", timeout=15)
        assert rr.status_code == 403

    def test_audit_export_csv(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        r = s.get(f"{API}/audit/export", timeout=15)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert b"user_name" in r.content[:100]


# --------------------------- FEATURE 5: Backup & User mgmt ---------------------------
class TestBackupAndUsers:
    def test_backup_zip_structure(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        r = s.get(f"{API}/admin/backup", timeout=30)
        assert r.status_code == 200
        cd = r.headers.get("Content-Disposition", "")
        assert "EdTechOpsHub_Backup_" in cd
        assert cd.endswith('.zip"')
        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = set(z.namelist())
        for needed in {"database.json", "programs.json", "attendance_records.json",
                       "audit_log.csv", "sow_records.json", "backup_info.txt"}:
            assert needed in names, f"missing in zip: {needed}"

    def test_backup_last_meta(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        # ensure a backup was taken first
        s.get(f"{API}/admin/backup", timeout=30)
        r = s.get(f"{API}/admin/backup/last", timeout=15)
        assert r.status_code == 200
        d = r.json()["last_backup"]
        assert d and "filename" in d and "created_at" in d

    def test_backup_requires_admin(self, anon):
        r = anon.get(f"{API}/admin/backup", timeout=15)
        assert r.status_code == 401

    def test_user_crud(self):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"username": ADMIN_USER, "password": NEW_ADMIN_PASS}, timeout=15)
        # create
        r = s.post(f"{API}/users",
                   json={"username": "TEST_member1", "password": "p1pass",
                         "name": "TestMember", "role": "team_member"}, timeout=15)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        # list
        users = s.get(f"{API}/users", timeout=15).json()
        assert any(u["id"] == uid for u in users)
        # update role
        r2 = s.put(f"{API}/users/{uid}", json={"role": "viewer"}, timeout=15)
        assert r2.status_code == 200
        # delete
        r3 = s.delete(f"{API}/users/{uid}", timeout=15)
        assert r3.status_code == 200

    def test_users_requires_admin(self, anon):
        r = anon.get(f"{API}/users", timeout=15)
        assert r.status_code == 401
