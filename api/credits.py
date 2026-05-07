"""Credit deduction with row-level locking + ledger audit.

Spend model:
  - analyze         : 1 credit
  - create_post     : 1 credit
  - multimedia_post : 1 extra credit (callers spend create_post AND multimedia_post)
"""
from __future__ import annotations

import logging
from enum import Enum

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import CreditLedger, User

logger = logging.getLogger(__name__)


class Action(str, Enum):
    ANALYZE = "analyze"
    CREATE_POST = "create_post"
    MULTIMEDIA_POST = "multimedia_post"
    SIGNUP_GRANT = "signup_grant"
    ADMIN_GRANT = "admin_grant"
    ADMIN_SET = "admin_set"
    REFUND = "refund"


COST = {
    Action.ANALYZE: 1,
    Action.CREATE_POST: 1,
    Action.MULTIMEDIA_POST: 1,
}


async def spend(db: AsyncSession, user: User, action: Action) -> int:
    """Atomically debit `COST[action]` credits. Raises 402 if insufficient.

    Re-reads the user with FOR UPDATE so concurrent analyze calls can't
    over-spend. Returns the new balance.
    """
    cost = COST.get(action)
    if cost is None:
        raise ValueError(f"Action {action} is not spendable")

    locked = await db.execute(
        select(User).where(User.clerk_user_id == user.clerk_user_id).with_for_update()
    )
    fresh = locked.scalar_one()
    if fresh.credits < cost:
        raise HTTPException(
            status_code=402,
            detail={"error": "insufficient_credits", "balance": fresh.credits, "cost": cost},
        )
    fresh.credits -= cost
    db.add(CreditLedger(
        clerk_user_id=fresh.clerk_user_id,
        delta=-cost,
        action=action.value,
        balance_after=fresh.credits,
    ))
    await db.commit()
    await db.refresh(fresh)
    return fresh.credits


async def set_balance(db: AsyncSession, clerk_user_id: str, new_balance: int) -> int:
    """Admin-only: set absolute credit balance. Logs the delta to the ledger."""
    if new_balance < 0:
        raise ValueError("balance cannot be negative")
    locked = await db.execute(
        select(User).where(User.clerk_user_id == clerk_user_id).with_for_update()
    )
    user = locked.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    delta = new_balance - user.credits
    if delta == 0:
        return user.credits
    user.credits = new_balance
    db.add(CreditLedger(
        clerk_user_id=user.clerk_user_id,
        delta=delta,
        action=Action.ADMIN_SET.value,
        balance_after=user.credits,
    ))
    await db.commit()
    await db.refresh(user)
    logger.info("admin set %s balance to %d (delta=%+d)", clerk_user_id, new_balance, delta)
    return user.credits


async def grant(db: AsyncSession, clerk_user_id: str, amount: int, action: Action = Action.ADMIN_GRANT) -> int:
    """Add credits to a user. Used by signup webhook + admin script + refunds."""
    if amount <= 0:
        raise ValueError("grant amount must be positive")
    locked = await db.execute(
        select(User).where(User.clerk_user_id == clerk_user_id).with_for_update()
    )
    user = locked.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.credits += amount
    db.add(CreditLedger(
        clerk_user_id=user.clerk_user_id,
        delta=amount,
        action=action.value,
        balance_after=user.credits,
    ))
    await db.commit()
    await db.refresh(user)
    logger.info("granted %d credits to %s (action=%s, new_balance=%d)", amount, clerk_user_id, action.value, user.credits)
    return user.credits
