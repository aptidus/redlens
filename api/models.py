"""SQLAlchemy models."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


SIGNUP_GRANT_CREDITS = 100


class User(Base):
    __tablename__ = "users"

    clerk_user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True, index=True)
    credits: Mapped[int] = mapped_column(Integer, nullable=False, default=SIGNUP_GRANT_CREDITS)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<User clerk={self.clerk_user_id} credits={self.credits}>"


class CreditLedger(Base):
    """Append-only audit trail. Every credit change here, easy to debug usage spikes."""

    __tablename__ = "credit_ledger"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    clerk_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)  # positive=grant, negative=spend
    action: Mapped[str] = mapped_column(String(32), nullable=False)  # 'signup_grant', 'analyze', 'create_post', 'multimedia_post'
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_credit_ledger_user_created", "clerk_user_id", "created_at"),
    )
