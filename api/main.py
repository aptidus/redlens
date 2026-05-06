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
from xhs_client import XHSAuthError, XHSRateLimitError, scrape_keyword
from login_manager import xhs_qr_login

app = FastAPI(title="RedLens", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ValidateCookieRequest(BaseModel):
    cookie: str


@app.on_event("startup")
async def _startup():
    if not os.getenv("MIMO_API_KEY"):
        logger.warning("MIMO_API_KEY not set — AI analysis will fail")
    logger.info("RedLens v2 started. Model: %s", os.getenv("MIMO_MODEL", "mimo-v2.5"))


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model": os.getenv("MIMO_MODEL", "mimo-v2.5"),
        "api_key_set": bool(os.getenv("MIMO_API_KEY")),
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
    """Quick check that the XHS cookie is valid by doing a test search."""
    from xhs_client import XHSClient
    client = XHSClient(req.cookie)
    try:
        await client.search_notes("test", page_size=1)
        await client.close()
        return {"valid": True}
    except XHSAuthError as e:
        await client.close()
        return {"valid": False, "error": "Cookie expired or invalid. Please scan QR again.", "code": "auth"}
    except Exception as e:
        await client.close()
        return {"valid": False, "error": str(e)[:200], "code": "unknown"}


@app.get("/api/analyze")
async def analyze_stream(keyword: str, cookie: str, max_notes: int = 15):
    """SSE stream: crawl XHS → AI analysis → done."""
    if not keyword.strip():
        raise HTTPException(400, "keyword required")
    if not cookie.strip():
        raise HTTPException(400, "cookie required")
    if max_notes < 1 or max_notes > 30:
        raise HTTPException(400, "max_notes must be 1–30")

    async def event_generator():
        try:
            yield {"event": "status", "data": json.dumps({
                "stage": "crawling",
                "message": f'Searching XHS for "{keyword}"…',
            })}

            notes = await scrape_keyword(cookie, keyword, max_notes=max_notes)

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

            analysis = await analyze_notes(keyword, notes)

            analysis["_posts"] = [
                {
                    "title": n.get("title", ""),
                    "user": n.get("user", ""),
                    "liked_count": n.get("liked_count", 0),
                    "collected_count": n.get("collected_count", 0),
                    "comment_count": n.get("comment_count", 0),
                    "cover_url": n.get("cover_url", ""),
                    "type": n.get("type", "normal"),
                    "tags": n.get("tags", []),
                }
                for n in notes
            ]

            yield {"event": "done", "data": json.dumps(analysis)}

        except XHSAuthError:
            yield {"event": "error", "data": json.dumps({
                "message": "Your 小红书 session has expired. Please scan QR to reconnect.",
                "code": "auth",
            })}
        except XHSRateLimitError:
            yield {"event": "error", "data": json.dumps({
                "message": "XHS rate limit hit. Wait a few minutes and try again.",
                "code": "rate_limit",
            })}
        except Exception as e:
            logger.exception("analyze_stream error for keyword=%r", keyword)
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_generator())


# ── Static frontend ───────────────────────────────────────────────────────────

_here = Path(os.path.abspath(__file__)).parent
frontend_dist = _here / "frontend" / "dist"
logger.info("Frontend dist: %s (exists=%s)", frontend_dist, frontend_dist.exists())

if (frontend_dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")


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
