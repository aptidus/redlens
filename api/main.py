import json
import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

from analyzer import analyze_notes
from xhs_client import XHSAuthError, XHSPermissionError, XHSRateLimitError, scrape_keyword
from douyin_client import DouyinAuthError, DouyinRateLimitError, scrape_douyin
from login_manager import xhs_qr_login

app = FastAPI(title="RedLens", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPPORTED_PLATFORMS = {"xhs", "douyin"}


class ValidateCookieRequest(BaseModel):
    cookie: str
    platform: str = "xhs"


@app.on_event("startup")
async def _startup():
    if not os.getenv("MIMO_API_KEY"):
        logger.warning("MIMO_API_KEY not set — AI analysis will fail")
    logger.info("RedLens v3 started. Model: %s", os.getenv("MIMO_MODEL", "mimo-v2.5"))


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model": os.getenv("MIMO_MODEL", "mimo-v2.5"),
        "api_key_set": bool(os.getenv("MIMO_API_KEY")),
        "platforms": list(SUPPORTED_PLATFORMS),
    }


@app.get("/api/login/qr")
async def login_qr():
    """SSE stream: XHS QR login. Events: status, qr, authenticated, error."""
    async def gen():
        async for event in xhs_qr_login():
            yield event
    return EventSourceResponse(gen())


@app.post("/api/validate-cookie")
async def validate_cookie(req: ValidateCookieRequest):
    """Quick check that the platform cookie is valid."""
    platform = req.platform.lower()

    if platform == "xhs":
        from xhs_client import XHSClient
        client = XHSClient(req.cookie)
        try:
            await client.search_notes("test", page_size=1)
            await client.close()
            return {"valid": True}
        except XHSAuthError:
            await client.close()
            return {"valid": False, "error": "Cookie expired or invalid. Please scan QR again.", "code": "auth"}
        except Exception as e:
            await client.close()
            return {"valid": False, "error": str(e)[:200], "code": "unknown"}

    elif platform == "douyin":
        from douyin_client import DouyinClient
        client = DouyinClient(req.cookie)
        try:
            await client.search_videos("test", count=1)
            await client.close()
            return {"valid": True}
        except DouyinAuthError:
            await client.close()
            return {"valid": False, "error": "Cookie expired or invalid. Please update your Douyin cookie.", "code": "auth"}
        except Exception as e:
            await client.close()
            return {"valid": False, "error": str(e)[:200], "code": "unknown"}

    else:
        raise HTTPException(400, f"Unknown platform: {platform}. Supported: {list(SUPPORTED_PLATFORMS)}")


@app.get("/api/analyze")
async def analyze_stream(keyword: str, cookie: str, max_notes: int = 15, platform: str = "xhs", date_range: str = "all", language: str = "zh"):
    """SSE stream: crawl platform → AI analysis → done."""
    if not keyword.strip():
        raise HTTPException(400, "keyword required")
    if not cookie.strip():
        raise HTTPException(400, "cookie required")
    if max_notes < 1 or max_notes > 30:
        raise HTTPException(400, "max_notes must be 1–30")

    platform = platform.lower()
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, f"Unknown platform: {platform}")

    platform_labels = {
        "xhs": "小红书",
        "douyin": "抖音",
    }
    label = platform_labels.get(platform, platform)

    async def event_generator():
        try:
            yield {"event": "status", "data": json.dumps({
                "stage": "crawling",
                "message": f'Searching {label} for "{keyword}"…',
            })}

            if platform == "xhs":
                notes = await scrape_keyword(cookie, keyword, max_notes=max_notes, date_range=date_range)
            else:
                notes = await scrape_douyin(cookie, keyword, max_notes=max_notes, date_range=date_range)

            if not notes:
                yield {"event": "error", "data": json.dumps({
                    "message": "No posts found. Try a different keyword or check your account connection.",
                })}
                return

            yield {"event": "status", "data": json.dumps({
                "stage": "analyzing",
                "message": f"Analyzing {len(notes)} posts with AI…",
                "count": len(notes),
            })}

            analysis = await analyze_notes(keyword, notes, platform=platform, language=language)

            analysis["_posts"] = [
                {
                    "title": n.get("title", ""),
                    "user": n.get("user", ""),
                    "liked_count": n.get("liked_count", 0),
                    "collected_count": n.get("collected_count", 0),
                    "comment_count": n.get("comment_count", 0),
                    "play_count": n.get("play_count", 0),
                    "cover_url": n.get("cover_url", ""),
                    "type": n.get("type", "normal"),
                    "tags": n.get("tags", []),
                    "duration": n.get("duration", 0),
                    "note_url": n.get("note_url", ""),
                }
                for n in notes
            ]
            analysis["_platform"] = platform

            yield {"event": "done", "data": json.dumps(analysis)}

        except XHSPermissionError as e:
            yield {"event": "error", "data": json.dumps({
                "message": (
                    "XHS account access denied (code -104). "
                    "This means XHS is blocking API calls from this server's IP address. "
                    "Please reconnect via QR or paste a fresh cookie — "
                    "the browser-based search fallback should handle it automatically. "
                    "If the error persists, try logging out and scanning QR again."
                ),
                "code": "permission",
            })}
        except (XHSAuthError, DouyinAuthError):
            yield {"event": "error", "data": json.dumps({
                "message": f"Your {label} session has expired. Please reconnect.",
                "code": "auth",
            })}
        except (XHSRateLimitError, DouyinRateLimitError):
            yield {"event": "error", "data": json.dumps({
                "message": f"{label} rate limit hit. Wait a few minutes and try again.",
                "code": "rate_limit",
            })}
        except Exception as e:
            logger.exception("analyze_stream error for keyword=%r platform=%r", keyword, platform)
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_generator())


# ── Static frontend ───────────────────────────────────────────────────────────

_here = Path(os.path.abspath(__file__)).parent
frontend_dist = _here / "frontend" / "dist"
extension_zip = _here / "redlens-extension.zip"
logger.info("Frontend dist: %s (exists=%s)", frontend_dist, frontend_dist.exists())
logger.info("Extension zip: %s (exists=%s)", extension_zip, extension_zip.exists())

if (frontend_dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")


@app.get("/extension.zip")
async def serve_extension_zip():
    """Self-host the Chrome extension zip so users in China can download it
    without going through GitHub."""
    if extension_zip.exists():
        return FileResponse(
            str(extension_zip),
            media_type="application/zip",
            filename="redlens-extension.zip",
        )
    raise HTTPException(404, "Extension zip not built")


@app.get("/")
async def serve_root():
    p = frontend_dist / "index.html"
    if p.exists():
        return FileResponse(str(p))
    return JSONResponse({"detail": "Frontend not built", "path": str(frontend_dist)}, status_code=503)


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404)
    p = frontend_dist / "index.html"
    if p.exists():
        return FileResponse(str(p))
    return JSONResponse({"detail": "Frontend not built"}, status_code=503)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8080)), reload=False)
