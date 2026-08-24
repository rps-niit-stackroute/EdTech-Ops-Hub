"""Unit tests for logic.py's pure/sync helpers — health scoring color bands and
session-overlap detection. Async DB-backed functions (compute_health, check_availability,
SOW snapshot/history, Provision CRUD, etc.) need a Mongo test double and are out of
scope here."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import logic


class TestHealthColor:
    def test_green_at_and_above_75(self):
        assert logic.health_color(75) == "green"
        assert logic.health_color(100) == "green"

    def test_amber_between_50_and_75(self):
        assert logic.health_color(50) == "amber"
        assert logic.health_color(74.9) == "amber"

    def test_red_below_50(self):
        assert logic.health_color(0) == "red"
        assert logic.health_color(49.9) == "red"


class TestOverlap:
    def test_overlapping_ranges(self):
        assert logic._overlap(60, 120, 90, 150) is True

    def test_adjacent_ranges_do_not_overlap(self):
        # end of A == start of B is treated as non-overlapping (back-to-back sessions)
        assert logic._overlap(60, 120, 120, 180) is False

    def test_non_overlapping_ranges(self):
        assert logic._overlap(60, 120, 200, 260) is False

    def test_fully_contained_range_overlaps(self):
        assert logic._overlap(60, 180, 90, 120) is True


class TestEscape:
    def test_escapes_regex_special_characters(self):
        assert logic._escape("a.b*c") == r"a\.b\*c"

    def test_plain_alnum_unaffected(self):
        assert logic._escape("plaintext123") == "plaintext123"


class TestDefaultProvisionMentors:
    def test_is_a_non_empty_list_of_strings(self):
        assert isinstance(logic.DEFAULT_PROVISION_MENTORS, list)
        assert len(logic.DEFAULT_PROVISION_MENTORS) > 0
        assert all(isinstance(m, str) for m in logic.DEFAULT_PROVISION_MENTORS)
