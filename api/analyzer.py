"""
AI analysis of scraped content using mimo-v2.5.
Platform-aware: adapts prompt for XHS (notes) vs Douyin (short videos).
"""
import json
import os
import re
from typing import Any, Dict, List

import httpx

MIMO_BASE_URL = os.getenv("MIMO_BASE_URL", "https://token-plan-sgp.xiaomimimo.com/v1")
MIMO_API_KEY = os.getenv("MIMO_API_KEY", "")
MIMO_MODEL = os.getenv("MIMO_MODEL", "mimo-v2.5")

_PLATFORM_NAMES = {
    "xhs": "Xiaohongshu (小红书)",
    "douyin": "Douyin (抖音)",
    "bilibili": "Bilibili",
    "weibo": "Weibo (微博)",
}


async def analyze_notes(keyword: str, notes: List[Dict], platform: str = "xhs", language: str = "zh") -> Dict[str, Any]:
    """
    Send scraped notes/videos to mimo-v2.5 and get a structured analysis report.
    Returns a dict with: summary, top_patterns, content_insights,
    comment_insights, suggested_angles, hook_examples, metrics_summary.
    `language` controls the output language of all string fields ("zh" or "en").
    Raises RuntimeError on transport or API failure.
    """
    platform_name = _PLATFORM_NAMES.get(platform, platform.upper())
    notes_text = _format_notes_for_prompt(notes, platform)

    lang = "zh" if language not in ("zh", "en") else language
    lang_instruction = (
        "All string values in the output JSON MUST be written in Simplified Chinese (简体中文). "
        "Keep JSON keys in English exactly as specified. Do not translate keys."
        if lang == "zh"
        else "All string values in the output JSON MUST be in English."
    )

    system_prompt = f"""You are an expert content strategist for {platform_name}.
Your job is to analyze top-performing posts and extract actionable insights for content creators.
Be specific, concrete, and data-driven. Focus on what actually worked, not generic advice.
{lang_instruction}
Respond in JSON format only — no markdown fences, no extra text."""

    is_video = platform in ("douyin", "bilibili")

    user_prompt = f"""Analyze these top-performing {platform_name} {"videos" if is_video else "posts"} for keyword: "{keyword}"

{notes_text}

Return a JSON object with exactly these keys:

{{
  "metrics_summary": {{
    "total_posts_analyzed": <number>,
    "avg_likes": <number>,
    "avg_collects": <number>,
    "avg_comments": <number>,
    "top_post_likes": <number>,
    "engagement_rate_insight": "<1-2 sentence insight about engagement patterns>"
  }},
  "top_patterns": [
    {{
      "pattern": "<pattern name>",
      "frequency": "<how common, e.g. '8/15 posts'>",
      "example": "<brief example from the data>",
      "why_it_works": "<1 sentence explanation>"
    }}
  ],
  "content_insights": {{
    "winning_title_formulas": ["<formula 1>", "<formula 2>", "<formula 3>"],
    "best_content_formats": ["<{'video length/style' if is_video else 'format'} 1 with explanation>", "<format 2>"],
    "optimal_length": "<observation about {'video duration' if is_video else 'post length'} vs engagement>",
    "visual_patterns": "<what type of {'opening frames/thumbnails' if is_video else 'cover images'} performed best>",
    "key_keywords_used": ["<keyword1>", "<keyword2>", "<keyword3>", "<keyword4>", "<keyword5>"],
    "trending_tags": ["<tag1>", "<tag2>", "<tag3>"]
  }},
  "comment_insights": {{
    "top_pain_points": ["<pain point 1>", "<pain point 2>", "<pain point 3>"],
    "common_questions": ["<question 1>", "<question 2>"],
    "sentiment": "<overall sentiment description>",
    "engagement_triggers": ["<what types of comments get more likes/replies>"]
  }},
  "suggested_angles": [
    {{
      "angle": "<angle title>",
      "rationale": "<why this would work based on the data>",
      "differentiation": "<how to stand out from existing top posts>"
    }},
    {{
      "angle": "<angle title>",
      "rationale": "<why this would work based on the data>",
      "differentiation": "<how to stand out from existing top posts>"
    }},
    {{
      "angle": "<angle title>",
      "rationale": "<why this would work based on the data>",
      "differentiation": "<how to stand out from existing top posts>"
    }}
  ],
  "hook_examples": [
    "<compelling opening {'line/hook' if is_video else 'hook for a new post'} — specific and engaging>",
    "<hook 2>",
    "<hook 3>",
    "<hook 4>",
    "<hook 5>"
  ],
  "summary": "<3-4 sentence executive summary of the opportunity in this keyword space>"
}}"""

    payload = {
        "model": MIMO_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "budget_tokens": 3000,
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{MIMO_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {MIMO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"AI analysis failed: HTTP {exc.response.status_code} from {exc.request.url}"
        ) from exc
    except httpx.RequestError as exc:
        raise RuntimeError(f"AI analysis failed: request error — {exc}") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"AI analysis failed: unexpected response shape — {exc}") from exc

    usage = data.get("usage", {})

    try:
        analysis = json.loads(content)
    except json.JSONDecodeError:
        content = re.sub(r"^```(?:json)?\s*", "", content.strip())
        content = re.sub(r"\s*```$", "", content)
        try:
            analysis = json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"AI analysis failed: could not parse JSON response — {exc}") from exc

    analysis["_meta"] = {
        "model": data.get("model", MIMO_MODEL),
        "completion_tokens": usage.get("completion_tokens", 0),
        "reasoning_tokens": usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0),
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "platform": platform,
    }

    return analysis


def _format_notes_for_prompt(notes: List[Dict], platform: str = "xhs") -> str:
    is_video = platform in ("douyin", "bilibili")
    lines = []
    for i, note in enumerate(notes, 1):
        lines.append(f"--- {'VIDEO' if is_video else 'POST'} {i} ---")
        lines.append(f"Title: {note.get('title', 'N/A')}")

        tags = note.get("tags", [])
        if tags:
            lines.append("Tags: " + " ".join(f"#{t}" for t in tags))

        desc = note.get("desc", "")
        if desc and desc != note.get("title", ""):
            lines.append(f"Content: {desc[:400]}")

        if is_video and note.get("duration"):
            lines.append(f"Duration: {note['duration'] / 1000:.0f}s")

        stats = (
            f"Likes: {note.get('liked_count', 0)} | "
            f"Collects: {note.get('collected_count', 0)} | "
            f"Comments: {note.get('comment_count', 0)} | "
            f"Shares: {note.get('share_count', 0)}"
        )
        if is_video and note.get("play_count"):
            stats += f" | Plays: {note.get('play_count', 0)}"
        lines.append(stats)

        lines.append(f"Creator: {note.get('user', 'N/A')}")

        comments = note.get("comments", [])
        if comments:
            lines.append(f"Comments ({len(comments)}):")
            for c in comments[:10]:
                content_text = c.get("content", "")[:120]
                prefix = "  ↳ [REPLY]" if c.get("is_reply") else "  "
                lines.append(f"{prefix}[{c.get('liked_count', 0)} likes] {content_text}")

        lines.append("")

    return "\n".join(lines)
