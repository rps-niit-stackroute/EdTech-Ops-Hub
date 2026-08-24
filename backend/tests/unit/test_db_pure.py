"""Unit tests for db.py's pure/sync helpers. seed_if_empty is async and DB-backed
(needs a Mongo test double), so it's out of scope here."""
import sys
import uuid
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import db


class TestNewId:
    def test_returns_valid_uuid_string(self):
        value = db.new_id()
        assert isinstance(value, str)
        uuid.UUID(value)  # raises ValueError if not a valid UUID

    def test_calls_are_unique(self):
        assert db.new_id() != db.new_id()


class TestNowIso:
    def test_returns_parseable_iso_timestamp_with_offset(self):
        value = db.now_iso()
        parsed = datetime.fromisoformat(value)
        assert parsed.tzinfo is not None
