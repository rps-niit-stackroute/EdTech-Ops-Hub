"""Integration tests for /api/programs, /api/sessions, /api/availability."""
from datetime import date


class TestProgramsCrud:
    def test_list_programs(self, admin_client):
        r = admin_client.get("/api/programs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_program(self, admin_client, new_program):
        assert new_program["name"].startswith("IT_Program_")
        assert new_program["session_count"] == 0
        assert "health" in new_program

    def test_get_program_includes_sessions(self, admin_client, new_program):
        r = admin_client.get(f"/api/programs/{new_program['id']}")
        assert r.status_code == 200
        assert r.json()["id"] == new_program["id"]
        assert r.json()["sessions"] == []

    def test_get_missing_program_404(self, admin_client):
        r = admin_client.get("/api/programs/does-not-exist")
        assert r.status_code == 404

    def test_program_health_endpoint(self, admin_client, new_program):
        r = admin_client.get(f"/api/programs/{new_program['id']}/health")
        assert r.status_code == 200
        assert "score" in r.json()

    def test_update_program(self, admin_client, new_program):
        payload = {
            "name": new_program["name"] + "_Updated", "client": "New Client",
            "project_code": new_program["project_code"], "team_member": "New Owner",
            "mentors": ["M1", "M2"],
        }
        r = admin_client.put(f"/api/programs/{new_program['id']}", json=payload)
        assert r.status_code == 200
        assert r.json()["name"].endswith("_Updated")
        assert r.json()["client"] == "New Client"

    def test_update_missing_program_404(self, admin_client, new_program):
        payload = {**{k: new_program[k] for k in ("name", "client", "project_code", "team_member")},
                   "mentors": []}
        r = admin_client.put("/api/programs/does-not-exist", json=payload)
        assert r.status_code == 404

    def test_program_status_toggle(self, admin_client, new_program):
        r = admin_client.patch(f"/api/programs/{new_program['id']}/status", json={"status": "completed"})
        assert r.status_code == 200
        r2 = admin_client.get(f"/api/programs/{new_program['id']}")
        assert r2.json()["status"] == "completed"

    def test_program_status_invalid_value_rejected(self, admin_client, new_program):
        r = admin_client.patch(f"/api/programs/{new_program['id']}/status", json={"status": "bogus"})
        assert r.status_code == 400

    def test_program_status_missing_program_404(self, admin_client):
        r = admin_client.patch("/api/programs/does-not-exist/status", json={"status": "completed"})
        assert r.status_code == 404

    def test_delete_program(self, admin_client, new_program):
        r = admin_client.delete(f"/api/programs/{new_program['id']}")
        assert r.status_code == 200
        r2 = admin_client.get(f"/api/programs/{new_program['id']}")
        assert r2.status_code == 404

    def test_delete_missing_program_404(self, admin_client):
        r = admin_client.delete("/api/programs/does-not-exist")
        assert r.status_code == 404


class TestSessionsCrud:
    def test_create_session(self, admin_client, new_program):
        payload = {
            "program_id": new_program["id"], "date": date.today().strftime("%Y-%m-%d"),
            "start_time": "10:00", "end_time": "11:00", "topic": "Intro",
            "mentor_name": "IT_Mentor_A",
        }
        r = admin_client.post("/api/sessions", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["topic"] == "Intro"

    def test_create_session_missing_program_id_400(self, admin_client):
        payload = {"date": "2026-05-22", "start_time": "10:00", "end_time": "11:00",
                   "mentor_name": "X"}
        r = admin_client.post("/api/sessions", json=payload)
        assert r.status_code == 400

    def test_create_session_missing_program_404(self, admin_client):
        payload = {"program_id": "does-not-exist", "date": "2026-05-22",
                   "start_time": "10:00", "end_time": "11:00", "mentor_name": "X"}
        r = admin_client.post("/api/sessions", json=payload)
        assert r.status_code == 404

    def test_create_conflicting_session_409(self, admin_client, new_program):
        base = {
            "program_id": new_program["id"], "date": "2026-06-01",
            "start_time": "10:00", "end_time": "11:00", "mentor_name": "Conflict_Mentor",
        }
        r1 = admin_client.post("/api/sessions", json={**base, "topic": "First"})
        assert r1.status_code == 200
        r2 = admin_client.post("/api/sessions", json={**base, "topic": "Overlapping", "start_time": "10:30"})
        assert r2.status_code == 409

    def test_update_session(self, admin_client, new_program):
        payload = {"program_id": new_program["id"], "date": "2026-06-02",
                   "start_time": "10:00", "end_time": "11:00", "mentor_name": "M1", "topic": "Orig"}
        r = admin_client.post("/api/sessions", json=payload)
        sid = r.json()["id"]
        r2 = admin_client.put(f"/api/sessions/{sid}", json={"start_time": "11:00", "end_time": "12:00"})
        assert r2.status_code == 200
        assert r2.json()["start_time"] == "11:00"

    def test_update_missing_session_404(self, admin_client):
        r = admin_client.put("/api/sessions/does-not-exist", json={"topic": "x"})
        assert r.status_code == 404

    def test_update_session_conflict_409(self, admin_client, new_program):
        base = {"program_id": new_program["id"], "date": "2026-06-03", "mentor_name": "M2"}
        r1 = admin_client.post("/api/sessions", json={**base, "start_time": "09:00", "end_time": "10:00", "topic": "A"})
        r2 = admin_client.post("/api/sessions", json={**base, "start_time": "14:00", "end_time": "15:00", "topic": "B"})
        sid2 = r2.json()["id"]
        r3 = admin_client.put(f"/api/sessions/{sid2}", json={"start_time": "09:30", "end_time": "10:30"})
        assert r3.status_code == 409

    def test_delete_session(self, admin_client, new_program):
        payload = {"program_id": new_program["id"], "date": "2026-06-04",
                   "start_time": "10:00", "end_time": "11:00", "mentor_name": "M3", "topic": "ToDelete"}
        r = admin_client.post("/api/sessions", json=payload)
        sid = r.json()["id"]
        r2 = admin_client.delete(f"/api/sessions/{sid}")
        assert r2.status_code == 200

    def test_delete_missing_session_404(self, admin_client):
        r = admin_client.delete("/api/sessions/does-not-exist")
        assert r.status_code == 404


class TestAvailability:
    def test_available_when_no_conflict(self, admin_client):
        r = admin_client.post("/api/availability/check", json={
            "mentor_name": "Nobody_Booked", "date": "2026-06-05",
            "start_time": "10:00", "end_time": "11:00",
        })
        assert r.status_code == 200
        assert r.json()["available"] is True

    def test_conflict_detected(self, admin_client, new_program):
        payload = {"program_id": new_program["id"], "date": "2026-06-06",
                   "start_time": "10:00", "end_time": "11:00", "mentor_name": "Avail_Mentor", "topic": "X"}
        admin_client.post("/api/sessions", json=payload)
        r = admin_client.post("/api/availability/check", json={
            "mentor_name": "Avail_Mentor", "date": "2026-06-06",
            "start_time": "10:30", "end_time": "11:30",
        })
        assert r.status_code == 200
        assert r.json()["available"] is False
        assert len(r.json()["conflicts"]) == 1
