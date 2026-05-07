import base64
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
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
from admin import router as admin_router
from auth import current_user, is_admin_email
from credits import Action, spend
from db import SessionLocal, get_db
from models import User
from webhooks import router as webhooks_router

app = FastAPI(title="NicheLens", version="3.1.0")

# Allowed callers — comma-separated origins. Empty/unset = legacy permissive
# behavior so existing /staging access keeps working during migration.
_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("REDLENS_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["x-redlens-status"],
)

SUPPORTED_PLATFORMS = {"xhs", "douyin"}

# ── Internal token gate ─────────────────────────────────────────────────────
# When REDLENS_INTERNAL_TOKEN is set, sensitive endpoints require the matching
# `x-internal-token` header from callers (the Next.js SSE proxy). When unset
# (early staging), endpoints stay open so curl-driven QA still works.

_INTERNAL_TOKEN = os.getenv("REDLENS_INTERNAL_TOKEN", "").strip()


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    """FastAPI dependency: 401 unless `x-internal-token` matches env."""
    if not _INTERNAL_TOKEN:
        # Token not configured — allow (legacy behavior). Logged once at startup.
        return
    if not secrets.compare_digest(x_internal_token, _INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal token")


# ── Basic Auth gate for the staging frontend ─────────────────────────────────
# The standalone RedLens SPA on this host is for owner testing only. Production
# users go through app.nichelens.ai. Routes that don't need protection:
#   /api/*         — internal-token gated, called from the prod Next.js backend
#   /extension.zip — public download (referenced by app.nichelens.ai)
#   /favicon.ico   — convenience
# Everything else requires HTTP Basic Auth matching STAGING_USER/STAGING_PASSWORD.

_STAGING_USER = os.getenv("STAGING_USER", "").strip()
_STAGING_PASSWORD = os.getenv("STAGING_PASSWORD", "").strip()
_PUBLIC_PATHS = ("/api/", "/extension.zip", "/favicon.ico")


@app.middleware("http")
async def staging_basic_auth(request: Request, call_next):
    if not _STAGING_USER or not _STAGING_PASSWORD:
        return await call_next(request)
    path = request.url.path
    if path.startswith(_PUBLIC_PATHS):
        return await call_next(request)

    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(auth_header[6:].strip()).decode("utf-8")
            user, _, password = decoded.partition(":")
            if (
                secrets.compare_digest(user, _STAGING_USER)
                and secrets.compare_digest(password, _STAGING_PASSWORD)
            ):
                return await call_next(request)
        except Exception:
            pass

    return Response(
        status_code=401,
        content="Restricted",
        headers={"WWW-Authenticate": 'Basic realm="RedLens staging"'},
    )


class ValidateCookieRequest(BaseModel):
    cookie: str
    platform: str = "xhs"


app.include_router(webhooks_router)
app.include_router(admin_router)


@app.on_event("startup")
async def _startup():
    if not os.getenv("MIMO_API_KEY"):
        logger.warning("MIMO_API_KEY not set — AI analysis will fail")
    if not os.getenv("DATABASE_URL"):
        logger.error("DATABASE_URL not set — credit gating will refuse all requests")
    if not (os.getenv("CLERK_JWKS_URL") or os.getenv("CLERK_ISSUER")):
        logger.error("CLERK_JWKS_URL/CLERK_ISSUER not set — auth will reject all tokens")
    if not os.getenv("CLERK_WEBHOOK_SECRET"):
        logger.warning("CLERK_WEBHOOK_SECRET not set — signup webhook will 503")
    if _ALLOWED_ORIGINS == ["*"]:
        logger.warning(
            "REDLENS_ALLOWED_ORIGINS not set — CORS allows all origins. "
            "Set to https://nichelens.ai in production."
        )
    logger.info("NicheLens started. Model: %s", os.getenv("MIMO_MODEL", "mimo-v2.5"))


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model": os.getenv("MIMO_MODEL", "mimo-v2.5"),
        "api_key_set": bool(os.getenv("MIMO_API_KEY")),
        "platforms": list(SUPPORTED_PLATFORMS),
    }


class AnalyzeFromResultsRequest(BaseModel):
    keyword: str
    notes: list[dict]
    platform: str = "xhs"
    language: str = "zh"


@app.post("/api/analyze-from-results")
async def analyze_from_results(
    req: AnalyzeFromResultsRequest,
    user: User = Depends(current_user),
):
    """Run AI analysis on notes the extension already scraped from the user's
    own browser. Costs 1 credit. Skips the server-side XHS/Douyin call entirely
    so server-IP blocks (XHS code -104) don't apply."""
    if not req.keyword.strip():
        raise HTTPException(400, "keyword required")
    if not req.notes:
        raise HTTPException(400, "notes required")
    platform = req.platform.lower()
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, f"Unknown platform: {platform}")

    async with SessionLocal() as charge_db:
        bound = await charge_db.get(User, user.clerk_user_id)
        new_balance = await spend(charge_db, bound, Action.ANALYZE)

    try:
        analysis = await analyze_notes(req.keyword, req.notes, platform=platform, language=req.language)
    except Exception as e:
        # Refund on AI failure.
        from credits import grant
        async with SessionLocal() as refund_db:
            await grant(refund_db, user.clerk_user_id, 1, action=Action.REFUND)
        logger.exception("analyze_from_results failed for %s", user.clerk_user_id)
        raise HTTPException(500, f"Analysis failed: {e}")

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
        for n in req.notes
    ]
    analysis["_platform"] = platform
    analysis["_credits_remaining"] = new_balance
    return analysis


@app.get("/api/me")
async def me(user: User = Depends(current_user)):
    """Returns the signed-in user's email + credit balance + admin flag."""
    return {
        "clerk_user_id": user.clerk_user_id,
        "email": user.email,
        "credits": user.credits,
        "is_admin": is_admin_email(user.email),
    }


@app.get("/api/login/qr", dependencies=[Depends(require_internal_token)])
async def login_qr():
    """SSE stream: XHS QR login. Events: status, qr, authenticated, error."""
    async def gen():
        async for event in xhs_qr_login():
            yield event
    return EventSourceResponse(gen())


@app.post("/api/validate-cookie", dependencies=[Depends(require_internal_token)])
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
async def analyze_stream(
    keyword: str,
    cookie: str,
    max_notes: int = 15,
    platform: str = "xhs",
    date_range: str = "all",
    language: str = "zh",
    user: User = Depends(current_user),
):
    """SSE stream: crawl platform → AI analysis → done. Costs 1 credit."""
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

    # Charge 1 credit up-front. Insufficient → 402 before any work begins.
    # On stream-failure paths below we refund (see refund logic in event_generator).
    async with SessionLocal() as charge_db:
        # Re-fetch user inside this session so the row is bound here.
        bound = await charge_db.get(User, user.clerk_user_id)
        new_balance = await spend(charge_db, bound, Action.ANALYZE)

    async def _refund(reason: str):
        """Restore the credit on auth/rate/permission/no-results failures."""
        try:
            from credits import grant
            async with SessionLocal() as refund_db:
                await grant(refund_db, user.clerk_user_id, 1, action=Action.REFUND)
            logger.info("refunded analyze credit to %s (%s)", user.clerk_user_id, reason)
        except Exception:
            logger.exception("refund failed for %s", user.clerk_user_id)

    async def event_generator():
        try:
            yield {"event": "balance", "data": json.dumps({"credits": new_balance})}
            yield {"event": "status", "data": json.dumps({
                "stage": "crawling",
                "message": f'Searching {label} for "{keyword}"…',
            })}

            if platform == "xhs":
                notes = await scrape_keyword(cookie, keyword, max_notes=max_notes, date_range=date_range)
            else:
                notes = await scrape_douyin(cookie, keyword, max_notes=max_notes, date_range=date_range)

            if not notes:
                await _refund("no_results")
                yield {"event": "error", "data": json.dumps({
                    "message": "No posts found. Try a different keyword or check your account connection.",
                    "code": "no_results",
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

        except XHSPermissionError:
            await _refund("xhs_permission")
            yield {"event": "error", "data": json.dumps({
                "message": (
                    "XHS account access denied (code -104). "
                    "XHS is blocking API calls from this server's IP. "
                    "Reconnect via the extension or paste a fresh cookie."
                ),
                "code": "permission",
            })}
        except (XHSAuthError, DouyinAuthError):
            await _refund("auth")
            yield {"event": "error", "data": json.dumps({
                "message": f"Your {label} session has expired. Please reconnect.",
                "code": "auth",
            })}
        except (XHSRateLimitError, DouyinRateLimitError):
            await _refund("rate_limit")
            yield {"event": "error", "data": json.dumps({
                "message": f"{label} rate limit hit. Wait a few minutes and try again.",
                "code": "rate_limit",
            })}
        except Exception as e:
            await _refund("internal_error")
            logger.exception("analyze_stream error for keyword=%r platform=%r", keyword, platform)
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_generator())


# ── Static frontend ───────────────────────────────────────────────────────────

_here = Path(os.path.abspath(__file__)).parent
frontend_dist = _here / "frontend" / "dist"
extension_zip = _here / "nichelens-extension.zip"
if not extension_zip.exists():
    # Backwards-compat: pre-rename images may still ship the old filename.
    legacy = _here / "redlens-extension.zip"
    if legacy.exists():
        extension_zip = legacy
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
            filename="nichelens-extension.zip",
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
