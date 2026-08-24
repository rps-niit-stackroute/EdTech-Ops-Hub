"""Integration test fixtures — exercises the real FastAPI app against a throwaway
Mongo database on the docker-compose Mongo instance (localhost:27017).

IMPORTANT: run this suite in its own process (`pytest tests/integration`), separate
from tests/unit. db.py constructs its Motor client once at import time from
environment variables; if the unit suite (or anything else) imports db/auth/server
first in the same interpreter, this conftest's env vars below would be set too late
and every route test here would silently talk to whatever Mongo the earlier import
saw instead of this throwaway test database.
"""
import os
import sys
import uuid
from pathlib import Path

_BACKEND_DIR = str(Path(__file__).resolve().parents[2])
sys.path.insert(0, _BACKEND_DIR)

_TEST_DB_NAME = f"edtech_ops_pytest_{uuid.uuid4().hex[:8]}"
ADMIN_PASSWORD = "TestAdminPass123"

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ["DB_NAME"] = _TEST_DB_NAME
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-integration-tests-only-32b")
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ["ADMIN_PASSWORD"] = ADMIN_PASSWORD
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("ENABLE_API_DOCS", "false")

import pytest
from starlette.testclient import TestClient

import server as server_module


@pytest.fixture(scope="session")
def admin_password():
    return ADMIN_PASSWORD


@pytest.fixture(scope="session")
def client():
    with TestClient(server_module.app) as c:
        yield c
    # Drop the whole throwaway database — a plain sync PyMongo client avoids
    # needing an event loop just for this one teardown call.
    import pymongo
    pymongo.MongoClient(os.environ["MONGO_URL"]).drop_database(_TEST_DB_NAME)


@pytest.fixture(scope="session")
def admin_client(client):
    """A TestClient already authenticated as the seeded admin user — the login
    cookie persists across requests made on this same client instance."""
    r = client.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture(scope="session")
def sync_sessions_col():
    """A plain (non-Motor) PyMongo handle onto the same test database's sessions
    collection — for tests that need to insert data bypassing the API's own
    availability checks (e.g. simulating a pre-existing clash), without touching
    the app's Motor client and its event-loop affinity."""
    import pymongo
    return pymongo.MongoClient(os.environ["MONGO_URL"])[_TEST_DB_NAME]["sessions"]


@pytest.fixture()
def new_program(admin_client):
    """Creates a fresh program (unique name/code per test) and returns its JSON."""
    unique = uuid.uuid4().hex[:8]
    payload = {
        "name": f"IT_Program_{unique}",
        "client": "IT_Client",
        "project_code": f"IT-{unique}",
        "team_member": "IT_Owner",
        "mentors": ["IT_Mentor_A"],
    }
    r = admin_client.post("/api/programs", json=payload)
    assert r.status_code == 200, r.text
    return r.json()
