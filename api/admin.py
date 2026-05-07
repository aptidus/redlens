"""Admin endpoints. Gated by ADMIN_EMAILS env var allowlist."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import current_admin
from credits import set_balance
from db import get_db
from models import CreditLedger, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserRow(BaseModel):
    clerk_user_id: str
    email: Optional[str]
    credits: int
    created_at: str
    spent_total: int = 0  # lifetime credits spent


class UserListResponse(BaseModel):
    users: list[UserRow]
    total: int


class SetCreditsRequest(BaseModel):
    credits: int = Field(..., ge=0)


@router.get("/users", response_model=UserListResponse)
async def list_users(
    q: str = Query("", description="Search by email substring"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
):
    base = select(User)
    if q.strip():
        like = f"%{q.strip()}%"
        base = base.where(or_(User.email.ilike(like), User.clerk_user_id.ilike(like)))

    total_row = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_row.scalar_one()

    rows = await db.execute(base.order_by(desc(User.created_at)).limit(limit).offset(offset))
    users = rows.scalars().all()

    # Spent-total per user (one query, grouped)
    if users:
        ids = [u.clerk_user_id for u in users]
        spent_q = await db.execute(
            select(CreditLedger.clerk_user_id, func.coalesce(func.sum(-CreditLedger.delta), 0))
            .where(CreditLedger.clerk_user_id.in_(ids))
            .where(CreditLedger.delta < 0)
            .group_by(CreditLedger.clerk_user_id)
        )
        spent_map = {row[0]: int(row[1]) for row in spent_q.all()}
    else:
        spent_map = {}

    return UserListResponse(
        users=[
            UserRow(
                clerk_user_id=u.clerk_user_id,
                email=u.email,
                credits=u.credits,
                created_at=u.created_at.isoformat(),
                spent_total=spent_map.get(u.clerk_user_id, 0),
            )
            for u in users
        ],
        total=total,
    )


@router.post("/users/{clerk_user_id}/credits")
async def set_user_credits(
    clerk_user_id: str,
    body: SetCreditsRequest,
    admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
):
    new_balance = await set_balance(db, clerk_user_id, body.credits)
    logger.info("admin %s set credits for %s to %d", admin.email, clerk_user_id, new_balance)
    return {"clerk_user_id": clerk_user_id, "credits": new_balance}
