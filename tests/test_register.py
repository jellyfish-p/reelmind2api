import base64
import hashlib
import inspect
import json
import pathlib
import unittest
from unittest.mock import call, patch

import register


class FakeResponse:
    def __init__(self, json_data, status_code=200, headers=None):
        self._json_data = json_data
        self.status_code = status_code
        self.is_success = 200 <= status_code < 300
        self.headers = headers or {}

    def json(self):
        if isinstance(self._json_data, Exception):
            raise self._json_data
        return self._json_data


def _raise_test_error():
    raise ValueError("boom")


class RegisterTokenChallengeTests(unittest.TestCase):
    def test_create_token_and_challenge_hashes_verifier_bytes(self):
        verifier = "a" * 128
        expected_challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
            .decode("ascii")
            .rstrip("=")
        )

        with patch("register.secrets.token_hex", return_value=verifier):
            try:
                code_verifier, code_challenge = register.create_token_and_challenge()
            except TypeError as exc:
                self.fail(f"PKCE challenge hashing should accept verifier text: {exc}")

        self.assertEqual(code_verifier, verifier)
        self.assertEqual(code_challenge, expected_challenge)

    def test_register_error_output_includes_source_line(self):
        email = "line@example.test"
        expected_file = pathlib.Path(register.__file__).name
        register_source, register_start_line = inspect.getsourcelines(register.register)
        expected_line = next(
            register_start_line + offset
            for offset, line in enumerate(register_source)
            if "create_token_and_challenge()" in line
        )

        with (
            patch("register.create_token_and_challenge", side_effect=_raise_test_error),
            patch("builtins.print") as print_mock,
        ):
            register.register([(email, "password", "https://api.nineemail.com/token=x")])

        print_mock.assert_called_once_with(
            f"Error occurred while registering {email} at "
            f"{expected_file}:{expected_line}: ValueError: boom"
        )

    def test_register_posts_signup_with_supabase_headers(self):
        with (
            patch(
                "register.create_token_and_challenge",
                return_value=("verifier", "challenge"),
            ),
            patch("register.httpx.post", return_value=FakeResponse({"user": {}}, 200))
            as post_mock,
            patch("register.time.sleep"),
            patch("register.get_check_url", return_value=None),
            patch("builtins.print"),
        ):
            register.register(
                [("header@example.test", "password", "https://api.nineemail.com/token=x")]
            )

        _, kwargs = post_mock.call_args
        self.assertEqual(kwargs["headers"]["apikey"], register.SUPABASE_PUBLIC_KEY)
        self.assertEqual(
            kwargs["headers"]["Authorization"],
            f"Bearer {register.SUPABASE_PUBLIC_KEY}",
        )

    def test_register_skips_email_check_when_signup_fails(self):
        email = "fail@example.test"

        with (
            patch(
                "register.create_token_and_challenge",
                return_value=("verifier", "challenge"),
            ),
            patch(
                "register.httpx.post",
                return_value=FakeResponse({"message": "No API key found"}, 401),
            ),
            patch("register.get_check_url") as get_check_url_mock,
            patch("register.time.sleep") as sleep_mock,
            patch("builtins.print") as print_mock,
        ):
            register.register([(email, "password", "https://api.nineemail.com/token=x")])

        get_check_url_mock.assert_not_called()
        sleep_mock.assert_not_called()
        print_mock.assert_has_calls(
            [
                call({"message": "No API key found"}),
                call(f"Signup failed for {email}: HTTP 401"),
            ]
        )

    def test_get_check_url_returns_none_when_verification_email_is_missing(self):
        account_response = FakeResponse(
            {
                "data": {
                    "refresh_token": "refresh-token",
                    "email": "line@example.test",
                    "client_id": "client-id",
                }
            }
        )
        empty_mailbox_response = FakeResponse({"data": []})

        with patch(
            "register.httpx.get",
            side_effect=[account_response, empty_mailbox_response],
        ):
            check_url = register.get_check_url("https://api.nineemail.com/token=x")

        self.assertIsNone(check_url)

    def test_register_prints_confirmation_status_without_parsing_json(self):
        email = "confirm@example.test"
        empty_json_error = json.JSONDecodeError("Expecting value", "", 0)

        with (
            patch(
                "register.create_token_and_challenge",
                return_value=("verifier", "challenge"),
            ),
            patch("register.httpx.post", return_value=FakeResponse({"user": {}}, 200)),
            patch("register.time.sleep"),
            patch("register.get_check_url", return_value="https://auth.reelmind.ai/auth/v1/verify?token=x"),
            patch(
                "register.httpx.get",
                return_value=FakeResponse(
                    empty_json_error,
                    302,
                    {"location": "https://reelmind.ai/auth/callback"},
                ),
            ) as get_mock,
            patch("builtins.print") as print_mock,
        ):
            register.register([(email, "password", "https://api.nineemail.com/token=x")])

        _, kwargs = get_mock.call_args
        self.assertFalse(kwargs["follow_redirects"])
        print_mock.assert_has_calls(
            [
                call(f"Email confirmation request for {email}: HTTP 302"),
                call("Redirected to: https://reelmind.ai/auth/callback"),
            ]
        )


if __name__ == "__main__":
    unittest.main()
