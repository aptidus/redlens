"""Clerk webhook handler. Mounted at /api/webhooks/clerk.

On `user.created`, insert a User row with the signup grant credits.
On `user.updated`, sync email.
On `user.deleted`, soft-handle (we keep the row for ledger integrity).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook, WebhookVerificationError

from credits import Action, grant
from db import SessionLocal
from models import SIGNUP_GRANT_CREDITS, User

logger = logging.getLogger(__name__)
router = APIRouter()

CLERK_WEBHOOK_SECRET = os.getenv("CLERK_WEBHOOK_SECRET", "").strip()


def _extract_email(data: dict) -> Optional[str]:
    primary_id = data.get("primary_email_address_id")
    for entry in data.get("email_addresses") or []:
        if entry.get("id") == primary_id:
            return entry.get("email_address")
    addrs = data.get("email_addresses") or []
    if addrs:
        return addrs[0].get("email_address")
    return None


@router.post("/api/webhooks/clerk")
async def clerk_webhook(
    request: Request,
    svix_id: str = Header(default="", alias="svix-id"),
    svix_timestamp: str = Header(default="", alias="svix-timestamp"),
    svix_signature: str = Header(default="", alias="svix-signature"),
):
    if not CLERK_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")
    body = await request.body()
    try:
        wh = Webhook(CLERK_WEBHOOK_SECRET)
        evt = wh.verify(
            body,
            {
                "svix-id": svix_id,
                "svix-timestamp": svix_timestamp,
                "svix-signature": svix_signature,
            },
        )
    except WebhookVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = evt.get("type")
    data = evt.get("data") or {}
    clerk_user_id = data.get("id")
    if not clerk_user_id:
        return {"ok": True, "skipped": "no user id"}

    async with SessionLocal() as db:  # type: AsyncSession
        if event_type == "user.created":
            existing = await db.get(User, clerk_user_id)
            if existing:
                logger.info("user.created for existing user %s, skipping", clerk_user_id)
                return {"ok": True, "skipped": "exists"}
            email = _extract_email(data)
            db.add(User(clerk_user_id=clerk_user_id, email=email, credits=0))
            await db.flush()
            await grant(db, clerk_user_id, SIGNUP_GRANT_CREDITS, action=Action.SIGNUP_GRANT)
            logger.info("created user %s (%s) with %d signup credits", clerk_user_id, email, SIGNUP_GRANT_CREDITS)
            return {"ok": True, "action": "created"}

        if event_type == "user.updated":
            user = await db.get(User, clerk_user_id)
            if user is not None:
                email = _extract_email(data)
                if email and user.email != email:
                    user.email = email
                    await db.commit()
            return {"ok": True, "action": "updated"}

        if event_type == "user.deleted":
            # Keep the row for ledger integrity. Just log.
            logger.info("user.deleted webhook for %s — keeping row", clerk_user_id)
            return {"ok": True, "action": "deleted_noop"}

    return {"ok": True, "action": "ignored", "type": event_type}
