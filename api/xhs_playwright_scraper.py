"""
Fallback XHS scraper using Playwright.
When the HTTP API returns -104 (IP-based block), launch a headless browser
with the user's cookies so XHS's own JavaScript computes the correct signatures.
We intercept the browser's API responses to extract search results.
"""
import asyncio
import logging
import os
import time
from typing import Dict, List, Optional
from urllib.parse import quote, urlparse

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

logger = logging.getLogger(__name__)

_STEALTH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
]

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def _playwright_proxy_config() -> Optional[Dict]:
    raw = os.getenv("OXYLABS_PROXY_URL")
    if not raw:
        return None
    try:
        p = urlparse(raw)
        cfg: Dict = {"server": f"{p.scheme}://{p.hostname}:{p.port}"}
        if p.username:
            cfg["username"] = p.username
        if p.password:
            cfg["password"] = p.password
        logger.info("Playwright scraper using proxy: %s:%s", p.hostname, p.port)
        return cfg
    except Exception as exc:
        logger.warning("Could not parse OXYLABS_PROXY_URL: %s", exc)
        return None


def _cookie_str_to_playwright(cookie_str: str) -> List[Dict]:
    cookies = []
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" not in part:
            continue
        name, _, value = part.partition("=")
        name = name.strip()
        if name:
            cookies.append({
                "name": name,
                "value": value.strip(),
                "domain": ".xiaohongshu.com",
                "path": "/",
            })
    return cookies


def _date_cutoff(date_range: str) -> int:
    days = {"7d": 7, "30d": 30, "90d": 90, "180d": 180}.get(date_range, 0)
    return int(time.time()) - days * 86400 if days else 0


def _safe_int(d: Dict, key: str) -> int:
    val = d.get(key, 0)
    try:
        if isinstance(val, str):
            val = val.replace("万", "0000").replace("+", "")
        return int(val)
    except (ValueError, TypeError):
        return 0


def _extract_note_from_item(item: Dict) -> Dict:
    card = item.get("note_card", {})
    interact = card.get("interact_info", {})

    tags = []
    for t in (card.get("tag_list") or card.get("topic_tag_list") or []):
        name = t.get("name") or t.get("title") or t.get("tag_name", "")
        if name:
            tags.append(name)

    cover = card.get("cover", {})
    cover_url = cover.get("url_default") or cover.get("url_pre", "")

    return {
        "note_id": item.get("id") or item.get("note_id", ""),
        "title": card.get("title") or card.get("display_title", ""),
        "desc": card.get("desc", ""),
        "type": card.get("type", "normal"),
        "liked_count": _safe_int(interact, "liked_count"),
        "collected_count": _safe_int(interact, "collected_count"),
        "comment_count": _safe_int(interact, "comment_count"),
        "share_count": _safe_int(interact, "share_count"),
        "user": card.get("user", {}).get("nickname", ""),
        "cover_url": cover_url,
        "tags": tags,
        "create_time": int(card.get("time", 0) or 0),
        "video_info": None,
        "comments": [],
    }


async def scrape_xhs_via_browser(
    cookie_str: str,
    keyword: str,
    max_notes: int = 15,
    date_range: str = "all",
) -> List[Dict]:
    """
    Launch headless Chromium with user's cookies; intercept the browser's own
    XHS search API responses (properly signed by XHS's JS) to extract note data.
    """
    cutoff = _date_cutoff(date_range)
    playwright = await async_playwright().start()
    browser = None
    try:
        browser = await playwright.chromium.launch(
            headless=True, args=_STEALTH_ARGS, proxy=_playwright_proxy_config()
        )
        context = await browser.new_context(
            locale="zh-CN",
            user_agent=_USER_AGENT,
            viewport={"width": 1920, "height": 1080},
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        await context.add_cookies(_cookie_str_to_playwright(cookie_str))

        page = await context.new_page()
        raw_items: List[Dict] = []

        async def handle_response(response):
            if "/api/sns/web/v1/search/notes" in response.url and response.status == 200:
                try:
                    data = await response.json()
                    items = (data.get("data") or {}).get("items") or []
                    raw_items.extend(items)
                    logger.info("Browser intercepted %d search items", len(items))
                except Exception as exc:
                    logger.debug("Could not parse intercepted response: %s", exc)

        page.on("response", handle_response)

        search_url = (
            f"https://www.xiaohongshu.com/search_result"
            f"?keyword={quote(keyword)}&type=51&source=web_search_result_notes"
        )
        logger.info("Browser scraper navigating to search page for %r", keyword)

        try:
            await page.goto(search_url, wait_until="networkidle", timeout=30000)
        except PlaywrightTimeoutError:
            logger.warning("networkidle timeout — using whatever was intercepted")

        await asyncio.sleep(3)

        if not raw_items:
            # Try a scroll to trigger lazy-loaded requests
            logger.info("No items yet — scrolling to trigger requests")
            await page.evaluate("window.scrollBy(0, 400)")
            await asyncio.sleep(3)

        if not raw_items:
            logger.error("Browser scrape: no search items intercepted for %r", keyword)
            return []

        results: List[Dict] = []
        for item in raw_items:
            if len(results) >= max_notes:
                break
            note = _extract_note_from_item(item)
            if not note["note_id"]:
                continue
            if cutoff and note["create_time"] and note["create_time"] < cutoff:
                continue
            results.append(note)

        logger.info(
            "Browser scrape done: %d notes (date_range=%s, cutoff=%s)",
            len(results), date_range, cutoff,
        )
        return results

    except Exception as exc:
        logger.exception("Browser scrape failed: %s", exc)
        return []
    finally:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        try:
            await playwright.stop()
        except Exception:
            pass
