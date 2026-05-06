"""
QR code login manager for XHS (小红书) — Playwright headless Chromium.
Navigates to xiaohongshu.com, screenshots the login QR code, and polls
for web_session cookie after the user scans on their phone.
"""
import asyncio
import base64
import json
import logging
import os
from typing import AsyncGenerator
from urllib.parse import urlparse

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

logger = logging.getLogger(__name__)

XHS_URL = "https://www.xiaohongshu.com"


def _playwright_proxy_config():
    """Build Playwright proxy dict from OXYLABS_PROXY_URL env var, or None."""
    raw = os.getenv("OXYLABS_PROXY_URL")
    if not raw:
        return None
    try:
        p = urlparse(raw)
        cfg = {"server": f"{p.scheme}://{p.hostname}:{p.port}"}
        if p.username:
            cfg["username"] = p.username
        if p.password:
            cfg["password"] = p.password
        logger.info("Playwright using proxy: %s:%s", p.hostname, p.port)
        return cfg
    except Exception as exc:
        logger.warning("Could not parse OXYLABS_PROXY_URL: %s", exc)
        return None
QR_TIMEOUT = 120  # seconds to wait for scan
QR_WAIT = 15      # seconds to wait for QR element to appear

# Selectors tried in order to locate the login QR code element
_QR_SELECTORS = [
    ".qrcode-img",
    "canvas[class*='qr']",
    "img[class*='qr']",
    ".login-container canvas",
    ".login-container img",
    "canvas",
]

_STEALTH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
]

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


async def _find_qr_bbox(page):
    """
    Find the QR's bounding box. Prefer canvas elements (always rendered square)
    and reject anything that isn't roughly 1:1 — the previous selectors matched
    a non-square wrapper which caused a clipped/stretched QR.
    """
    selectors = [
        "canvas",                        # XHS renders the QR to a canvas
        ".qrcode-img canvas",
        ".qrcode-img img",
        "img[class*='qrcode']",
        "img[class*='qr']",
        ".login-container canvas",
        ".login-container img",
        ".qrcode-img",
    ]
    for selector in selectors:
        try:
            elements = await page.query_selector_all(selector)
            for el in elements:
                try:
                    if not await el.is_visible():
                        continue
                    bbox = await el.bounding_box()
                except Exception:
                    continue
                if not bbox:
                    continue
                w, h = bbox.get("width", 0), bbox.get("height", 0)
                if w < 100 or h < 100:
                    continue
                ratio = w / h
                if 0.85 <= ratio <= 1.15:
                    logger.info(
                        "QR element accepted: selector=%s size=%.0fx%.0f", selector, w, h
                    )
                    return bbox
        except Exception as e:
            logger.debug("Selector %s error: %s", selector, e)
    logger.warning("No square QR element found across selectors")
    return None


def _cookies_to_str(cookies: list) -> str:
    """Convert Playwright cookie list to 'name=value; ...' string."""
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies)


def _has_web_session(cookies: list) -> bool:
    return any(c["name"] == "web_session" for c in cookies)


def _extract_username(cookies: list) -> str:
    """Best-effort: extract user nickname from cookies (not always present)."""
    for c in cookies:
        if c["name"] in ("nickname", "username"):
            return c["value"]
    return ""


async def xhs_qr_login() -> AsyncGenerator[dict, None]:
    """
    Async generator yielding SSE-ready event dicts:
      {"event": "status",        "data": json {message}}
      {"event": "qr",            "data": json {image: base64 data URI}}
      {"event": "authenticated", "data": json {cookie, username}}
      {"event": "error",         "data": json {message}}
    """
    yield {"event": "status", "data": json.dumps({"message": "Launching browser…"})}

    playwright = None
    browser = None
    try:
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(
            headless=True,
            args=_STEALTH_ARGS,
            # No proxy here — QR scan confirmation uses XHS's own JS long-poll,
            # which breaks through ISP proxies. API calls use the proxy separately.
        )
        context = await browser.new_context(
            locale="zh-CN",
            user_agent=_USER_AGENT,
            viewport={"width": 1280, "height": 900},
        )
        # Mask automation fingerprint
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page = await context.new_page()

        yield {"event": "status", "data": json.dumps({"message": "Opening 小红书…"})}
        await page.goto(XHS_URL, wait_until="domcontentloaded", timeout=30000)

        # Dismiss cookie consent / overlays if present
        for dismiss_selector in [
            "button[class*='accept']",
            "button:has-text('同意')",
            "button:has-text('接受')",
            ".cookie-banner button",
        ]:
            try:
                btn = await page.query_selector(dismiss_selector)
                if btn and await btn.is_visible():
                    await btn.click()
                    await asyncio.sleep(0.5)
            except Exception:
                pass

        # Wait briefly for login modal to appear
        await asyncio.sleep(2)

        yield {"event": "status", "data": json.dumps({"message": "Waiting for QR code…"})}

        # Wait up to QR_WAIT seconds for a square QR element to appear
        bbox = None
        deadline = asyncio.get_event_loop().time() + QR_WAIT
        while asyncio.get_event_loop().time() < deadline:
            bbox = await _find_qr_bbox(page)
            if bbox:
                break
            await asyncio.sleep(1)

        if bbox is None:
            logger.warning("No square QR found; sending full-page screenshot")
            img_bytes = await page.screenshot(type="png")
        else:
            # Clip the page screenshot using the QR's exact bounds plus a small
            # white-quiet-zone padding so phone scanners can lock on cleanly.
            pad = 12
            clip = {
                "x": max(0, bbox["x"] - pad),
                "y": max(0, bbox["y"] - pad),
                "width": bbox["width"] + 2 * pad,
                "height": bbox["height"] + 2 * pad,
            }
            img_bytes = await page.screenshot(type="png", clip=clip)

        b64 = base64.b64encode(img_bytes).decode()
        qr_data_uri = f"data:image/png;base64,{b64}"
        yield {"event": "qr", "data": json.dumps({"image": qr_data_uri})}
        yield {"event": "status", "data": json.dumps({"message": "Scan with 小红书 app → Me → Scan QR"})}

        # ── Poll for web_session cookie ──────────────────────────────────────
        poll_interval = 2  # seconds
        elapsed = 0
        while elapsed < QR_TIMEOUT:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

            cookies = await context.cookies()
            if _has_web_session(cookies):
                cookie_str = _cookies_to_str(cookies)
                username = _extract_username(cookies)

                # Try to grab nickname from the page DOM after login
                if not username:
                    try:
                        nick_el = await page.query_selector(
                            ".user-nickname, .nickname, [class*='nickname'], [class*='username']"
                        )
                        if nick_el:
                            username = (await nick_el.inner_text()).strip()
                    except Exception:
                        pass

                yield {"event": "authenticated", "data": json.dumps({
                    "cookie": cookie_str,
                    "username": username,
                })}
                return

            if elapsed % 20 == 0:
                remaining = QR_TIMEOUT - elapsed
                yield {"event": "status", "data": json.dumps({
                    "message": f"Waiting for scan… {remaining}s remaining"
                })}

        yield {"event": "error", "data": json.dumps({"message": "QR code expired after 2 minutes. Try again."})}

    except Exception as e:
        logger.exception("QR login error")
        yield {"event": "error", "data": json.dumps({"message": str(e)})}
    finally:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass
