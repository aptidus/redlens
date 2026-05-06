"""
Minimal XHS API client using cookie-based auth + xhshow signing.
No Playwright required — pure HTTP calls once cookies are provided.
"""
import asyncio
import random
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

XHS_HOST = "https://edith.xiaohongshu.com"
XHS_DOMAIN = "https://www.xiaohongshu.com"

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


class XHSRateLimitError(XHSAPIError):
    """Rate limited by XHS (code 300012)."""


_AUTH_CODES = {-100, 9999, 401}
_RATE_LIMIT_CODES = {300012}


def _raise_for_code(code: int, msg: str) -> None:
    if code in _AUTH_CODES:
        raise XHSAuthError(f"Auth error: {msg} (code {code})", code=code)
    if code in _RATE_LIMIT_CODES:
        raise XHSRateLimitError(f"Rate limited: {msg} (code {code})", code=code)
    raise XHSAPIError(f"XHS API error: {msg} (code {code})", code=code)


# ---------------------------------------------------------------------------
# Signing + headers
# ---------------------------------------------------------------------------

def _get_common_headers(cookie_str: str) -> Dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "Referer": XHS_DOMAIN,
        "Origin": XHS_DOMAIN,
        "Cookie": cookie_str,
        "Content-Type": "application/json",
    }


def _sign_request(
    uri: str,
    params: Optional[Dict] = None,
    payload: Optional[Dict] = None,
    cookie_str: str = "",
) -> Dict[str, str]:
    """Generate X-S / X-T headers via xhshow library."""
    try:
        import random
        import time

        from xhshow import Xhshow  # type: ignore[import]

        a1 = ""
        for part in cookie_str.split(";"):
            part = part.strip()
            if part.startswith("a1="):
                a1 = part[3:].strip()
                break
        if not a1:
            return {}

        method = "GET" if params is not None else "POST"
        data = params if params is not None else payload

        client = Xhshow()
        xs = client.sign_xs(method=method, uri=uri, a1_value=a1, payload=data)
        xs_common = client.sign_xs_common(cookie_str)
        xt = str(int(time.time() * 1000))
        b3 = "".join(random.choices("0123456789abcdef", k=32))
        return {
            "X-S": xs,
            "X-T": xt,
            "x-S-Common": xs_common,
            "X-B3-Traceid": b3,
        }
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

class XHSClient:
    def __init__(self, cookie_str: str):
        self.cookie_str = cookie_str
        self._client = httpx.AsyncClient(timeout=30)

    async def close(self) -> None:
        await self._client.aclose()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(min=2, max=10),
        retry=retry_if_exception_type(XHSAPIError),
        reraise=True,
    )
    async def _get(self, uri: str, params: Dict) -> Any:
        sign_headers = _sign_request(uri, params=params, cookie_str=self.cookie_str)
        headers = {**_get_common_headers(self.cookie_str), **sign_headers}
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
        retry=retry_if_exception_type(XHSAPIError),
        reraise=True,
    )
    async def _post(self, uri: str, payload: Dict) -> Any:
        sign_headers = _sign_request(uri, payload=payload, cookie_str=self.cookie_str)
        headers = {**_get_common_headers(self.cookie_str), **sign_headers}
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

    async def search_notes(self, keyword: str, page: int = 1, page_size: int = 20) -> Dict:
        payload = {
            "keyword": keyword,
            "page": page,
            "page_size": page_size,
            "search_id": _generate_search_id(),
            "sort": "general",
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

async def scrape_keyword(
    cookie_str: str,
    keyword: str,
    max_notes: int = 15,
    max_comments_per_note: int = 30,
) -> List[Dict]:
    """
    Search keyword → fetch top notes with comments + sub-comments.
    Returns list of enriched note dicts ready for AI analysis.
    """
    client = XHSClient(cookie_str)
    results = []
    try:
        search_data = await client.search_notes(keyword, page_size=max_notes)
        items = search_data.get("items", [])

        # Kick off note fetches sequentially (search results need ordering)
        for item in items[:max_notes]:
            note_id = item.get("id") or item.get("note_id", "")
            if not note_id:
                continue

            note: Dict = {
                "note_id": note_id,
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
