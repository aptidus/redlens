"""
Minimal XHS API client using cookie-based auth + xhshow signing.
No Playwright required — pure HTTP calls once cookies are provided.
"""
import asyncio
import logging
import os
import random
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

XHS_HOST = "https://edith.xiaohongshu.com"
XHS_DOMAIN = "https://www.xiaohongshu.com"

# Optional ISP/residential proxy (e.g. Oxylabs) to bypass server IP blocks.
# Set OXYLABS_PROXY_URL=http://user:pass@disp.oxylabs.io:8004 in env.
_PROXY_URL: Optional[str] = os.getenv("OXYLABS_PROXY_URL") or None

# Semaphore to cap concurrent comment-fetching across notes
_comment_semaphore = asyncio.Semaphore(3)


# ---------------------------------------------------------------------------
# Custom error hierarchy
# ---------------------------------------------------------------------------

class XHSAPIError(Exception):
    """Base error for all XHS API failures."""
    def __init__(self, msg: str, code: int = 0):
        super().__init__(msg)
        self.code = code


class XHSAuthError(XHSAPIError):
    """Authentication / session expired (codes -100, 9999, 401)."""


class XHSPermissionError(XHSAPIError):
    """Account-level permission denied (code -104). Account may be too new or restricted."""


class XHSRateLimitError(XHSAPIError):
    """Rate limited by XHS (code 300012)."""


_AUTH_CODES = {-100, -101, 9999, 401}
_RATE_LIMIT_CODES = {300012}
_PERMISSION_CODES = {-104}


def _raise_for_code(code: int, msg: str) -> None:
    if code in _AUTH_CODES:
        raise XHSAuthError(f"Auth error: {msg} (code {code})", code=code)
    if code in _PERMISSION_CODES:
        raise XHSPermissionError(
            f"XHS account access denied (code {code}). "
            "This usually means the account is too new or restricted. "
            "Try: paste a fresh cookie from a more established account, or log out and log back in via QR.",
            code=code,
        )
    if code in _RATE_LIMIT_CODES:
        raise XHSRateLimitError(f"Rate limited: {msg} (code {code})", code=code)
    raise XHSAPIError(f"XHS API error: {msg} (code {code})", code=code)


# ---------------------------------------------------------------------------
# Signing + headers
# ---------------------------------------------------------------------------

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/147.0.0.0 Safari/537.36"
)


def _cookie_dict(cookie_str: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            k, _, v = part.partition("=")
            out[k.strip()] = v.strip()
    return out


def _full_browser_headers(cookie_str: str) -> Dict[str, str]:
    """Headers matching a real Chrome 147 — XHS fingerprints these."""
    return {
        "User-Agent": _USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en,zh-CN;q=0.9,zh;q=0.8",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Origin": XHS_DOMAIN,
        "Referer": XHS_DOMAIN + "/",
        "Cookie": cookie_str,
        "Content-Type": "application/json;charset=UTF-8",
        "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "priority": "u=1, i",
    }


def _sign_request(
    uri: str,
    params: Optional[Dict] = None,
    payload: Optional[Dict] = None,
    cookie_str: str = "",
) -> Dict[str, str]:
    """
    Generate ALL signing headers via xhshow's sign_headers_post/get.
    Returns x-s, x-s-common, x-t, x-b3-traceid, x-xray-traceid.
    """
    try:
        from xhshow import Xhshow  # type: ignore[import]

        cookies = _cookie_dict(cookie_str)
        if not cookies.get("a1"):
            logger.warning("XHS signing: no 'a1' cookie found — request will be unsigned")
            return {}

        client = Xhshow()
        if params is not None:
            return client.sign_headers_get(uri=uri, cookies=cookies, params=params)
        return client.sign_headers_post(uri=uri, cookies=cookies, payload=payload or {})
    except Exception as exc:
        logger.warning("XHS signing failed for %s: %s — request will be unsigned", uri, exc)
        return {}


async def _warmup_session(client: httpx.AsyncClient, cookie_str: str) -> str:
    """
    Hit xiaohongshu.com homepage once to refresh JS-set cookies (acw_tc, etc.)
    that XHS's anti-bot system expects to be fresh. Returns the merged cookie
    string with any new Set-Cookie values. Failures are non-fatal.
    """
    try:
        resp = await client.get(
            XHS_DOMAIN + "/",
            headers={
                "User-Agent": _USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
                "Accept-Language": "en,zh-CN;q=0.9,zh;q=0.8",
                "Cookie": cookie_str,
                "sec-ch-ua": '"Google Chrome";v="147"',
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "none",
                "upgrade-insecure-requests": "1",
            },
            follow_redirects=True,
            timeout=15,
        )
        merged = _cookie_dict(cookie_str)
        for c in client.cookies.jar:
            merged[c.name] = c.value
        merged_str = "; ".join(f"{k}={v}" for k, v in merged.items())
        new_count = len(merged) - len(_cookie_dict(cookie_str))
        logger.info(
            "Warmup: status=%s, +%d cookies (acw_tc=%s)",
            resp.status_code, new_count, "yes" if "acw_tc" in merged else "no",
        )
        return merged_str
    except Exception as exc:
        logger.warning("Warmup failed (non-fatal): %s", exc)
        return cookie_str


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

class XHSClient:
    def __init__(self, cookie_str: str):
        self.cookie_str = cookie_str
        self._warmed = False
        proxy = _PROXY_URL
        if proxy:
            logger.info("XHSClient using proxy: %s", proxy.split("@")[-1])
        self._client = httpx.AsyncClient(timeout=30, proxy=proxy)

    async def close(self) -> None:
        await self._client.aclose()

    async def _ensure_warm(self) -> None:
        """Lazy session warmup. Refreshes acw_tc / websectiga / sec_poison_id."""
        if self._warmed:
            return
        self.cookie_str = await _warmup_session(self._client, self.cookie_str)
        self._warmed = True

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(min=2, max=10),
        retry=retry_if_exception(
            lambda e: isinstance(e, XHSAPIError) and not isinstance(e, (XHSAuthError, XHSPermissionError))
        ),
        reraise=True,
    )
    async def _get(self, uri: str, params: Dict) -> Any:
        await self._ensure_warm()
        sign_headers = _sign_request(uri, params=params, cookie_str=self.cookie_str)
        headers = {**_full_browser_headers(self.cookie_str), **sign_headers}
        url = f"{XHS_HOST}{uri}?{urlencode(params)}"
        resp = await self._client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") is False:
            _raise_for_code(data.get("code", 0), data.get("msg", "unknown"))
        return data.get("data", data)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(min=2, max=10),
        retry=retry_if_exception(
            lambda e: isinstance(e, XHSAPIError) and not isinstance(e, (XHSAuthError, XHSPermissionError))
        ),
        reraise=True,
    )
    async def _post(self, uri: str, payload: Dict) -> Any:
        await self._ensure_warm()
        sign_headers = _sign_request(uri, payload=payload, cookie_str=self.cookie_str)
        headers = {**_full_browser_headers(self.cookie_str), **sign_headers}
        url = f"{XHS_HOST}{uri}"
        resp = await self._client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") is False:
            _raise_for_code(data.get("code", 0), data.get("msg", "unknown"))
        return data.get("data", data)

    # ------------------------------------------------------------------
    # API methods
    # ------------------------------------------------------------------

    async def search_notes(
        self, keyword: str, page: int = 1, page_size: int = 20, sort: str = "general"
    ) -> Dict:
        payload = {
            "keyword": keyword,
            "page": page,
            "page_size": page_size,
            "search_id": _generate_search_id(),
            "sort": sort,
            "note_type": 0,
        }
        return await self._post("/api/sns/web/v1/search/notes", payload)

    async def get_note_detail(
        self,
        note_id: str,
        xsec_token: str = "",
        xsec_source: str = "pc_search",
    ) -> Dict:
        params = {
            "source": xsec_source,
            "note_id": note_id,
            "xsec_token": xsec_token,
            "xsec_source": xsec_source,
        }
        return await self._get("/api/sns/web/v1/feed", params)

    async def get_note_comments(self, note_id: str, cursor: str = "") -> Dict:
        """Get comments — tries v2 first, falls back to v1."""
        params = {
            "note_id": note_id,
            "cursor": cursor,
            "top_comment_id": "",
            "image_formats": "jpg,webp,avif",
        }
        try:
            return await self._get("/api/sns/web/v2/comment/page", params)
        except XHSAPIError:
            return await self._get("/api/sns/web/v1/comment/list", params)

    async def get_note_sub_comments(
        self,
        note_id: str,
        root_comment_id: str,
        cursor: str = "",
        num: int = 5,
    ) -> Dict:
        """Get replies to a specific comment — tries v2 first, falls back to v1."""
        params = {
            "note_id": note_id,
            "root_comment_id": root_comment_id,
            "num": num,
            "cursor": cursor,
            "image_formats": "jpg,webp,avif",
            "top_comment_id": "",
        }
        try:
            return await self._get("/api/sns/web/v2/comment/sub/page", params)
        except XHSAPIError:
            return await self._get("/api/sns/web/v1/comment/sub/list", params)


# ---------------------------------------------------------------------------
# Comment fetching helpers (with semaphore)
# ---------------------------------------------------------------------------

async def _fetch_comments_with_replies(
    client: XHSClient,
    note_id: str,
    max_comments: int,
    max_sub_per_comment: int = 5,
) -> List[Dict]:
    """
    Fetch top-level comments for a note then, for any comment with sub-comments,
    fetch up to `max_sub_per_comment` replies concurrently.
    Returns a flat list with top-level entries followed by their replies inline.
    """
    async with _comment_semaphore:
        try:
            comment_data = await client.get_note_comments(note_id)
        except XHSAuthError:
            raise
        except Exception:
            return []

        top_comments = comment_data.get("comments", [])[:max_comments]
        await asyncio.sleep(random.uniform(0.5, 1.5))

        # Build sub-comment fetch tasks for comments that have replies
        sub_tasks = []
        for c in top_comments:
            sub_count = c.get("sub_comment_count", 0)
            if sub_count and sub_count > 0:
                cid = c.get("id", "")
                if cid:
                    sub_tasks.append((cid, client.get_note_sub_comments(
                        note_id, cid, num=max_sub_per_comment
                    )))

        # Fetch all sub-comment pages concurrently
        sub_results: Dict[str, List[Dict]] = {}
        if sub_tasks:
            cids = [t[0] for t in sub_tasks]
            coros = [t[1] for t in sub_tasks]
            gathered = await asyncio.gather(*coros, return_exceptions=True)
            for cid, result in zip(cids, gathered):
                if isinstance(result, Exception):
                    sub_results[cid] = []
                else:
                    sub_results[cid] = result.get("comments", [])  # type: ignore[union-attr]

        # Build flat comment list
        flat: List[Dict] = []
        for c in top_comments:
            flat.append({
                "content": c.get("content", ""),
                "liked_count": c.get("like_count", 0),
                "user": c.get("user_info", {}).get("nickname", ""),
                "is_reply": False,
            })
            cid = c.get("id", "")
            for sub in sub_results.get(cid, []):
                flat.append({
                    "content": sub.get("content", ""),
                    "liked_count": sub.get("like_count", 0),
                    "user": sub.get("user_info", {}).get("nickname", ""),
                    "is_reply": True,
                })

        return flat


# ---------------------------------------------------------------------------
# Public high-level entry point
# ---------------------------------------------------------------------------

def _date_cutoff(date_range: str) -> int:
    """Return Unix timestamp cutoff (0 = no filter)."""
    days = {"7d": 7, "30d": 30, "90d": 90, "180d": 180}.get(date_range, 0)
    return int(time.time()) - days * 86400 if days else 0


async def _scrape_keyword_http(
    cookie_str: str,
    keyword: str,
    max_notes: int,
    max_comments_per_note: int,
    date_range: str,
) -> List[Dict]:
    """Inner HTTP-based scraper; raises XHSPermissionError on -104."""
    cutoff = _date_cutoff(date_range)
    client = XHSClient(cookie_str)
    results = []
    try:
        # When date filter is active, ask XHS to sort newest-first so we get recent posts.
        sort = "time_descending" if cutoff else "general"
        search_data = await client.search_notes(
            keyword, page_size=min(max_notes, 30), sort=sort
        )
        items = search_data.get("items", [])
        logger.info("XHS search returned %d raw items (sort=%s)", len(items), sort)

        # Soft-block detection: XHS sometimes returns 200 OK with 0 items
        # when the calling IP is flagged (Oxylabs/datacenter). Treat as -104
        # so the caller can fall back to the Playwright browser scraper.
        if not items:
            raise XHSPermissionError(
                "XHS returned 0 search results (likely IP soft-block).",
                code=-104,
            )

        if cutoff:
            # Search-list responses don't include create_time, so only filter
            # the items that DO have a usable time; keep the rest in sort order.
            filtered = []
            for it in items:
                t = _extract_time(it, "time")
                if t == 0 or t >= cutoff:
                    filtered.append(it)
            items = filtered
            logger.info("After date filter (%s, cutoff=%d): %d items", date_range, cutoff, len(items))

        for item in items[:max_notes]:
            note_id = item.get("id") or item.get("note_id", "")
            if not note_id:
                continue
            xsec_token = item.get("xsec_token", "")
            note_url = (
                f"https://www.xiaohongshu.com/explore/{note_id}"
                + (f"?xsec_token={xsec_token}&xsec_source=pc_search" if xsec_token else "")
            )

            note: Dict = {
                "note_id": note_id,
                "note_url": note_url,
                "xsec_token": xsec_token,
                "title": _extract_title(item),
                "desc": _extract_desc(item),
                "type": item.get("note_card", {}).get("type", "normal"),
                "liked_count": _safe_int(item, "liked_count"),
                "collected_count": _safe_int(item, "collected_count"),
                "comment_count": _safe_int(item, "comment_count"),
                "share_count": _safe_int(item, "share_count"),
                "user": _extract_user(item),
                "cover_url": _extract_cover(item),
                "tags": _extract_tags(item),
                "create_time": _extract_time(item, "time"),
                "video_info": _extract_video_info(item),
                "comments": [],
            }

            note["comments"] = await _fetch_comments_with_replies(
                client, note_id, max_comments_per_note
            )

            results.append(note)
            await asyncio.sleep(random.uniform(0.5, 1.5))

    finally:
        await client.close()

    return results


async def scrape_keyword(
    cookie_str: str,
    keyword: str,
    max_notes: int = 15,
    max_comments_per_note: int = 30,
    date_range: str = "all",
) -> List[Dict]:
    """
    Search keyword → fetch top notes with comments.
    Tries the HTTP API first; if it gets -104 (IP blocked), falls back
    to a Playwright browser that uses XHS's own JS for signing.
    """
    try:
        return await _scrape_keyword_http(
            cookie_str, keyword, max_notes, max_comments_per_note, date_range
        )
    except XHSPermissionError:
        logger.warning(
            "HTTP API returned -104 for %r — falling back to browser scraping", keyword
        )
        from xhs_playwright_scraper import scrape_xhs_via_browser
        notes = await scrape_xhs_via_browser(
            cookie_str, keyword, max_notes=max_notes, date_range=date_range
        )
        if not notes:
            raise XHSPermissionError(
                "XHS search is blocked on this server (code -104). "
                "The browser fallback also returned no results — "
                "please check that your account cookie is still valid and try again.",
                code=-104,
            )
        # Try fetching comments via HTTP for each note (gracefully fails if also blocked)
        client = XHSClient(cookie_str)
        try:
            for note in notes:
                note["comments"] = await _fetch_comments_with_replies(
                    client, note["note_id"], max_comments_per_note
                )
                await asyncio.sleep(random.uniform(0.5, 1.5))
        finally:
            await client.close()
        return notes


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------

def _generate_search_id() -> str:
    ts = int(time.time() * 1000)
    rand = random.randint(100000, 999999)
    return f"{ts}{rand}"


def _extract_title(item: Dict) -> str:
    card = item.get("note_card", {})
    return card.get("title") or card.get("display_title", "")


def _extract_desc(item: Dict) -> str:
    card = item.get("note_card", {})
    return card.get("desc", "")


def _extract_user(item: Dict) -> str:
    card = item.get("note_card", {})
    return card.get("user", {}).get("nickname", "")


def _extract_cover(item: Dict) -> str:
    card = item.get("note_card", {})
    cover = card.get("cover", {})
    return cover.get("url_default") or cover.get("url_pre", "")


def _safe_int(item: Dict, key: str) -> int:
    card = item.get("note_card", {})
    val = card.get("interact_info", {}).get(key, 0)
    try:
        if isinstance(val, str):
            val = val.replace("万", "0000").replace("+", "")
        return int(val)
    except (ValueError, TypeError):
        return 0


def _extract_tags(item: Dict) -> List[str]:
    card = item.get("note_card", {})
    # Tags may live under tag_list or topic_tag_list
    tag_list = card.get("tag_list") or card.get("topic_tag_list") or []
    tags = []
    for t in tag_list:
        name = t.get("name") or t.get("title") or t.get("tag_name", "")
        if name:
            tags.append(name)
    return tags


def _extract_time(item: Dict, key: str) -> int:
    card = item.get("note_card", {})
    val = card.get(key, 0)
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _extract_video_info(item: Dict) -> Optional[Dict]:
    card = item.get("note_card", {})
    video = card.get("video")
    if not video:
        return None
    return {
        "duration": video.get("duration", 0),
        "play_count": video.get("play_addr", {}).get("play_count", 0),
    }


def _format_for_prompt(note: Dict) -> str:
    """Render a single note dict as a compact text block for AI prompts."""
    lines = []
    lines.append(f"Title: {note.get('title', 'N/A')}")

    tags = note.get("tags", [])
    if tags:
        lines.append("Tags: " + " ".join(f"#{t}" for t in tags))

    desc = note.get("desc", "")
    if desc:
        lines.append(f"Content: {desc[:400]}")

    lines.append(
        f"Likes: {note.get('liked_count', 0)} | "
        f"Collects: {note.get('collected_count', 0)} | "
        f"Comments: {note.get('comment_count', 0)} | "
        f"Shares: {note.get('share_count', 0)}"
    )
    lines.append(f"Creator: {note.get('user', 'N/A')} | Type: {note.get('type', 'normal')}")

    comments = note.get("comments", [])
    if comments:
        lines.append(f"Comments ({len(comments)}):")
        for c in comments[:15]:
            content = c.get("content", "")[:120]
            prefix = "  ↳" if c.get("is_reply") else "  "
            lines.append(f"{prefix}[{c.get('liked_count', 0)} likes] {content}")

    return "\n".join(lines)
