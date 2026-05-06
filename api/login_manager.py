"""
QR code login manager for XHS (小红书) — pure HTTP, no browser needed.
Uses XHS's native QR login API: create token → generate QR → poll status → extract cookies.
"""
import asyncio
import base64
import io
import json
import logging
from typing import AsyncGenerator

import httpx
import qrcode

logger = logging.getLogger(__name__)

XHS_HOST = "https://edith.xiaohongshu.com"
XHS_DOMAIN = "https://www.xiaohongshu.com"
QR_TIMEOUT = 120  # seconds

_BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": XHS_DOMAIN,
    "Origin": XHS_DOMAIN,
    "Content-Type": "application/json",
}


def _sign(uri: str, data=None, cookie_str: str = "") -> dict:
    try:
        from xhshow import XhsShow
        method = "POST" if data is not None else "GET"
        result = XhsShow().sign(uri=uri, data=data, cookie_str=cookie_str, method=method)
        return {
            "X-S": result.get("x-s", ""),
            "X-T": str(result.get("x-t", "")),
            "x-S-Common": result.get("x-s-common", ""),
        }
    except Exception as e:
        logger.warning("xhshow sign failed: %s", e)
        return {}


def _make_qr_image(url: str) -> str:
    """Generate a QR code PNG from a URL, return as base64 data URI."""
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


async def xhs_qr_login() -> AsyncGenerator[dict, None]:
    """
    Async generator yielding SSE-ready event dicts:
      {"event": "status",        "data": json {message}}
      {"event": "qr",            "data": json {image: base64 data URI}}
      {"event": "authenticated", "data": json {cookie, username}}
      {"event": "error",         "data": json {message}}
    """
    yield {"event": "status", "data": json.dumps({"message": "Connecting to 小红书…"})}

    try:
        async with httpx.AsyncClient(
            headers=_BASE_HEADERS,
            timeout=30,
            follow_redirects=True,
        ) as client:

            # ── Step 1: Create QR token ──────────────────────────────────────
            create_uri = "/api/sns/web/v1/login/qrcode/create"
            resp = await client.post(
                f"{XHS_HOST}{create_uri}",
                json={},
                headers=_sign(create_uri, data={}),
            )
            body = resp.json()
            logger.info("QR create response: %s", body)

            if not body.get("success"):
                yield {"event": "error", "data": json.dumps({
                    "message": f"XHS rejected QR request: {body.get('msg') or body.get('code', 'unknown')}"
                })}
                return

            qr_info = body.get("data", {})
            qr_id = qr_info.get("qr_id", "")
            code = qr_info.get("code", "")
            qr_url = qr_info.get("url", "")  # xhsdiscover:// deep link

            if not qr_url or not qr_id:
                yield {"event": "error", "data": json.dumps({"message": "No QR data returned from XHS."})}
                return

            # ── Step 2: Generate QR image and stream to frontend ─────────────
            qr_image = _make_qr_image(qr_url)
            yield {"event": "qr", "data": json.dumps({"image": qr_image})}
            yield {"event": "status", "data": json.dumps({"message": "Scan with 小红书 app → Me → Scan QR"})}

            # ── Step 3: Poll for confirmation ────────────────────────────────
            status_path = "/api/sns/web/v1/login/qrcode/status"
            status_qs = f"{status_path}?qr_id={qr_id}&code={code}"

            for elapsed in range(0, QR_TIMEOUT, 2):
                await asyncio.sleep(2)

                st_resp = await client.get(
                    f"{XHS_HOST}{status_path}",
                    params={"qr_id": qr_id, "code": code},
                    headers=_sign(status_qs),
                )
                st_body = st_resp.json()
                logger.debug("QR status [%ds]: %s", elapsed, st_body)

                if not st_body.get("success"):
                    # Still waiting — keep polling
                    remaining = QR_TIMEOUT - elapsed
                    if elapsed > 0 and elapsed % 20 == 0:
                        yield {"event": "status", "data": json.dumps({
                            "message": f"Waiting for scan… {remaining}s remaining"
                        })}
                    continue

                data = st_body.get("data", {})
                login_info = data.get("login_info") or {}
                code_success = data.get("code_success", 0)

                if login_info or code_success == 1:
                    # Authenticated — extract session cookies
                    await asyncio.sleep(1)
                    cookies = dict(client.cookies)
                    cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
                    username = (
                        login_info.get("nickname") or
                        login_info.get("username") or ""
                        if isinstance(login_info, dict) else ""
                    )
                    yield {"event": "authenticated", "data": json.dumps({
                        "cookie": cookie_str,
                        "username": username,
                    })}
                    return

            yield {"event": "error", "data": json.dumps({"message": "QR code expired after 2 minutes. Try again."})}

    except Exception as e:
        logger.exception("QR login error")
        yield {"event": "error", "data": json.dumps({"message": str(e)})}
