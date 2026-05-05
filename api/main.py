import asyncio
import json
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

from analyzer import analyze_notes
from xhs_client import scrape_keyword

app = FastAPI(title="RedLens", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    keyword: str
    cookie: str
    max_notes: Optional[int] = 15


class ValidateCookieRequest(BaseModel):
    cookie: str


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": os.getenv("MIMO_MODEL", "mimo-v2.5")}


@app.post("/api/validate-cookie")
async def validate_cookie(req: ValidateCookieRequest):
    """Quick check that the provided XHS cookie is valid."""
    from xhs_client import XHSClient
    client = XHSClient(req.cookie)
    try:
        data = await client.search_notes("test", page_size=1)
        await client.close()
        return {"valid": True}
    except Exception as e:
        await client.close()
        return {"valid": False, "error": str(e)[:200]}


@app.get("/api/analyze")
async def analyze_stream(keyword: str, cookie: str, max_notes: int = 15):
    """
    Server-Sent Events endpoint.
    Streams progress: crawling → analyzing → done (with result JSON).
    """
    if not keyword.strip():
        raise HTTPException(400, "keyword required")
    if not cookie.strip():
        raise HTTPException(400, "cookie required")

    async def event_generator():
        try:
            yield {"event": "status", "data": json.dumps({"stage": "crawling", "message": f"Searching XHS for "{keyword}"…"})}

            notes = await scrape_keyword(cookie, keyword, max_notes=max_notes)

            if not notes:
                yield {"event": "error", "data": json.dumps({"message": "No posts found. Check your cookie or try a different keyword."})}
                return

            yield {"event": "status", "data": json.dumps({"stage": "analyzing", "message": f"Analyzing {len(notes)} posts with AI…", "count": len(notes)})}

            analysis = await analyze_notes(keyword, notes)

            # Attach the raw notes summary for the UI
            analysis["_posts"] = [
                {
                    "title": n.get("title", ""),
                    "user": n.get("user", ""),
                    "liked_count": n.get("liked_count", 0),
                    "collected_count": n.get("collected_count", 0),
                    "comment_count": n.get("comment_count", 0),
                    "cover_url": n.get("cover_url", ""),
                    "type": n.get("type", "normal"),
                }
                for n in notes
            ]

            yield {"event": "done", "data": json.dumps(analysis)}

        except Exception as e:
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_generator())


# Serve React frontend in production
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        index = frontend_dist / "index.html"
        return FileResponse(str(index))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8080)), reload=False)
