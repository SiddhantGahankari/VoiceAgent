"""Public frontend configuration."""

from fastapi import APIRouter

from ..config import settings

router = APIRouter()


@router.get("/api/config")
def config():
    return {"mode": "live", "max_duration_seconds": settings.MAX_DURATION,
            "requires_access_code": False}
