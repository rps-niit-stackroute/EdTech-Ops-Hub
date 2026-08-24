"""Unit tests for auth.py's pure/sync helpers — password hashing, JWT, brute-force
lockout bookkeeping, and cookie helpers. Async DB-backed functions (get_user_by_*,
create_user, seed_admin, etc.) need a Mongo test double and are out of scope here."""
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

import jwt
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import auth


class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        assert auth.hash_password("secret123") != "secret123"

    def test_verify_correct_password(self):
        h = auth.hash_password("secret123")
        assert auth.verify_password("secret123", h) is True

    def test_verify_wrong_password(self):
        h = auth.hash_password("secret123")
        assert auth.verify_password("wrong", h) is False

    def test_verify_garbage_hash_returns_false_not_exception(self):
        assert auth.verify_password("secret123", "not-a-real-bcrypt-hash") is False

    def test_hashes_are_salted_and_differ(self):
        h1 = auth.hash_password("secret123")
        h2 = auth.hash_password("secret123")
        assert h1 != h2


class TestLoginLockout:
    def setup_method(self):
        auth._failed_logins.clear()

    def test_not_locked_out_initially(self):
        assert auth.is_locked_out("newuser") is False

    def test_locked_out_after_max_attempts(self):
        for _ in range(auth.MAX_LOGIN_ATTEMPTS):
            auth.record_failed_login("baduser")
        assert auth.is_locked_out("baduser") is True

    def test_not_locked_out_below_max_attempts(self):
        for _ in range(auth.MAX_LOGIN_ATTEMPTS - 1):
            auth.record_failed_login("almostbad")
        assert auth.is_locked_out("almostbad") is False

    def test_clear_failed_logins_resets_lockout(self):
        for _ in range(auth.MAX_LOGIN_ATTEMPTS):
            auth.record_failed_login("cleared_user")
        auth.clear_failed_logins("cleared_user")
        assert auth.is_locked_out("cleared_user") is False

    def test_old_attempts_outside_window_dont_count(self):
        # Simulate attempts far enough in the past to be outside the lockout window.
        now = time.time()
        auth._failed_logins["stale_user"] = [now - auth.LOGIN_LOCKOUT_SECONDS - 10] * auth.MAX_LOGIN_ATTEMPTS
        assert auth.is_locked_out("stale_user") is False


class TestAccessToken:
    def test_create_and_decode_round_trip(self, monkeypatch):
        monkeypatch.setenv("JWT_SECRET", "test-secret-key-that-is-long-enough-32b")
        user = {"id": "u1", "username": "john", "role": "admin"}
        token = auth.create_access_token(user)
        payload = jwt.decode(token, "test-secret-key-that-is-long-enough-32b", algorithms=[auth.JWT_ALGORITHM])
        assert payload["sub"] == "u1"
        assert payload["username"] == "john"
        assert payload["role"] == "admin"
        assert payload["type"] == "access"

    def test_token_rejected_with_wrong_secret(self, monkeypatch):
        monkeypatch.setenv("JWT_SECRET", "test-secret-key-that-is-long-enough-32b")
        token = auth.create_access_token({"id": "u1", "username": "john", "role": "admin"})
        with pytest.raises(jwt.InvalidSignatureError):
            jwt.decode(token, "wrong-secret", algorithms=[auth.JWT_ALGORITHM])


class TestCookies:
    def test_set_auth_cookie_defaults_not_secure(self, monkeypatch):
        monkeypatch.delenv("COOKIE_SECURE", raising=False)
        response = MagicMock()
        auth.set_auth_cookie(response, "tok123")
        _, kwargs = response.set_cookie.call_args
        assert kwargs["secure"] is False
        assert kwargs["httponly"] is True
        assert kwargs["value"] == "tok123"

    def test_set_auth_cookie_secure_when_enabled(self, monkeypatch):
        monkeypatch.setenv("COOKIE_SECURE", "true")
        response = MagicMock()
        auth.set_auth_cookie(response, "tok123")
        _, kwargs = response.set_cookie.call_args
        assert kwargs["secure"] is True

    def test_clear_auth_cookie(self, monkeypatch):
        monkeypatch.delenv("COOKIE_DOMAIN", raising=False)
        response = MagicMock()
        auth.clear_auth_cookie(response)
        response.delete_cookie.assert_called_once_with(
            key="access_token", path="/", domain=None, samesite="lax", secure=False)

    def test_set_auth_cookie_defaults_host_only(self, monkeypatch):
        monkeypatch.delenv("COOKIE_DOMAIN", raising=False)
        response = MagicMock()
        auth.set_auth_cookie(response, "tok123")
        _, kwargs = response.set_cookie.call_args
        assert kwargs["domain"] is None
        assert kwargs["samesite"] == "lax"

    def test_set_auth_cookie_uses_configured_domain(self, monkeypatch):
        monkeypatch.setenv("COOKIE_DOMAIN", ".niitenterprisetech.ai")
        response = MagicMock()
        auth.set_auth_cookie(response, "tok123")
        _, kwargs = response.set_cookie.call_args
        assert kwargs["domain"] == ".niitenterprisetech.ai"

    def test_clear_auth_cookie_matches_configured_domain(self, monkeypatch):
        monkeypatch.setenv("COOKIE_DOMAIN", ".niitenterprisetech.ai")
        response = MagicMock()
        auth.clear_auth_cookie(response)
        response.delete_cookie.assert_called_once_with(
            key="access_token", path="/", domain=".niitenterprisetech.ai",
            samesite="lax", secure=False)


class TestCleanUser:
    def test_strips_internal_fields(self):
        user = {"id": "u1", "username": "john", "_id": "mongo-oid", "password_hash": "xxx"}
        cleaned = auth._clean(user)
        assert "_id" not in cleaned
        assert "password_hash" not in cleaned
        assert cleaned["id"] == "u1"

    def test_none_passthrough(self):
        assert auth._clean(None) is None
