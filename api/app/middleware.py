from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth import get_current_user_optional
from app.db import SessionLocal


class CurrentUserMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        database = SessionLocal()
        try:
            request.state.user = get_current_user_optional(request, database)
        finally:
            database.close()
        return await call_next(request)
