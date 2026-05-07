"""Clerk JWT verification.

Clerk issues short-lived JWTs signed with RS256. Verify against their JWKS
(cached). The `sub` claim is the Clerk user id — we use that as our PK.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from models import User

logger = logging.getLogger(__name__)

CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL", "").strip()
CLERK_ISSUER = os.getenv("CLERK_ISSUER", "").strip()  # e.g. https://clean-falcon-12.clerk.accounts.dev

if not CLERK_JWKS_URL and CLERK_ISSUER:
    CLERK_JWKS_URL = CLERK_ISSUER.rstrip("/") + "/.well-known/jwks.json"

ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "").split(",")
    if e.strip()
}


def is_admin_email(email: str | None) -> bool:
    return bool(email) and email.lower() in ADMIN_EMAILS

_jwk_client: Optional[PyJWKClient] = None


def is_configured() -> bool:
    return bool(CLERK_JWKS_URL)


def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if not CLERK_JWKS_URL:
        raise HTTPException(status_code=503, detail="Auth not configured")
    if _jwk_client is None:
        _jwk_client = PyJWKClient(CLERK_JWKS_URL, cache_keys=True, lifespan=3600)
    return _jwk_client


def _verify_token(token: str) -> dict:
    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token).key
        # Clerk default JWT template doesn't set `aud`. We verify iss + signature + exp.
        options = {"verify_aud": False}
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=CLERK_ISSUER or None,
            options=options,
        )
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


async def _ensure_user(db: AsyncSession, clerk_user_id: str, email: Optional[str]) -> User:
    """Lazy-create user row if Clerk webhook hasn't fired yet (rare race)."""
    user = await db.get(User, clerk_user_id)
    if user is None:
        user = User(clerk_user_id=clerk_user_id, email=email)
        db.add(user)
        await db.flush()
    elif email and user.email != email:
        user.email = email
    return user


async def current_user(
    authorization: str = Header(default=""),
    token: str = "",
    db: AsyncSession = Depends(get_db),
) -> User:
    """FastAPI dependency: resolves Clerk JWT → User row.

    Accepts the JWT either as `Authorization: Bearer <jwt>` (preferred) or as
    a `?token=<jwt>` query param. The query-param path exists because the
    browser EventSource API can't set custom headers; Clerk JWTs are ~60s
    short-lived so log-leak risk is bounded.
    """
    raw = ""
    if authorization.lower().startswith("bearer "):
        raw = authorization.split(" ", 1)[1].strip()
    elif token:
        raw = token.strip()
    if not raw:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    claims = _verify_token(raw)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")
    email = claims.get("email") or claims.get("primary_email_address")
    user = await _ensure_user(db, sub, email)
    await db.commit()
    await db.refresh(user)
    return user


async def current_admin(user: User = Depends(current_user)) -> User:
    """Same as current_user but requires the email to be in ADMIN_EMAILS."""
    if not is_admin_email(user.email):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
