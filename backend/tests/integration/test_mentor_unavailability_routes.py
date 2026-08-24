"""Integration tests for /api/mentor-unavailability and its effect on
availability checks (session creation, /api/availability)."""


class TestMentorUnavailabilityCrud:
    def test_add_list_delete(self, admin_client):
        r = admin_client.post("/api/mentor-unavailability", json={
            "mentor_name": "Unavail_Mentor_A", "start_date": "2026-09-01",
            "end_date": "2026-09-05", "reason": "On leave",
        })
        assert r.status_code == 200, r.text
        period_id = r.json()["id"]

        r2 = admin_client.get("/api/mentor-unavailability", params={"mentor": "Unavail_Mentor_A"})
        assert r2.status_code == 200
        assert any(p["id"] == period_id for p in r2.json())

        r3 = admin_client.delete(f"/api/mentor-unavailability/{period_id}")
        assert r3.status_code == 200

        r4 = admin_client.get("/api/mentor-unavailability", params={"mentor": "Unavail_Mentor_A"})
        assert not any(p["id"] == period_id for p in r4.json())

    def test_add_blank_mentor_name_rejected(self, admin_client):
        r = admin_client.post("/api/mentor-unavailability", json={
            "mentor_name": "   ", "start_date": "2026-09-01", "end_date": "2026-09-05",
        })
        assert r.status_code == 400

    def test_add_start_after_end_rejected(self, admin_client):
        r = admin_client.post("/api/mentor-unavailability", json={
            "mentor_name": "Unavail_Mentor_B", "start_date": "2026-09-10", "end_date": "2026-09-01",
        })
        assert r.status_code == 400

    def test_delete_missing_period_404(self, admin_client):
        r = admin_client.delete("/api/mentor-unavailability/does-not-exist")
        assert r.status_code == 404


class TestUnavailabilityBlocksScheduling:
    def test_availability_check_flags_unavailable_mentor(self, admin_client):
        r = admin_client.post("/api/mentor-unavailability", json={
            "mentor_name": "Unavail_Mentor_C", "start_date": "2026-09-15",
            "end_date": "2026-09-20", "reason": "Personal leave",
        })
        period_id = r.json()["id"]

        r2 = admin_client.post("/api/availability/check", json={
            "mentor_name": "Unavail_Mentor_C", "date": "2026-09-16",
            "start_time": "10:00", "end_time": "11:00",
        })
        assert r2.status_code == 200
        d = r2.json()
        assert d["available"] is False
        assert any(c["kind"] == "unavailable" and c["reason"] == "Personal leave" for c in d["conflicts"])

        admin_client.delete(f"/api/mentor-unavailability/{period_id}")

    def test_session_create_blocked_when_mentor_unavailable(self, admin_client, new_program):
        r = admin_client.post("/api/mentor-unavailability", json={
            "mentor_name": "Unavail_Mentor_D", "start_date": "2026-09-21", "end_date": "2026-09-21",
        })
        period_id = r.json()["id"]

        r2 = admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-09-21",
            "start_time": "10:00", "end_time": "11:00",
            "mentor_name": "Unavail_Mentor_D", "topic": "Should be blocked",
        })
        assert r2.status_code == 409

        admin_client.delete(f"/api/mentor-unavailability/{period_id}")

    def test_session_create_unaffected_outside_unavailable_range(self, admin_client, new_program):
        r = admin_client.post("/api/mentor-unavailability", json={
            "mentor_name": "Unavail_Mentor_E", "start_date": "2026-09-01", "end_date": "2026-09-05",
        })
        period_id = r.json()["id"]

        r2 = admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-09-10",
            "start_time": "10:00", "end_time": "11:00",
            "mentor_name": "Unavail_Mentor_E", "topic": "Fine",
        })
        assert r2.status_code == 200

        admin_client.delete(f"/api/mentor-unavailability/{period_id}")
