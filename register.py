import httpx
import secrets
import hashlib
import base64
import time
import re
import traceback
from pathlib import Path

ACCOUNTS_FILE = "./accounts.txt"
SUPABASE_PUBLIC_KEY = "sb_publishable_Oeql6-nxTd5RIa1tjlCMKw_O1v3aZD2"
REGISTER_URL = "https://ucljsqjaggrhupdayakz.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Freelmind.ai%2Fauth%2Fcallback"
SUPABASE_HEADERS = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_PUBLIC_KEY,
    "Authorization": f"Bearer {SUPABASE_PUBLIC_KEY}",
}


def get_accounts():
    result = []
    # format example: RomelAnakin2293@outlook.com----lo766333----https://api.nineemail.com/token=98afc713600c409ca61efdba7940bb34
    with open(ACCOUNTS_FILE, "r") as f:
        accounts = f.readlines()
        for account in accounts:
            email, password, token_url = account.strip().split("----")
            result.append((email, password, token_url))
    return result


def create_token_and_challenge():
    code_verifier = secrets.token_hex(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return code_verifier, code_challenge


def get_check_url(token_url: str):
    token = token_url.split("=")[1]
    res1 = httpx.get("https://api.nineemail.com/api/get?token=" + token).json()
    rt = res1["data"]["refresh_token"]
    mail: str = res1["data"]["email"]
    encoded_mail = mail.replace("@", "%40")
    client_id = res1["data"]["client_id"]
    try:
        mail_res = httpx.get(
            f"https://api.nineemail.com/api/proxy?endpoint=mail-new&refresh_token={rt}&client_id={client_id}&email={encoded_mail}&mailbox=Junk&response_type=json"
        )
    except Exception as e:
        print(f"Error occurred while fetching mail for {mail}: {e}")
        return None
    data: list[dict] = mail_res.json().get("data") or []
    # example data: [{"send":"","subject":"","text":"","html":"","date":""}]
    data = [d for d in data if "team <team@resend.reelmind.ai>" == d.get("send")]
    if not data:
        return None
    text = data[0].get("text") or ""
    match = re.search(r"https?://[^\s\]]+", text)
    return match.group(0) if match else None


def format_registration_error(email: str, exc: Exception):
    frames = traceback.extract_tb(exc.__traceback__)
    if frames:
        script_name = Path(__file__).name
        frame = next(
            (f for f in reversed(frames) if Path(f.filename).name == script_name),
            frames[-1],
        )
        location = f"{Path(frame.filename).name}:{frame.lineno}"
    else:
        location = "unknown:0"
    return (
        f"Error occurred while registering {email} at "
        f"{location}: {type(exc).__name__}: {exc}"
    )


def print_confirmation_response(email: str, response):
    print(f"Email confirmation request for {email}: HTTP {response.status_code}")
    location = response.headers.get("location")
    if location:
        print(f"Redirected to: {location}")


def register(accounts: list[tuple[str, str, str]]):
    for email, password, token_url in accounts:
        try:
            code_verifier, code_challenge = create_token_and_challenge()
            request_json = {
                "email": email,
                "password": password,
                "goture_meta_security": {},
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
            request_cookies = {
                "sb-ucljsqjaggrhupdayakz-auth-token-code-verifier": code_verifier
            }

            response = httpx.post(
                REGISTER_URL,
                json=request_json,
                cookies=request_cookies,
                headers=SUPABASE_HEADERS,
            )
            print(response_json := response.json())
            if not response.is_success:
                print(f"Signup failed for {email}: HTTP {response.status_code}")
                continue
            time.sleep(2)
            check_url = get_check_url(token_url)
            if check_url:
                response = httpx.get(
                    check_url, cookies=request_cookies, follow_redirects=False
                )
                print_confirmation_response(email, response)
            else:
                print(f"Failed to get check URL for {email}")
        except Exception as e:
            print(format_registration_error(email, e))


if __name__ == "__main__":
    accounts = get_accounts()
    register(accounts)
