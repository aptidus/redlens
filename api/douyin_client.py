"""
Douyin (抖音) content scraper — cookie-based auth, no Playwright.
Uses Douyin's web API with standard browser headers.
"""
import asyncio
import logging
import os
import random
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from tenacity import retry, retry_if_exception, retry_if_exception_type, stop_after_attempt, wait_exponential

from xbogus import compute_xbogus

logger = logging.getLogger(__name__)
_PROXY_URL: Optional[str] = os.getenv("OXYLABS_PROXY_URL") or None

DOUYIN_HOST = "https://www.douyin.com"

_comment_semaphore = asyncio.Semaphore(3)


# ---------------------------------------------------------------------------
# Custom error hierarchy
# ---------------------------------------------------------------------------

class DouyinAPIError(Exception):
    def __init__(self, msg: str, code: int = 0):
        super().__init__(msg)
        self.code = code


class DouyinAuthError(DouyinAPIError):
    """Auth / session expired."""


class DouyinRateLimitError(DouyinAPIError):
    """Rate limited."""


_AUTH_CODES = {2154, 401, -1}
_RATE_CODES = {4000015, 4000000, 2061}


def _raise_for_status(data: Dict) -> None:
    code = data.get("status_code", 0)
    msg = data.get("status_msg", "unknown")
    if code in _AUTH_CODES:
        raise DouyinAuthError(f"Auth error: {msg} ({code})", code=code)
    if code in _RATE_CODES:
        raise DouyinRateLimitError(f"Rate limited: {msg} ({code})", code=code)
    if code != 0:
        raise DouyinAPIError(f"Douyin API error: {msg} ({code})", code=code)


# ---------------------------------------------------------------------------
# Headers & params
# ---------------------------------------------------------------------------

def _get_headers(cookie_str: str) -> Dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.douyin.com/",
        "Origin": "https://www.douyin.com",
        "Cookie": cookie_str,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
    }


def _base_params() -> Dict[str, Any]:
    """Browser fingerprint params Douyin expects."""
    return {
        "pc_client_type": 1,
        "version_code": "190500",
        "version_name": "19.5.0",
        "cookie_enabled": "true",
        "screen_width": 1920,
        "screen_height": 1080,
        "browser_language": "zh-CN",
        "browser_platform": "MacIntel",
        "browser_name": "Chrome",
        "browser_version": "131.0.0.0",
        "browser_online": "true",
        "engine_name": "Blink",
        "engine_version": "131.0.0.0",
        "os_name": "Mac OS",
        "os_version": "10.15.7",
        "cpu_core_num": 8,
        "device_memory": 8,
        "platform": "PC",
        "downlink": 10,
        "effective_type": "4g",
        "round_trip_time": 50,
    }


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

class DouyinClient:
    def __init__(self, cookie_str: str):
        self.cookie_str = cookie_str
        proxy = _PROXY_URL
        if proxy:
            logger.info("DouyinClient using proxy: %s", proxy.split("@")[-1])
        self._client = httpx.AsyncClient(timeout=30, proxy=proxy)

    async def close(self) -> None:
        await self._client.aclose()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(min=2, max=10),
        retry=retry_if_exception(
            lambda e: isinstance(e, DouyinAPIError) and not isinstance(e, DouyinAuthError)
        ),
        reraise=True,
    )
    async def _get(self, path: str, params: Dict) -> Any:
        all_params = {**_base_params(), **params}
        ua = _get_headers(self.cookie_str)["User-Agent"]
        query_str = urlencode(all_params)
        all_params["X-Bogus"] = compute_xbogus(query_str, ua)
        resp = await self._client.get(
            f"{DOUYIN_HOST}{path}",
            params=all_params,
            headers=_get_headers(self.cookie_str),
        )
        resp.raise_for_status()
        data = resp.json()
        _raise_for_status(data)
        return data

    # ------------------------------------------------------------------
    # API methods
    # ------------------------------------------------------------------

    async def search_videos(self, keyword: str, count: int = 20, offset: int = 0) -> Dict:
        return await self._get("/aweme/v1/web/search/item/", {
            "keyword": keyword,
            "count": count,
            "offset": offset,
            "search_id": _gen_search_id(),
            "search_channel": "aweme_video_web",
            "search_source": "normal_search",
            "query_correct_type": 1,
            "is_filter_search": 0,
            "sort_type": 0,
            "publish_time": 0,
            "source": "normal_search",
        })

    async def get_video_comments(self, aweme_id: str, count: int = 20, cursor: int = 0) -> Dict:
        return await self._get("/aweme/v1/web/comment/list/", {
            "aweme_id": aweme_id,
            "count": count,
            "cursor": cursor,
            "item_type": 0,
        })

    async def get_comment_replies(self, aweme_id: str, comment_id: str, count: int = 5) -> Dict:
        return await self._get("/aweme/v1/web/comment/list/reply/", {
            "aweme_id": aweme_id,
            "comment_id": comment_id,
            "count": count,
            "cursor": 0,
        })


# ---------------------------------------------------------------------------
# Comment fetching helpers
# ---------------------------------------------------------------------------

async def _fetch_comments_with_replies(
    client: DouyinClient,
    aweme_id: str,
    max_comments: int = 20,
    max_replies: int = 5,
) -> List[Dict]:
    async with _comment_semaphore:
        try:
            data = await client.get_video_comments(aweme_id, count=max_comments)
        except DouyinAuthError:
            raise
        except Exception:
            return []

        comments = data.get("comments") or []
        await asyncio.sleep(random.uniform(0.5, 1.5))

        # Fetch replies concurrently for comments that have them
        reply_tasks = []
        for c in comments[:max_comments]:
            if c.get("reply_comment_total", 0) > 0:
                cid = c.get("cid", "")
                if cid:
                    reply_tasks.append((cid, client.get_comment_replies(aweme_id, cid, count=max_replies)))

        reply_results: Dict[str, List] = {}
        if reply_tasks:
            cids = [t[0] for t in reply_tasks]
            gathered = await asyncio.gather(*[t[1] for t in reply_tasks], return_exceptions=True)
            for cid, result in zip(cids, gathered):
                if isinstance(result, Exception):
                    reply_results[cid] = []
                else:
                    reply_results[cid] = (result or {}).get("comments") or []

        flat: List[Dict] = []
        for c in comments[:max_comments]:
            flat.append({
                "content": c.get("text", ""),
                "liked_count": c.get("digg_count", 0),
                "user": (c.get("user") or {}).get("nickname", ""),
                "is_reply": False,
            })
            for reply in reply_results.get(c.get("cid", ""), []):
                flat.append({
                    "content": reply.get("text", ""),
                    "liked_count": reply.get("digg_count", 0),
                    "user": (reply.get("user") or {}).get("nickname", ""),
                    "is_reply": True,
                })

        return flat


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def _date_cutoff(date_range: str) -> int:
    days = {"7d": 7, "30d": 30, "90d": 90, "180d": 180}.get(date_range, 0)
    return int(time.time()) - days * 86400 if days else 0


async def scrape_douyin(
    cookie_str: str,
    keyword: str,
    max_notes: int = 15,
    max_comments_per_note: int = 20,
    date_range: str = "all",
) -> List[Dict]:
    """
    Search keyword on Douyin → fetch top videos with comments.
    Returns list of enriched video dicts ready for AI analysis.
    """
    cutoff = _date_cutoff(date_range)
    client = DouyinClient(cookie_str)
    results = []
    try:
        fetch_count = max_notes * 2 if cutoff else max_notes
        search_data = await client.search_videos(keyword, count=min(fetch_count, 30))
        items = search_data.get("data") or []

        for item in items:
            if len(results) >= max_notes:
                break

            info = item.get("aweme_info") or item
            aweme_id = info.get("aweme_id", "")
            if not aweme_id:
                continue

            create_time = info.get("create_time", 0)
            # Skip filter when create_time is missing — Douyin's search list
            # often omits it; trust the API's default ordering instead.
            if cutoff and create_time and create_time < cutoff:
                continue

            stats = info.get("statistics") or {}
            author = info.get("author") or {}
            video = info.get("video") or {}
            tags = [
                t.get("hashtag_name", "")
                for t in (info.get("text_extra") or [])
                if t.get("hashtag_name")
            ]
            cover = (video.get("cover") or {})
            cover_url = (cover.get("url_list") or [""])[0]

            note: Dict = {
                "note_id": aweme_id,
                "title": info.get("desc", "")[:200],
                "desc": info.get("desc", ""),
                "type": "video",
                "liked_count": stats.get("digg_count", 0),
                "collected_count": stats.get("collect_count", 0),
                "comment_count": stats.get("comment_count", 0),
                "share_count": stats.get("share_count", 0),
                "play_count": stats.get("play_count", 0),
                "user": author.get("nickname", ""),
                "cover_url": cover_url,
                "tags": tags,
                "duration": video.get("duration", 0),  # milliseconds
                "create_time": create_time,
                "comments": [],
            }

            note["comments"] = await _fetch_comments_with_replies(
                client, aweme_id, max_comments_per_note
            )
            results.append(note)
            if len(results) < max_notes:
                await asyncio.sleep(random.uniform(0.5, 1.5))

    finally:
        await client.close()

    return results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _gen_search_id() -> str:
    return f"{int(time.time() * 1000)}{random.randint(100000, 999999)}"


def _format_for_prompt(note: Dict) -> str:
    """Render a single Douyin video dict as a compact text block for AI prompts."""
    lines = []
    lines.append(f"Title/Desc: {note.get('title', 'N/A')[:200]}")

    tags = note.get("tags", [])
    if tags:
        lines.append("Tags: " + " ".join(f"#{t}" for t in tags))

    duration_ms = note.get("duration", 0)
    if duration_ms:
        lines.append(f"Duration: {duration_ms / 1000:.0f}s")

    lines.append(
        f"Likes: {note.get('liked_count', 0)} | "
        f"Collects: {note.get('collected_count', 0)} | "
        f"Comments: {note.get('comment_count', 0)} | "
        f"Plays: {note.get('play_count', 0)}"
    )
    lines.append(f"Creator: {note.get('user', 'N/A')}")

    comments = note.get("comments", [])
    if comments:
        lines.append(f"Comments ({len(comments)}):")
        for c in comments[:15]:
            content = c.get("content", "")[:120]
            prefix = "  ↳" if c.get("is_reply") else "  "
            lines.append(f"{prefix}[{c.get('liked_count', 0)} likes] {content}")

    return "\n".join(lines)
