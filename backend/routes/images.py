"""Public single-image endpoint with signed URL and base64 support."""

import base64
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException

from ..callmissed import available_model, reported_credits, upstream
from ..config import settings
from ..schemas import ImageBody
from ..security import same_origin

router = APIRouter()

@router.post("/api/images", dependencies=[Depends(same_origin)])
async def image(body: ImageBody):
    await available_model(settings.IMAGE_MODEL, "image")
    result, request_id = await upstream("POST", "/v1/images/generations", service="image", with_request_id=True, json={
        "model": settings.IMAGE_MODEL, "prompt": body.prompt, "n": 1,
        "size": settings.IMAGE_SIZE, "response_format": "url",
    })
    try:
        item = result["data"][0]
        url = item.get("url")
        if isinstance(url, str):
            parsed = urlparse(url)
            if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
                src = url
            else:
                src = None
        else:
            src = None
        if src is None:
            encoded = item.get("b64_json")
            # Leave room below Vercel's function response limit for the JSON envelope.
            if not isinstance(encoded, str) or len(encoded) > 3_500_000:
                raise ValueError()
            decoded = base64.b64decode(encoded, validate=True)
            mime = "image/png" if decoded.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if decoded.startswith(b"\xff\xd8\xff") else None
            if not mime:
                raise ValueError()
            src = f"data:{mime};base64,{encoded}"
    except (KeyError, IndexError, AttributeError, TypeError, ValueError):
        raise HTTPException(502, "CallMissed returned an invalid or oversized image. Check usage before generating again.") from None
    credits = await reported_credits(request_id, "image", settings.IMAGE_MODEL, "/v1/images/generations")
    return {"src": src, "credits": credits}
