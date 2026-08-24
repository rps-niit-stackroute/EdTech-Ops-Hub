"""Integration tests for /api/sow* and /api/provision* routes."""
import io

import openpyxl

XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _make_session(admin_client, program_id, mentor_name, month="09", day="01", topic="SOW Session"):
    r = admin_client.post("/api/sessions", json={
        "program_id": program_id, "date": f"2026-{month}-{day}",
        "start_time": "10:00", "end_time": "11:00", "mentor_name": mentor_name, "topic": topic,
    })
    assert r.status_code == 200, r.text
    return r.json()


class TestSowPreviewAndDownload:
    def test_sow_preview(self, admin_client, new_program):
        _make_session(admin_client, new_program["id"], "SOW_Mentor_A")
        r = admin_client.get("/api/sow", params={"month": "9", "year": 2026})
        assert r.status_code == 200
        d = r.json()
        assert "grouped" in d and "grand_total" in d and "month_label" in d and "changes" in d
        assert d["grand_total"]["sessions"] >= 1
        mentor_row = next(g for g in d["grouped"] if g["mentor"] == "SOW_Mentor_A")
        assert mentor_row["subtotal_sessions"] >= 1

    def test_sow_month_name_also_accepted(self, admin_client, new_program):
        _make_session(admin_client, new_program["id"], "SOW_Mentor_MonthName", month="10")
        r = admin_client.get("/api/sow", params={"month": "October", "year": 2026})
        assert r.status_code == 200
        assert r.json()["month_label"] == "October 2026"

    def test_sow_download_produces_xlsx(self, admin_client, new_program):
        _make_session(admin_client, new_program["id"], "SOW_Download_Mentor", month="11")
        r = admin_client.get("/api/sow/download", params={"month": "11", "year": 2026})
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers["content-type"]
        wb = openpyxl.load_workbook(io.BytesIO(r.content))
        assert len(wb.sheetnames) >= 1

    def test_sow_download_with_previous_sow_diff(self, admin_client, new_program):
        _make_session(admin_client, new_program["id"], "SOW_Diff_Mentor", month="12")
        r1 = admin_client.get("/api/sow/download", params={"month": "12", "year": 2026})
        prev_bytes = r1.content

        _make_session(admin_client, new_program["id"], "SOW_Diff_Mentor", month="12", day="15", topic="Second")
        files = {"previous_sow": ("prev.xlsx", prev_bytes, XLSX_CT)}
        r2 = admin_client.post("/api/sow/download", params={"month": "12", "year": 2026}, files=files)
        assert r2.status_code == 200
        assert "spreadsheetml" in r2.headers["content-type"]

    def test_sow_history_lists_downloaded_sows(self, admin_client, new_program):
        _make_session(admin_client, new_program["id"], "SOW_History_Mentor", month="09", day="20")
        admin_client.get("/api/sow/download", params={"month": "9", "year": 2026})
        r = admin_client.get("/api/sow/history")
        assert r.status_code == 200
        assert len(r.json()["history"]) >= 1

    def test_sow_filtered_by_mentor(self, admin_client, new_program):
        _make_session(admin_client, new_program["id"], "Filter_Mentor_One", month="09", day="05")
        _make_session(admin_client, new_program["id"], "Filter_Mentor_Two", month="09", day="06")
        r = admin_client.get("/api/sow", params={"month": "9", "year": 2026, "mentors": "Filter_Mentor_One"})
        mentors_seen = {g["mentor"] for g in r.json()["grouped"]}
        assert "Filter_Mentor_One" in mentors_seen
        assert "Filter_Mentor_Two" not in mentors_seen

    def test_sow_hours_use_actual_start_end_time_not_a_stray_duration_field(self, admin_client, new_program):
        # A session imported from a schedule upload can carry a stray `duration`
        # field (e.g. a mismatched "Total Hours" column) that has nothing to do
        # with its own Start/End Time. SOW billing must go by the clock time on
        # the schedule (10:00-12:00 = 2h) and ignore that stored duration (6),
        # not the other way around.
        admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-09-15",
            "start_time": "10:00", "end_time": "12:00", "duration": 6,
            "mentor_name": "Duration_Mismatch_Mentor", "topic": "Indium-style session",
        })
        r = admin_client.get("/api/sow", params={"month": "9", "year": 2026})
        assert r.status_code == 200
        row = next(g for g in r.json()["grouped"] if g["mentor"] == "Duration_Mismatch_Mentor")
        assert row["subtotal_hours"] == 2.0

    def test_sow_hours_fall_back_to_duration_when_start_end_time_missing(self, admin_client, new_program):
        # The stored duration is still useful as a fallback for a session that
        # genuinely has no usable start/end time at all.
        admin_client.post("/api/sessions", json={
            "program_id": new_program["id"], "date": "2026-09-16",
            "start_time": "", "end_time": "", "duration": 3,
            "mentor_name": "No_Clock_Time_Mentor", "topic": "Fallback session",
        })
        r = admin_client.get("/api/sow", params={"month": "9", "year": 2026})
        row = next(g for g in r.json()["grouped"] if g["mentor"] == "No_Clock_Time_Mentor")
        assert row["subtotal_hours"] == 3.0

    def test_sow_reports_schedule_changes(self, admin_client, new_program):
        _make_session(admin_client, new_program["id"], "SOW_Change_Mentor", month="09", day="10")
        admin_client.get("/api/sow/download", params={"month": "9", "year": 2026})
        _make_session(admin_client, new_program["id"], "SOW_Change_Mentor", month="09", day="11", topic="Extra")
        r = admin_client.get("/api/sow", params={"month": "9", "year": 2026})
        assert r.status_code == 200
        assert isinstance(r.json()["changes"], list)


class TestProvisionMentors:
    def test_list_provision_mentors_seeded(self, admin_client):
        r = admin_client.get("/api/provision/mentors")
        assert r.status_code == 200
        assert len(r.json()) > 0

    def test_add_edit_delete_provision_mentor(self, admin_client):
        r = admin_client.post("/api/provision/mentors", json={"name": "Prov Test Mentor", "cost_per_hour": 500})
        assert r.status_code == 200, r.text
        mid = r.json()["id"]

        r2 = admin_client.put(f"/api/provision/mentors/{mid}", json={"cost_per_hour": 600})
        assert r2.status_code == 200

        r3 = admin_client.delete(f"/api/provision/mentors/{mid}")
        assert r3.status_code == 200

    def test_edit_missing_provision_mentor_404(self, admin_client):
        r = admin_client.put("/api/provision/mentors/does-not-exist", json={"cost_per_hour": 1})
        assert r.status_code == 404

    def test_delete_missing_provision_mentor_404(self, admin_client):
        r = admin_client.delete("/api/provision/mentors/does-not-exist")
        assert r.status_code == 404

    def test_provision_mentors_requires_admin(self, client, admin_client):
        # Temporarily switch the shared client to a team_member session.
        r = admin_client.post("/api/users", json={
            "username": "prov_tm_test", "password": "teammem123", "name": "TM", "role": "team_member",
        })
        if r.status_code == 409:
            pass  # already exists from a previous run in this session; fine
        try:
            client.post("/api/auth/login", json={"username": "prov_tm_test", "password": "teammem123"})
            r2 = client.get("/api/provision/mentors")
            assert r2.status_code == 403
        finally:
            client.post("/api/auth/login", json={"username": "admin", "password": "TestAdminPass123"})


class TestProvisionReport:
    def test_provision_report_bills_provision_mentors_only(self, admin_client, new_program):
        prov = admin_client.post("/api/provision/mentors",
                                 json={"name": "Provision_Billed_Mentor", "cost_per_hour": 1000})
        pmid = prov.json()["id"]
        _make_session(admin_client, new_program["id"], "Provision_Billed_Mentor", month="09", day="25")
        _make_session(admin_client, new_program["id"], "Regular_SOW_Mentor", month="09", day="25")

        r = admin_client.get("/api/provision", params={"month": "9", "year": 2026})
        assert r.status_code == 200
        d = r.json()
        mentors_billed = {row["mentor"] for row in d["rows"]}
        assert "Provision_Billed_Mentor" in mentors_billed
        assert "Regular_SOW_Mentor" not in mentors_billed

        # and the regular SOW should exclude the provision mentor
        r2 = admin_client.get("/api/sow", params={"month": "9", "year": 2026})
        sow_mentors = {g["mentor"] for g in r2.json()["grouped"]}
        assert "Provision_Billed_Mentor" not in sow_mentors
        assert "Regular_SOW_Mentor" in sow_mentors

        admin_client.delete(f"/api/provision/mentors/{pmid}")

    def test_provision_download_xlsx(self, admin_client, new_program):
        prov = admin_client.post("/api/provision/mentors",
                                 json={"name": "Provision_DL_Mentor", "cost_per_hour": 800})
        pmid = prov.json()["id"]
        _make_session(admin_client, new_program["id"], "Provision_DL_Mentor", month="09", day="26")
        r = admin_client.get("/api/provision/download", params={"month": "9", "year": 2026})
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers["content-type"]
        admin_client.delete(f"/api/provision/mentors/{pmid}")

    def test_provision_charges_add_and_delete(self, admin_client):
        r = admin_client.post("/api/provision/charges", json={
            "month": "9", "year": 2026, "trainer": "Vendor Co",
            "description": "Monthly retainer", "total_cost": 5000,
        })
        assert r.status_code == 200, r.text
        cid = r.json()["id"]

        r2 = admin_client.get("/api/provision", params={"month": "9", "year": 2026})
        assert any(c["id"] == cid for c in r2.json()["charges"])

        r3 = admin_client.delete(f"/api/provision/charges/{cid}")
        assert r3.status_code == 200

    def test_delete_missing_provision_charge_404(self, admin_client):
        r = admin_client.delete("/api/provision/charges/does-not-exist")
        assert r.status_code == 404
