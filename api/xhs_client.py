"""
Minimal XHS API client using cookie-based auth + xhshow signing.
No Playwright required — pure HTTP calls once cookies are provided.
"""
import asyncio
import hashlib
import json
import random
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode, quote

import httpx

XHS_HOST = "https://edith.xiaohongshu.com"
XHS_DOMAIN = "https://www.xiaohongshu.com"


def _get_common_headers(cookie_str: str) -> Dict[str, str]:
    return {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": XHS_DOMAIN,
        "Origin": XHS_DOMAIN,
        "Cookie": cookie_str,
        "Content-Type": "application/json",
    }


def _sign_request(uri: str, params: Optional[Dict] = None, payload: Optional[Dict] = None, cookie_str: str = "") -> Dict[str, str]:
    """Generate X-S / X-T headers via xhshow pure-algorithm library."""
    try:
        from xhshow import XhsShow
        method = "GET" if params is not None else "POST"
        data = params if params is not None else payload
        signer = XhsShow()
        result = signer.sign(uri=uri, data=data, cookie_str=cookie_str, method=method)
        return {
            "X-S": result.get("x-s", ""),
            "X-T": str(result.get("x-t", "")),
            "x-S-Common": result.get("x-s-common", ""),
            "X-B3-Traceid": result.get("x-b3-traceid", ""),
        }
    except Exception:
        # Fallback: return empty headers (will likely get 401, but fail gracefully)
        return {}


class XHSClient:
    def __init__(self, cookie_str: str):
        self.cookie_str = cookie_str
        self._client = httpx.AsyncClient(timeout=30)

    async def close(self):
        await self._client.aclose()

    async def _get(self, uri: str, params: Dict) -> Any:
        sign_headers = _sign_request(uri, params=params, cookie_str=self.cookie_str)
        headers = {**_get_common_headers(self.cookie_str), **sign_headers}
        url = f"{XHS_HOST}{uri}?{urlencode(params)}"
        resp = await self._client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") is False:
            raise ValueError(f"XHS API error: {data.get('msg', 'unknown')} (code {data.get('code')})")
        return data.get("data", data)

    async def _post(self, uri: str, payload: Dict) -> Any:
        sign_headers = _sign_request(uri, payload=payload, cookie_str=self.cookie_str)
        headers = {**_get_common_headers(self.cookie_str), **sign_headers}
        url = f"{XHS_HOST}{uri}"
        resp = await self._client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") is False:
            raise ValueError(f"XHS API error: {data.get('msg', 'unknown')} (code {data.get('code')})")
        return data.get("data", data)

    async def search_notes(self, keyword: str, page: int = 1, page_size: int = 20) -> Dict:
        """Search notes by keyword. Returns list of note items."""
        payload = {
            "keyword": keyword,
            "page": page,
            "page_size": page_size,
            "search_id": _generate_search_id(),
            "sort": "general",
            "note_type": 0,
        }
        return await self._post("/api/sns/web/v1/search/notes", payload)

    async def get_note_detail(self, note_id: str, xsec_token: str = "", xsec_source: str = "pc_search") -> Dict:
        """Get full note detail including content."""
        params = {
            "source": xsec_source,
            "note_id": note_id,
            "xsec_token": xsec_token,
            "xsec_source": xsec_source,
        }
        return await self._get("/api/sns/web/v1/feed", params)

    async def get_note_comments(self, note_id: str, cursor: str = "") -> Dict:
        """Get comments for a note."""
        params = {
            "note_id": note_id,
            "cursor": cursor,
            "top_comment_id": "",
            "image_formats": "jpg,webp,avif",
        }
        return await self._get("/api/sns/web/v1/comment/list", params)

    async def get_note_sub_comments(self, note_id: str, root_comment_id: str, cursor: str = "") -> Dict:
        """Get replies to a specific comment."""
        params = {
            "note_id": note_id,
            "root_comment_id": root_comment_id,
            "num": 10,
            "cursor": cursor,
            "image_formats": "jpg,webp,avif",
            "top_comment_id": "",
        }
        return await self._get("/api/sns/web/v1/comment/sub/list", params)


def _generate_search_id() -> str:
    """Generate a random search_id matching XHS format."""
    ts = int(time.time() * 1000)
    rand = random.randint(100000, 999999)
    return f"{ts}{rand}"


async def scrape_keyword(cookie_str: str, keyword: str, max_notes: int = 15, max_comments_per_note: int = 30) -> List[Dict]:
    """
    High-level function: search keyword → fetch top notes with comments.
    Returns list of enriched note dicts ready for AI analysis.
    """
    client = XHSClient(cookie_str)
    results = []
    try:
        search_data = await client.search_notes(keyword, page_size=max_notes)
        items = search_data.get("items", [])

        for item in items[:max_notes]:
            note_id = item.get("id") or item.get("note_id", "")
            xsec_token = item.get("xsec_token", "")
            if not note_id:
                continue

            note = {
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
                "comments": [],
            }

            # Fetch top comments
            try:
                comment_data = await client.get_note_comments(note_id)
                comments = comment_data.get("comments", [])[:max_comments_per_note]
                for c in comments:
                    note["comments"].append({
                        "content": c.get("content", ""),
                        "liked_count": c.get("like_count", 0),
                        "user": c.get("user_info", {}).get("nickname", ""),
                    })
                await asyncio.sleep(0.5)  # Rate limiting
            except Exception:
                pass  # Comments optional

            results.append(note)
            await asyncio.sleep(0.8)  # Rate limiting between notes

    finally:
        await client.close()

    return results


def _extract_title(item: Dict) -> str:
    card = item.get("note_card", {})
    return card.get("title") or card.get("display_title", "")


def _extract_desc(item: Dict) -> str:
    card = item.get("note_card", {})
    return card.get("desc", "")


def _extract_user(item: Dict) -> str:
    card = item.get("note_card", {})
    user = card.get("user", {})
    return user.get("nickname", "")


def _extract_cover(item: Dict) -> str:
    card = item.get("note_card", {})
    cover = card.get("cover", {})
    urls = cover.get("url_default") or cover.get("url_pre", "")
    return urls


def _safe_int(item: Dict, key: str) -> int:
    card = item.get("note_card", {})
    interact = card.get("interact_info", {})
    val = interact.get(key, 0)
    try:
        if isinstance(val, str):
            val = val.replace("万", "0000").replace("+", "")
        return int(val)
    except (ValueError, TypeError):
        return 0
