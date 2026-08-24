"""Unit tests for schedule_parser.py — Excel schedule -> session list."""
import io
import sys
from pathlib import Path

import openpyxl
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from schedule_parser import (
    _cell_str, _find_header_row, _find_col, _find_columns, _cell,
    _parse_start_end, _parse_duration, _parse_mentors, parse_schedule,
)


def _wb_bytes(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestCellStr:
    def test_none_becomes_empty(self):
        assert _cell_str(None) == ""

    def test_strips_whitespace(self):
        assert _cell_str("  hello  ") == "hello"

    def test_non_string_stringified(self):
        assert _cell_str(42) == "42"


class TestFindHeaderRow:
    def test_finds_row_with_date_and_topic(self):
        rows = [
            ["Program Schedule"],
            ["Date", "Start Time", "End Time", "Topic", "Mentor"],
            ["2026-05-22", "10:00", "11:00", "Intro", "John"],
        ]
        assert _find_header_row(rows) == 1

    def test_defaults_to_zero_when_not_found(self):
        rows = [["a", "b"], ["c", "d"]]
        assert _find_header_row(rows) == 0

    def test_only_scans_first_15_rows(self):
        rows = [["filler"] for _ in range(20)]
        rows[16] = ["Date", "Session Time"]
        assert _find_header_row(rows) == 0


class TestFindCol:
    def test_finds_matching_column(self):
        header = ["date", "start time", "end time"]
        assert _find_col(header, "start") == 1

    def test_returns_none_when_absent(self):
        header = ["date", "topic"]
        assert _find_col(header, "mentor") is None

    def test_multiple_keys_first_match_wins(self):
        header = ["module", "date"]
        assert _find_col(header, "topic", "module") == 0


class TestFindColumns:
    def test_identifies_all_columns_and_multiple_mentor_cols(self):
        header = ["date", "start time", "end time", "topic", "duration", "mentor 1", "trainer"]
        cols = _find_columns(header)
        assert cols["date"] == 0
        assert cols["start"] == 1
        assert cols["end"] == 2
        assert cols["topic"] == 3
        assert cols["duration"] == 4
        assert cols["mentor_cols"] == [5, 6]

    def test_missing_columns_are_none(self):
        header = ["date"]
        cols = _find_columns(header)
        assert cols["start"] is None
        assert cols["mentor_cols"] == []


class TestCell:
    def test_none_col_returns_none(self):
        assert _cell(["a", "b"], None) is None

    def test_out_of_range_returns_none(self):
        assert _cell(["a"], 5) is None

    def test_valid_index(self):
        assert _cell(["a", "b"], 1) == "b"


class TestParseStartEnd:
    def test_separate_start_end_columns(self):
        cols = {"start": 0, "end": 1, "time": None}
        assert _parse_start_end(["10:00 AM", "11:30 AM"], cols) == ("10:00", "11:30")

    def test_combined_time_range_column(self):
        cols = {"start": None, "end": None, "time": 0}
        assert _parse_start_end(["10:00 AM - 11:30 AM"], cols) == ("10:00", "11:30")

    def test_range_with_en_dash(self):
        cols = {"start": None, "end": None, "time": 0}
        assert _parse_start_end(["10:00 AM – 11:30 AM"], cols) == ("10:00", "11:30")

    def test_range_with_to_separator(self):
        cols = {"start": None, "end": None, "time": 0}
        assert _parse_start_end(["10:00 AM to 11:30 AM"], cols) == ("10:00", "11:30")

    def test_completely_unparseable_defaults_to_midnight(self):
        cols = {"start": None, "end": None, "time": None}
        assert _parse_start_end([], cols) == ("00:00", "00:00")

    def test_end_falls_back_to_start_when_only_start_found(self):
        cols = {"start": 0, "end": 1, "time": None}
        assert _parse_start_end(["10:00 AM", None], cols) == ("10:00", "10:00")


class TestParseDuration:
    def test_none_col_returns_none(self):
        cols = {"duration": None}
        assert _parse_duration(["x"], cols) is None

    def test_blank_value_returns_none(self):
        cols = {"duration": 0}
        assert _parse_duration(["   "], cols) is None

    def test_numeric_value_rounds_to_2dp(self):
        cols = {"duration": 0}
        assert _parse_duration([1.5], cols) == 1.5
        assert _parse_duration([2], cols) == 2.0

    def test_plain_numeric_string_is_hours(self):
        cols = {"duration": 0}
        assert _parse_duration(["1.5"], cols) == 1.5

    def test_token_duration_string_converted_to_hours(self):
        cols = {"duration": 0}
        assert _parse_duration(["1h 30m"], cols) == 1.5


class TestParseMentors:
    def test_single_mentor(self):
        cols = {"mentor_cols": [0]}
        assert _parse_mentors(["John Doe"], cols) == ["John Doe"]

    def test_comma_and_slash_separated_multi_mentor(self):
        cols = {"mentor_cols": [0]}
        assert _parse_mentors(["John Doe, Jane Roe/Bob Smith"], cols) == ["John Doe", "Jane Roe", "Bob Smith"]

    def test_multiple_mentor_columns_combined(self):
        cols = {"mentor_cols": [0, 1]}
        assert _parse_mentors(["John", "Jane"], cols) == ["John", "Jane"]

    def test_no_mentor_columns_returns_blank_placeholder(self):
        cols = {"mentor_cols": []}
        assert _parse_mentors(["x"], cols) == [""]

    def test_empty_cells_skipped(self):
        cols = {"mentor_cols": [0, 1]}
        assert _parse_mentors(["", "Jane"], cols) == ["Jane"]


class TestParseSchedule:
    def test_empty_workbook_returns_empty_list(self):
        wb = openpyxl.Workbook()
        buf = io.BytesIO()
        wb.save(buf)
        assert parse_schedule(buf.getvalue()) == []

    def test_basic_schedule_single_mentor(self):
        rows = [
            ["Date", "Start Time", "End Time", "Topic", "Mentor"],
            ["2026-05-22", "10:00 AM", "11:30 AM", "Intro to Testing", "John Doe"],
        ]
        sessions = parse_schedule(_wb_bytes(rows))
        assert len(sessions) == 1
        s = sessions[0]
        assert s["date"] == "2026-05-22"
        assert s["start_time"] == "10:00"
        assert s["end_time"] == "11:30"
        assert s["topic"] == "Intro to Testing"
        assert s["mentor_name"] == "John Doe"

    def test_multi_mentor_row_expands_to_multiple_sessions(self):
        rows = [
            ["Date", "Start Time", "End Time", "Topic", "Mentor"],
            ["2026-05-22", "10:00 AM", "11:30 AM", "Pairing", "John Doe, Jane Roe"],
        ]
        sessions = parse_schedule(_wb_bytes(rows))
        assert len(sessions) == 2
        assert {s["mentor_name"] for s in sessions} == {"John Doe", "Jane Roe"}

    def test_rows_with_unparseable_date_are_skipped(self):
        rows = [
            ["Date", "Start Time", "End Time", "Topic", "Mentor"],
            ["not a date", "10:00 AM", "11:30 AM", "Intro", "John"],
            ["2026-05-23", "10:00 AM", "11:30 AM", "Intro 2", "John"],
        ]
        sessions = parse_schedule(_wb_bytes(rows))
        assert len(sessions) == 1
        assert sessions[0]["date"] == "2026-05-23"

    def test_none_rows_skipped(self):
        # openpyxl can yield an all-None row for a fully blank row within range.
        rows = [
            ["Date", "Start Time", "End Time", "Topic", "Mentor"],
            [None, None, None, None, None],
            ["2026-05-23", "10:00 AM", "11:30 AM", "Intro", "John"],
        ]
        sessions = parse_schedule(_wb_bytes(rows))
        assert len(sessions) == 1

    def test_combined_time_range_column_schedule(self):
        rows = [
            ["Date", "Session Time", "Topic", "Trainer"],
            ["2026-05-22", "10:00 AM - 11:30 AM", "Intro", "John"],
        ]
        sessions = parse_schedule(_wb_bytes(rows))
        assert len(sessions) == 1
        assert sessions[0]["start_time"] == "10:00"
        assert sessions[0]["end_time"] == "11:30"

    def test_duration_column_parsed(self):
        rows = [
            ["Date", "Start Time", "End Time", "Topic", "Mentor", "Duration (hrs)"],
            ["2026-05-22", "10:00 AM", "11:30 AM", "Intro", "John", "1.5"],
        ]
        sessions = parse_schedule(_wb_bytes(rows))
        assert sessions[0]["duration"] == 1.5
