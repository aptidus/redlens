"""Async SQLAlchemy engine + session factory.

Lazy-initialized so the module imports cleanly even when DATABASE_URL is unset
(e.g. during a partial deploy before Postgres is wired up). Endpoints that
actually touch the DB raise 503 if it's missing.
"""
from __future__ import annotations

import os
from typing import AsyncGenerator, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def _resolve_url() -> Optional[str]:
    raw = os.getenv("DATABASE_URL", "").strip()
    if not raw:
        return None
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    if raw.startswith("postgresql://") and "+asyncpg" not in raw:
        raw = raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    return raw


def _init() -> None:
    global _engine, _session_factory
    url = _resolve_url()
    if not url:
        return
    if _engine is None:
        _engine = create_async_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


def is_configured() -> bool:
    return _resolve_url() is not None


# Module-level handles. Only valid after _init() has populated them.
DATABASE_URL = _resolve_url() or ""
_init()


def SessionLocal() -> AsyncSession:
    """Returns a fresh AsyncSession. Raises 503 if DB is not configured."""
    if _session_factory is None:
        _init()
    if _session_factory is None:
        raise HTTPException(status_code=503, detail="Database not configured")
    return _session_factory()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    if _session_factory is None:
        _init()
    if _session_factory is None:
        raise HTTPException(status_code=503, detail="Database not configured")
    async with _session_factory() as session:
        yield session


def get_engine() -> AsyncEngine:
    """For migrations / startup. Raises if DB is not configured."""
    if _engine is None:
        _init()
    if _engine is None:
        raise RuntimeError("DATABASE_URL not set")
    return _engine
