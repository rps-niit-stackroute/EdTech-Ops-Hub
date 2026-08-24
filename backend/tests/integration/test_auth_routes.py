"""Integration tests for /api/auth/* and /api/users/* against a real test Mongo."""
import uuid


def _unique_username(prefix="user"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


class TestLogin:
    def test_login_success(self, client, admin_password):
        r = client.post("/api/auth/login", json={"username": "admin", "password": admin_password})
        assert r.status_code == 200
        body = r.json()
        assert body["username"] == "admin"
        assert body["role"] == "admin"
        assert "password_hash" not in body

    def test_login_wrong_password(self, client):
        r = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401

    def test_login_unknown_username(self, client):
        r = client.post("/api/auth/login", json={"username": "nobody_at_all", "password": "x"})
        assert r.status_code == 401

    def test_repeated_failures_trigger_lockout(self, client):
        uname = _unique_username("lockout")
        for _ in range(5):
            r = client.post("/api/auth/login", json={"username": uname, "password": "wrong"})
            assert r.status_code == 401
        r = client.post("/api/auth/login", json={"username": uname, "password": "wrong"})
        assert r.status_code == 429


class TestViewerLogin:
    def test_non_viewer_rejected(self, client, admin_password):
        r = client.post("/api/auth/viewer-login", json={"username": "admin", "password": admin_password})
        assert r.status_code == 403

    def test_viewer_login_succeeds_for_viewer_role(self, admin_client, admin_password):
        # admin_client is the one shared TestClient for the whole session (Motor's
        # client is bound to a single event loop, so a second TestClient can't be
        # spun up) — logging in as anyone else here overwrites its auth cookie, so
        # every other test relies on us restoring the admin session afterward.
        uname = _unique_username("viewer")
        r = admin_client.post("/api/users", json={
            "username": uname, "password": "viewerpass123", "name": "A Viewer", "role": "viewer",
        })
        assert r.status_code == 200, r.text
        try:
            r2 = admin_client.post("/api/auth/viewer-login", json={"username": uname, "password": "viewerpass123"})
            assert r2.status_code == 200
            assert r2.json()["role"] == "viewer"
        finally:
            admin_client.post("/api/auth/login", json={"username": "admin", "password": admin_password})


class TestMeAndLogout:
    def test_me_reflects_logged_in_user(self, admin_client):
        r = admin_client.get("/api/auth/me")
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_me_without_cookie_returns_null(self, client, admin_password):
        # Can't spin up a second TestClient (Motor's client is bound to one event
        # loop), so simulate "logged out" by clearing this shared client's cookie
        # jar, then log back in so later tests still see an authenticated session.
        client.cookies.clear()
        try:
            r = client.get("/api/auth/me")
            assert r.status_code == 200
            assert r.json() is None
        finally:
            client.post("/api/auth/login", json={"username": "admin", "password": admin_password})

    def test_logout_then_me_is_null(self, client, admin_password):
        r = client.post("/api/auth/login", json={"username": "admin", "password": admin_password})
        assert r.status_code == 200
        r2 = client.post("/api/auth/logout")
        assert r2.status_code == 200
        r3 = client.get("/api/auth/me")
        assert r3.json() is None
        # log back in so later tests using the shared `client`/`admin_client` fixture still work
        client.post("/api/auth/login", json={"username": "admin", "password": admin_password})


class TestChangePassword:
    def test_wrong_current_password_rejected(self, admin_client):
        r = admin_client.post("/api/auth/change-password",
                              json={"current_password": "wrong", "new_password": "newpass1234"})
        assert r.status_code == 400

    def test_too_short_new_password_rejected(self, admin_client, admin_password):
        r = admin_client.post("/api/auth/change-password",
                              json={"current_password": admin_password, "new_password": "short"})
        assert r.status_code == 400

    def test_successful_change_then_revert(self, admin_client, admin_password):
        r = admin_client.post("/api/auth/change-password",
                              json={"current_password": admin_password, "new_password": "temporaryPass123"})
        assert r.status_code == 200
        # revert so the rest of the (session-scoped) admin_client fixture keeps working
        r2 = admin_client.post("/api/auth/change-password",
                               json={"current_password": "temporaryPass123", "new_password": admin_password})
        assert r2.status_code == 200


class TestUserManagement:
    def test_list_users_includes_admin(self, admin_client):
        r = admin_client.get("/api/users")
        assert r.status_code == 200
        usernames = [u["username"] for u in r.json()]
        assert "admin" in usernames

    def test_create_edit_delete_user(self, admin_client):
        uname = _unique_username("crud")
        r = admin_client.post("/api/users", json={
            "username": uname, "password": "crudpass123", "name": "CRUD Test", "role": "team_member",
        })
        assert r.status_code == 200, r.text
        user_id = r.json()["id"]

        r2 = admin_client.put(f"/api/users/{user_id}", json={"name": "Renamed"})
        assert r2.status_code == 200

        r3 = admin_client.delete(f"/api/users/{user_id}")
        assert r3.status_code == 200

    def test_edit_user_nothing_to_update(self, admin_client):
        r = admin_client.post("/api/users", json={
            "username": _unique_username("noop"), "password": "noop12345", "name": "Noop", "role": "viewer",
        })
        user_id = r.json()["id"]
        r2 = admin_client.put(f"/api/users/{user_id}", json={})
        assert r2.status_code == 400
        admin_client.delete(f"/api/users/{user_id}")

    def test_edit_missing_user_404(self, admin_client):
        r = admin_client.put("/api/users/does-not-exist", json={"name": "x"})
        assert r.status_code == 404

    def test_delete_missing_user_404(self, admin_client):
        r = admin_client.delete("/api/users/does-not-exist")
        assert r.status_code == 404

    def test_cannot_delete_last_admin(self, admin_client):
        r = admin_client.get("/api/users")
        admin_ids = [u["id"] for u in r.json() if u["role"] == "admin"]
        assert len(admin_ids) == 1  # only the seeded admin at this point
        r2 = admin_client.delete(f"/api/users/{admin_ids[0]}")
        assert r2.status_code == 400

    def test_password_too_short_on_create(self, admin_client):
        r = admin_client.post("/api/users", json={
            "username": _unique_username("short"), "password": "short", "name": "x", "role": "viewer",
        })
        assert r.status_code == 400

    def test_duplicate_username_conflict(self, admin_client):
        uname = _unique_username("dupe")
        r1 = admin_client.post("/api/users", json={
            "username": uname, "password": "dupepass123", "name": "First", "role": "viewer",
        })
        assert r1.status_code == 200
        r2 = admin_client.post("/api/users", json={
            "username": uname, "password": "dupepass123", "name": "Second", "role": "viewer",
        })
        assert r2.status_code == 409
