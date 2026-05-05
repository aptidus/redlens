"""
QR code login manager for XHS (小红书).
Spawns a headless Playwright browser, navigates to XHS, extracts the QR code,
polls for login completion, then returns the full cookie string.
"""
import asyncio
import json
import logging
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-setuid-sandbox",
    "--no-first-run",
    "--no-zygote",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--mute-audio",
]

XHS_URL = "https://www.xiaohongshu.com"
LOGIN_BTN_SELECTOR = "xpath=//*[@id='app']/div[1]/div[2]/div[1]/ul/div[1]/button"
QR_IMG_SELECTOR = "xpath=//img[@class='qrcode-img']"
LOGGED_IN_SELECTOR = "xpath=//a[contains(@href, '/user/profile/')]//span[text()='我']"
QR_TIMEOUT_S = 120  # seconds before QR expires


async def xhs_qr_login() -> AsyncGenerator[dict, None]:
    """
    Async generator yielding SSE-ready event dicts:
      {"event": "qr",            "data": "<img src base64 or url>"}
      {"event": "authenticated",  "data": json with cookie string + username}
      {"event": "error",          "data": json with message}
      {"event": "status",         "data": json with message}
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        yield {"event": "error", "data": json.dumps({"message": "Playwright not installed. Run: playwright install chromium"})}
        return

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=BROWSER_ARGS)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        try:
            yield {"event": "status", "data": json.dumps({"message": "Opening 小红书…"})}
            await page.goto(XHS_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)

            # Snapshot web_session before login for change detection
            cookies_before = await context.cookies()
            initial_session = next((c["value"] for c in cookies_before if c["name"] == "web_session"), "")

            # Try clicking login button if login modal isn't already open
            try:
                login_btn = page.locator(LOGIN_BTN_SELECTOR)
                await login_btn.click(timeout=4000)
                await asyncio.sleep(1)
            except Exception:
                logger.info("Login button not found or already on login page")

            # Find the QR code image
            try:
                qr_el = await page.wait_for_selector(QR_IMG_SELECTOR, timeout=10000)
            except Exception:
                yield {"event": "error", "data": json.dumps({"message": "Could not find XHS QR code. The page may have changed."})}
                return

            qr_src = await qr_el.get_attribute("src") or ""
            if not qr_src:
                # Fallback: screenshot the element
                qr_bytes = await qr_el.screenshot()
                import base64
                qr_src = "data:image/png;base64," + base64.b64encode(qr_bytes).decode()

            yield {"event": "qr", "data": json.dumps({"image": qr_src})}
            yield {"event": "status", "data": json.dumps({"message": "Scan with 小红书 app → Me → Scan QR"})}

            # Poll for login success
            for elapsed in range(QR_TIMEOUT_S):
                await asyncio.sleep(1)

                # Check 1: web_session changed
                current_cookies = await context.cookies()
                current_session = next((c["value"] for c in current_cookies if c["name"] == "web_session"), "")
                if current_session and current_session != initial_session:
                    await _finish_login(context, page, current_cookies)
                    cookie_str, username = await _extract_session(context, page)
                    yield {"event": "authenticated", "data": json.dumps({"cookie": cookie_str, "username": username})}
                    return

                # Check 2: profile link visible (logged in UI element)
                try:
                    if await page.is_visible(LOGGED_IN_SELECTOR, timeout=300):
                        cookie_str, username = await _extract_session(context, page)
                        yield {"event": "authenticated", "data": json.dumps({"cookie": cookie_str, "username": username})}
                        return
                except Exception:
                    pass

                # Refresh QR countdown every 10s
                remaining = QR_TIMEOUT_S - elapsed
                if elapsed % 10 == 5:
                    yield {"event": "status", "data": json.dumps({"message": f"Waiting for scan… {remaining}s remaining"})}

            yield {"event": "error", "data": json.dumps({"message": "QR code expired after 2 minutes. Click refresh to try again."})}

        finally:
            await browser.close()


async def _finish_login(context, page, cookies) -> None:
    """Wait a moment for redirect after login detected."""
    await asyncio.sleep(3)


async def _extract_session(context, page) -> tuple[str, str]:
    """Extract cookie string and try to get username."""
    cookies = await context.cookies()
    cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("value"))

    # Try to get username from page
    username = ""
    try:
        # Look for profile href like /user/profile/USERID
        el = page.locator("a[href*='/user/profile/']").first
        href = await el.get_attribute("href", timeout=2000) or ""
        # Could also look for the nickname text
        nick_el = page.locator(".user-nickname, .nickname, [class*='nickname']").first
        username = (await nick_el.inner_text(timeout=1000)).strip()
    except Exception:
        pass

    return cookie_str, username
