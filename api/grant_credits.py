"""Admin script: grant credits to a user by email or Clerk user id.

Usage (run inside the Railway container with `railway run python grant_credits.py …`):

  python grant_credits.py --email beib70812@gmail.com --amount 100
  python grant_credits.py --clerk-id user_abc123 --amount 500

If the email isn't yet in the DB (user signed up via Clerk but never hit an
authenticated endpoint), this will refuse — Clerk webhook should have created
the row. If it didn't, log in once on the site to trigger the lazy create.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from sqlalchemy import select

from credits import Action, grant
from db import SessionLocal
from models import User

logging.basicConfig(level=logging.INFO, format="%(message)s")


async def _resolve(db, email: str | None, clerk_id: str | None) -> User:
    if clerk_id:
        user = await db.get(User, clerk_id)
        if user is None:
            raise SystemExit(f"No user with clerk_user_id={clerk_id}")
        return user
    if email:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            raise SystemExit(
                f"No user with email={email}. They may not have logged in yet — "
                "have them sign in once on the site, then re-run."
            )
        return user
    raise SystemExit("Must pass --email or --clerk-id")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email")
    parser.add_argument("--clerk-id")
    parser.add_argument("--amount", type=int, required=True)
    args = parser.parse_args()
    if args.amount <= 0:
        raise SystemExit("--amount must be positive")

    async with SessionLocal() as db:
        user = await _resolve(db, args.email, args.clerk_id)
        new_balance = await grant(db, user.clerk_user_id, args.amount, action=Action.ADMIN_GRANT)
        print(f"OK. {user.email or user.clerk_user_id}: granted {args.amount}, new balance = {new_balance}")


if __name__ == "__main__":
    asyncio.run(main())
