import httpx
import re
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

ACCOUNTS_FILE = "./accounts.txt"
SITE_URL = "https://reelmind.ai"
LOGIN_BUTTON_TEXTS = ["登入", "登录", "Log in", "Log In", "Sign in", "Sign In"]
SUBMIT_TEXTS = ["注册", "Sign up", "Sign Up", "Create account", "Continue"]


def step(index: int, total: int, message: str):
    print(f"[{index}/{total}] {message}")


def get_accounts():
    result = []
    # format example: RomelAnakin2293@outlook.com----lo766333----https://api.nineemail.com/token=98afc713600c409ca61efdba7940bb34
    with open(ACCOUNTS_FILE, "r") as f:
        accounts = f.readlines()
        for account in accounts:
            email, password, token_url = account.strip().split("----")
            result.append((email, password, token_url))
    return result


def parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def get_check_url(token_url: str, since: str | None = None, max_retries: int = 12, retry_interval: int = 5):
    token = token_url.split("=")[1]
    res1 = httpx.get("https://api.nineemail.com/api/get?token=" + token).json()
    rt = res1["data"]["refresh_token"]
    mail: str = res1["data"]["email"]
    encoded_mail = mail.replace("@", "%40")
    client_id = res1["data"]["client_id"]
    since_dt = parse_iso(since) if since else None

    for attempt in range(max_retries):
        try:
            mail_res = httpx.get(
                f"https://api.nineemail.com/api/proxy?endpoint=mail-new&refresh_token={rt}&client_id={client_id}&email={encoded_mail}&mailbox=Junk&response_type=json"
            )
        except Exception as e:
            print(f"Error occurred while fetching mail for {mail}: {e}")
            if attempt < max_retries - 1:
                time.sleep(retry_interval)
                continue
            return None

        data: list[dict] = mail_res.json().get("data") or []
        # example data: [{"send":"","subject":"","text":"","html":"","date":""}]
        data = [d for d in data if "team <team@resend.reelmind.ai>" == d.get("send")]

        if since_dt:
            fresh = []
            for d in data:
                d_date = d.get("date")
                if not d_date:
                    continue
                try:
                    if parse_iso(d_date) > since_dt:
                        fresh.append(d)
                except Exception:
                    fresh.append(d)
            data = fresh

        if data:
            data.sort(key=lambda d: d.get("date") or "", reverse=True)
            text = data[0].get("text") or ""
            match = re.search(r"https?://[^\s\]]+", text)
            if match:
                return match.group(0)

        if attempt < max_retries - 1:
            print(f"  No fresh confirmation email yet, retrying ({attempt + 1}/{max_retries})...")
            time.sleep(retry_interval)

    return None


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


def click_first_visible(page, texts, timeout=10000, roles=("button", "link", "tab"), exact=False):
    for role in roles:
        for text in texts:
            locator = page.get_by_role(role, name=text, exact=exact).first
            try:
                locator.wait_for(state="visible", timeout=timeout)
                locator.click()
                return True
            except PlaywrightTimeoutError:
                continue
    return False


def open_auth_modal(page):
    for text in LOGIN_BUTTON_TEXTS:
        locator = page.get_by_role("button", name=text, exact=False).first
        try:
            locator.wait_for(state="visible", timeout=15000)
            locator.click()
            return
        except PlaywrightTimeoutError:
            continue
    raise RuntimeError("Could not find the login button to open the auth modal")


def fill_signup_form(page, email, password):
    email_input = page.locator("#email")
    email_input.wait_for(state="visible", timeout=10000)
    email_input.fill(email)

    password_input = page.locator("#password")
    password_input.wait_for(state="visible", timeout=10000)
    password_input.fill(password)


def submit_signup(page):
    submitted = click_first_visible(page, SUBMIT_TEXTS, timeout=10000, roles=("button",), exact=True)
    if not submitted:
        try:
            page.locator("form:has(#email) button[type='submit']").click()
            submitted = True
        except PlaywrightTimeoutError:
            pass
    if not submitted:
        try:
            page.keyboard.press("Enter")
            submitted = True
        except Exception:
            submitted = False
    return submitted


def is_logged_in(page) -> bool:
    try:
        result = page.evaluate(
            "(() => { try { const r = localStorage.getItem('auth-storage'); "
            "if (!r) return false; return JSON.parse(r)?.state?.isAuthenticated === true; "
            "} catch { return false; } })()"
        )
        return bool(result)
    except Exception:
        return False


def register_account(page, email, password, token_url, index, total):
    step(index, total, f"opening {SITE_URL}")
    page.goto(SITE_URL, wait_until="domcontentloaded")
    step(index, total, "opening auth modal via login button")
    open_auth_modal(page)
    step(index, total, f"filling signup form for {email}")
    fill_signup_form(page, email, password)

    submit_time = datetime.now(timezone.utc).isoformat()
    step(index, total, "submitting signup form")
    if not submit_signup(page):
        print(f"Could not submit signup form for {email}")
        return

    time.sleep(3)
    if is_logged_in(page):
        step(index, total, f"account already registered, logged in as {email}")
        return

    step(index, total, f"signup submitted for {email}, waiting for confirmation email...")
    step(index, total, "fetching confirmation link from mailbox")
    check_url = get_check_url(token_url, since=submit_time)
    if not check_url:
        print(f"Failed to get check URL for {email}")
        return
    step(index, total, f"navigating to confirmation link: {check_url}")
    page.goto(check_url, wait_until="domcontentloaded")
    step(index, total, f"confirmation done, final URL: {page.url}")


def register(accounts: list[tuple[str, str, str]]):
    total = len(accounts)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=300)
        for index, (email, password, token_url) in enumerate(accounts, 1):
            step(index, total, f"=== start {email} ===")
            context = browser.new_context()
            page = context.new_page()
            try:
                register_account(page, email, password, token_url, index, total)
            except Exception as e:
                print(format_registration_error(email, e))
            finally:
                context.close()
                step(index, total, f"=== finished {email} ===")
        browser.close()


if __name__ == "__main__":
    accounts = get_accounts()
    register(accounts)
