"""Integration tests for /api/dashboard, /api/calendar, /api/clashes,
/api/schedule-changes/recent, /api/meta, /api/mentors, and the schedule
upload/bulk-commit flow."""
import io
from datetime import date

import openpyxl

XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class TestDashboard:
    def test_dashboard_shape(self, admin_client):
        r = admin_client.get("/api/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ("total_programs", "sessions_this_week", "active_mentors",
                 "clashes_detected", "total_sessions", "programs",
                 "health_distribution", "avg_health_score", "sessions_trend",
                 "mentor_workload", "hours_this_month",
                 "avg_attendance_pct", "avg_attentiveness_pct"):
            assert k in d

    def test_hours_this_month_uses_actual_start_end_time_not_a_stray_duration(self, admin_client, new_program):
        before = admin_client.get("/api/dashboard").json()["hours_this_month"]
        today_iso = date.today().isoformat()
        # Same stray-duration scenario as the SOW fix: clock time says 1 hour,
        # a mismatched stored duration says 6 — the dashboard KPI must add 1, not 6.
        admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": today_iso,
            "start_time": "09:00", "end_time": "10:00", "duration": 6,
            "mentor_name": "Dashboard_Duration_Mentor", "topic": "Hours KPI check",
        })
        after = admin_client.get("/api/dashboard").json()["hours_this_month"]
        assert round(after - before, 1) == 1.0


class TestCalendarClashes:
    def test_calendar_for_a_month(self, admin_client, new_program):
        admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-07-15",
            "start_time": "10:00", "end_time": "11:00", "mentor_name": "Cal_Mentor", "topic": "Cal",
        })
        r = admin_client.get("/api/calendar", params={"month": 7, "year": 2026})
        assert r.status_code == 200
        d = r.json()
        assert "sessions" in d and "clashes" in d
        assert any(s["topic"] == "Cal" for s in d["sessions"])

    def test_clashes_endpoint(self, admin_client, new_program, sync_sessions_col):
        # create_session/bulk_sessions both reject an overlapping insert outright,
        # so two truly overlapping sessions can only end up stored together via a
        # path that bypasses that availability check (e.g. the seed data, or here,
        # a direct collection insert) — which is exactly the scenario clash
        # detection exists to catch after the fact. A plain sync PyMongo client is
        # used for the insert (rather than Motor) since it has no event-loop
        # affinity, unlike the app's own Motor client bound to the TestClient's loop.
        import uuid
        base = {"program_id": new_program["id"], "date": "2026-07-16", "mentor_name": "Clash_Mentor"}
        sync_sessions_col.insert_many([
            {"id": str(uuid.uuid4()), "topic": "A", "start_time": "09:00", "end_time": "10:00", **base},
            {"id": str(uuid.uuid4()), "topic": "B", "start_time": "09:30", "end_time": "10:30", **base},
        ])
        r = admin_client.get("/api/clashes")
        assert r.status_code == 200
        clashes = r.json()["clashes"]
        assert any(c["mentor"] == "Clash_Mentor" for c in clashes)

    def test_calendar_merges_co_mentor_rows(self, admin_client, new_program):
        base = {"program_id": new_program["id"], "date": "2026-07-17",
                "start_time": "14:00", "end_time": "15:00", "topic": "CoMentor"}
        admin_client.post("/api/sessions", json={**base, "mentor_name": "CoA"})
        admin_client.post("/api/sessions", json={**base, "mentor_name": "CoB"})
        r = admin_client.get("/api/calendar", params={"month": 7, "year": 2026})
        rows = [s for s in r.json()["sessions"] if s["topic"] == "CoMentor"]
        assert len(rows) == 1
        assert "CoA" in rows[0]["mentor_name"] and "CoB" in rows[0]["mentor_name"]


class TestScheduleChanges:
    def test_recent_schedule_changes_after_reschedule(self, admin_client, new_program):
        r = admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-07-18",
            "start_time": "10:00", "end_time": "11:00", "mentor_name": "Resched_Mentor", "topic": "Orig",
        })
        sid = r.json()["id"]
        admin_client.put(f"/api/sessions/{sid}", json={"start_time": "12:00", "end_time": "13:00"})
        r2 = admin_client.get("/api/schedule-changes/recent")
        assert r2.status_code == 200
        assert any(c["session_id"] == sid for c in r2.json()["changes"])

    def test_calendar_reflects_an_edited_session_time_immediately(self, admin_client, new_program):
        # Editing a session (rather than re-uploading a schedule) must be visible on
        # the master calendar right away — there's no separate cache/snapshot for it
        # to go stale in, but this pins that guarantee down as a regression test.
        r = admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-07-19",
            "start_time": "09:00", "end_time": "10:00", "mentor_name": "Sync_Mentor", "topic": "SyncCheck",
        })
        sid = r.json()["id"]
        admin_client.put(f"/api/sessions/{sid}", json={"start_time": "15:00", "end_time": "16:00"})

        cal = admin_client.get("/api/calendar", params={"month": 7, "year": 2026})
        row = next(s for s in cal.json()["sessions"] if s["id"] == sid)
        assert row["start_time"] == "15:00"
        assert row["end_time"] == "16:00"


class TestMeta:
    def test_meta_shape(self, admin_client, new_program):
        r = admin_client.get("/api/meta")
        assert r.status_code == 200
        d = r.json()
        assert "mentors" in d and "team_members" in d and "programs" in d
        assert any(p["id"] == new_program["id"] for p in d["programs"])
        assert "IT_Mentor_A" in d["mentors"]
        assert "IT_Owner" in d["team_members"]


class TestMentorsDirectory:
    def test_list_mentors_includes_schedule_derived_entries(self, admin_client, new_program):
        r = admin_client.get("/api/mentors")
        assert r.status_code == 200
        names = [m["name"] for m in r.json()]
        assert "IT_Mentor_A" in names

    def test_add_edit_remove_mentor(self, admin_client):
        r = admin_client.post("/api/mentors", json={
            "name": "Directory Mentor X", "email": "a@b.com", "phone": "123", "notes": "n",
        })
        assert r.status_code == 200, r.text
        mid = r.json()["id"]

        r2 = admin_client.put(f"/api/mentors/{mid}", json={"notes": "updated"})
        assert r2.status_code == 200

        r3 = admin_client.delete(f"/api/mentors/{mid}")
        assert r3.status_code == 200

    def test_add_mentor_blank_name_rejected(self, admin_client):
        r = admin_client.post("/api/mentors", json={"name": "   "})
        assert r.status_code == 400

    def test_add_duplicate_mentor_conflict(self, admin_client):
        r1 = admin_client.post("/api/mentors", json={"name": "Dup Mentor Y"})
        assert r1.status_code == 200
        r2 = admin_client.post("/api/mentors", json={"name": "Dup Mentor Y"})
        assert r2.status_code == 409
        admin_client.delete(f"/api/mentors/{r1.json()['id']}")

    def test_edit_mentor_blank_name_rejected(self, admin_client):
        r = admin_client.post("/api/mentors", json={"name": "Edit Mentor Z"})
        mid = r.json()["id"]
        r2 = admin_client.put(f"/api/mentors/{mid}", json={"name": "   "})
        assert r2.status_code == 400
        admin_client.delete(f"/api/mentors/{mid}")

    def test_edit_mentor_nothing_to_update(self, admin_client):
        r = admin_client.post("/api/mentors", json={"name": "NoOp Mentor"})
        mid = r.json()["id"]
        r2 = admin_client.put(f"/api/mentors/{mid}", json={})
        assert r2.status_code == 400
        admin_client.delete(f"/api/mentors/{mid}")

    def test_edit_missing_mentor_404(self, admin_client):
        r = admin_client.put("/api/mentors/does-not-exist", json={"notes": "x"})
        assert r.status_code == 404

    def test_delete_missing_mentor_404(self, admin_client):
        r = admin_client.delete("/api/mentors/does-not-exist")
        assert r.status_code == 404


def _schedule_xlsx_bytes(mentor_name="Schedule_Mentor"):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Date", "Start Time", "End Time", "Topic", "Mentor"])
    ws.append(["2026-08-01", "10:00 AM", "11:00 AM", "Uploaded Topic", mentor_name])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestScheduleUploadAndBulkCommit:
    def test_upload_schedule_returns_clean_rows(self, admin_client, new_program):
        files = {"file": ("schedule.xlsx", _schedule_xlsx_bytes(), XLSX_CT)}
        r = admin_client.post(f"/api/programs/{new_program['id']}/schedule", files=files)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["clean"]) == 1
        assert d["conflicts"] == []

    def test_upload_schedule_missing_program_404(self, admin_client):
        files = {"file": ("schedule.xlsx", _schedule_xlsx_bytes(), XLSX_CT)}
        r = admin_client.post("/api/programs/does-not-exist/schedule", files=files)
        assert r.status_code == 404

    def test_upload_schedule_detects_conflict(self, admin_client, new_program):
        admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-08-01",
            "start_time": "10:00", "end_time": "11:00", "mentor_name": "Conflicting_Sched_Mentor",
            "topic": "Existing",
        })
        files = {"file": ("schedule.xlsx", _schedule_xlsx_bytes("Conflicting_Sched_Mentor"), XLSX_CT)}
        r = admin_client.post(f"/api/programs/{new_program['id']}/schedule", files=files)
        assert r.status_code == 200
        assert r.json()["clean"] == []
        assert len(r.json()["conflicts"]) == 1

    def test_bulk_sessions_commit(self, admin_client, new_program):
        payload = {"sessions": [{
            "date": "2026-08-02", "start_time": "09:00", "end_time": "10:00",
            "topic": "Bulk", "mentor_name": "Bulk_Mentor",
        }]}
        r = admin_client.post(f"/api/programs/{new_program['id']}/sessions/bulk", json=payload)
        assert r.status_code == 200
        assert r.json()["inserted"] == 1
        assert r.json()["skipped"] == []

    def test_bulk_sessions_missing_program_404(self, admin_client):
        r = admin_client.post("/api/programs/does-not-exist/sessions/bulk", json={"sessions": []})
        assert r.status_code == 404

    def test_bulk_sessions_skips_conflicts(self, admin_client, new_program):
        admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-08-03",
            "start_time": "10:00", "end_time": "11:00", "mentor_name": "Bulk_Conflict_Mentor",
            "topic": "Existing",
        })
        payload = {"sessions": [{
            "date": "2026-08-03", "start_time": "10:30", "end_time": "11:30",
            "topic": "Overlap", "mentor_name": "Bulk_Conflict_Mentor",
        }]}
        r = admin_client.post(f"/api/programs/{new_program['id']}/sessions/bulk", json=payload)
        assert r.status_code == 200
        assert r.json()["inserted"] == 0
        assert len(r.json()["skipped"]) == 1


class TestScheduleReplace:
    def test_replace_schedule_removes_old_sessions_and_returns_clean_rows_for_new(self, admin_client, new_program):
        old = admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-08-05",
            "start_time": "09:00", "end_time": "10:00", "mentor_name": "Replace_Old_Mentor", "topic": "Old",
        }).json()

        files = {"file": ("new_schedule.xlsx", _schedule_xlsx_bytes("Replace_New_Mentor"), XLSX_CT)}
        r = admin_client.post(f"/api/programs/{new_program['id']}/schedule/replace", files=files)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["removed_count"] == 1
        assert len(d["clean"]) == 1
        assert d["conflicts"] == []

        detail = admin_client.get(f"/api/programs/{new_program['id']}").json()
        assert all(s["id"] != old["id"] for s in detail["sessions"])

    def test_replace_schedule_preserves_program_metadata(self, admin_client, new_program):
        files = {"file": ("new_schedule.xlsx", _schedule_xlsx_bytes(), XLSX_CT)}
        admin_client.post(f"/api/programs/{new_program['id']}/schedule/replace", files=files)
        detail = admin_client.get(f"/api/programs/{new_program['id']}").json()
        assert detail["name"] == new_program["name"]
        assert detail["client"] == new_program["client"]
        assert detail["project_code"] == new_program["project_code"]
        assert detail["team_member"] == new_program["team_member"]

    def test_replace_schedule_missing_program_404(self, admin_client):
        files = {"file": ("schedule.xlsx", _schedule_xlsx_bytes(), XLSX_CT)}
        r = admin_client.post("/api/programs/does-not-exist/schedule/replace", files=files)
        assert r.status_code == 404

    def test_replace_schedule_does_not_conflict_against_its_own_replaced_slot(self, admin_client, new_program):
        # Old session and the new file's row occupy the exact same mentor/date/time —
        # since the old one is deleted first, this must NOT be reported as a conflict.
        admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-08-01",
            "start_time": "10:00", "end_time": "11:00", "mentor_name": "Same_Slot_Mentor", "topic": "Old",
        })
        files = {"file": ("schedule.xlsx", _schedule_xlsx_bytes("Same_Slot_Mentor"), XLSX_CT)}
        r = admin_client.post(f"/api/programs/{new_program['id']}/schedule/replace", files=files)
        assert r.status_code == 200
        assert len(r.json()["clean"]) == 1
        assert r.json()["conflicts"] == []

    def test_replace_schedule_still_detects_conflict_with_another_program(self, admin_client, new_program):
        other = admin_client.post("/api/programs", json={
            "name": f"Other_{new_program['name']}", "client": "C", "project_code": f"OTH-{new_program['project_code']}",
            "team_member": "T", "mentors": ["Cross_Program_Mentor"],
        }).json()
        admin_client.post("/api/sessions", json={
            "program_id": other["id"], "date": "2026-08-01",
            "start_time": "10:00", "end_time": "11:00", "mentor_name": "Cross_Program_Mentor", "topic": "Busy",
        })
        files = {"file": ("schedule.xlsx", _schedule_xlsx_bytes("Cross_Program_Mentor"), XLSX_CT)}
        r = admin_client.post(f"/api/programs/{new_program['id']}/schedule/replace", files=files)
        assert r.status_code == 200
        assert r.json()["clean"] == []
        assert len(r.json()["conflicts"]) == 1

    def test_replace_schedule_logs_a_schedule_change_for_each_removed_session(self, admin_client, new_program):
        old = admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-08-06",
            "start_time": "09:00", "end_time": "10:00", "mentor_name": "Logged_Mentor", "topic": "Old",
        }).json()
        files = {"file": ("schedule.xlsx", _schedule_xlsx_bytes(), XLSX_CT)}
        admin_client.post(f"/api/programs/{new_program['id']}/schedule/replace", files=files)
        r = admin_client.get("/api/schedule-changes/recent")
        assert any(c["session_id"] == old["id"] and c["change_type"] == "removed" for c in r.json()["changes"])
