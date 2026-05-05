"""
AI analysis of scraped XHS notes using mimo-v2.5.
Uses budget_tokens (not max_tokens) to control output length — reasoning runs freely on top.
"""
import json
import os
from typing import Any, Dict, List

import httpx

MIMO_BASE_URL = os.getenv("MIMO_BASE_URL", "https://token-plan-sgp.xiaomimimo.com/v1")
MIMO_API_KEY = os.getenv("MIMO_API_KEY", "")
MIMO_MODEL = os.getenv("MIMO_MODEL", "mimo-v2.5")


async def analyze_notes(keyword: str, notes: List[Dict]) -> Dict[str, Any]:
    """
    Send scraped notes to mimo-v2.5 and get a structured analysis report.
    Returns a dict with keys: summary, top_patterns, content_insights,
    comment_insights, suggested_angles, hook_examples, metrics_summary.
    """
    notes_text = _format_notes_for_prompt(notes)

    system_prompt = """You are an expert content strategist for Xiaohongshu (Little Red Book / 小红书).
Your job is to analyze top-performing posts and extract actionable insights for content creators.
Be specific, concrete, and data-driven. Focus on what actually worked, not generic advice.
Respond in JSON format only — no markdown fences, no extra text."""

    user_prompt = f"""Analyze these top-performing Xiaohongshu posts for keyword: "{keyword}"

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
    "best_content_formats": ["<format 1 with explanation>", "<format 2>"],
    "optimal_length": "<observation about post length vs engagement>",
    "visual_patterns": "<what type of cover images/videos performed best>",
    "key_keywords_used": ["<keyword1>", "<keyword2>", "<keyword3>", "<keyword4>", "<keyword5>"]
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
    "<compelling opening hook for a new post — specific and engaging>",
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
        "budget_tokens": 2000,
        "response_format": {"type": "json_object"},
    }

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

    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})

    try:
        analysis = json.loads(content)
    except json.JSONDecodeError:
        # Strip any accidental markdown fences
        import re
        content = re.sub(r"^```(?:json)?\s*", "", content.strip())
        content = re.sub(r"\s*```$", "", content)
        analysis = json.loads(content)

    analysis["_meta"] = {
        "model": data.get("model", MIMO_MODEL),
        "completion_tokens": usage.get("completion_tokens", 0),
        "reasoning_tokens": usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0),
        "prompt_tokens": usage.get("prompt_tokens", 0),
    }

    return analysis


def _format_notes_for_prompt(notes: List[Dict]) -> str:
    lines = []
    for i, note in enumerate(notes, 1):
        lines.append(f"--- POST {i} ---")
        lines.append(f"Title: {note.get('title', 'N/A')}")
        if note.get("desc"):
            lines.append(f"Content: {note['desc'][:300]}")
        lines.append(f"Type: {note.get('type', 'normal')}")
        lines.append(f"Likes: {note.get('liked_count', 0)} | Collects: {note.get('collected_count', 0)} | Comments: {note.get('comment_count', 0)} | Shares: {note.get('share_count', 0)}")
        lines.append(f"Creator: {note.get('user', 'N/A')}")

        comments = note.get("comments", [])
        if comments:
            lines.append(f"Top Comments ({len(comments)}):")
            for c in comments[:10]:
                if c.get("content"):
                    lines.append(f"  [{c.get('liked_count', 0)} likes] {c['content'][:100]}")

        lines.append("")

    return "\n".join(lines)
