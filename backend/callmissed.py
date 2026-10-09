"""CallMissed REST requests, model checks, and usage attribution."""

import logging
import math
import os
import time
from decimal import Decimal, InvalidOperation

import httpx
from fastapi import HTTPException

from .config import settings

logger = logging.getLogger("uvicorn.error")

async def upstream(method, path, service="voice", with_request_id=False, **kwargs):
    key = os.getenv("CALLMISSED_API_KEY")
    if not key:
        raise HTTPException(503, "Set CALLMISSED_API_KEY in the backend's .env or Vercel server-side Environment Variables.")
    creating = method == "POST" and path == "/v1/voice/sessions"
    generating = method == "POST" and service in {"chat", "image"}
    operation = f"{service} generation" if generating else "voice session creation" if creating else "model lookup" if path.endswith("/models") else "session metadata request"
    started = time.monotonic()
    try:
        timeout = httpx.Timeout(60 if generating else 40 if creating else 10, connect=5, write=5, pool=5)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            result = await client.request(method, settings.BASE + path, headers={"Authorization": f"Bearer {key}"}, **kwargs)
        logger.info("CallMissed %s: HTTP %s in %.2fs", operation, result.status_code, time.monotonic() - started)
        if result.status_code >= 400:
            messages = {
                401: "CallMissed rejected the server credential. Contact the demo owner.",
                402: "The credit balance or budget cap is exhausted. This demo will not buy credits or raise the cap.",
                403: "The server key needs CallMissed voice permissions. Contact the demo owner.",
                404: "CallMissed could not find that session.",
                422: "CallMissed rejected the voice configuration. Contact the demo owner.",
                429: "CallMissed's rate or concurrent-session limit was reached. Wait before starting again.",
                503: "The selected voice service is unavailable. Try later.",
            }
            if service in {"chat", "image"}:
                permission = "llm" if service == "chat" else "image"
                messages.update({
                    400: f"CallMissed rejected the {service} request or its content. Edit your prompt; it was not retried.",
                    403: f"The server key needs CallMissed {permission} permission and access to the configured model. Contact the demo owner.",
                    404: f"The configured {service} model is not available on CallMissed.",
                    422: f"CallMissed rejected the {service} configuration. Contact the demo owner.",
                    429: "CallMissed's rate, concurrency, or monthly quota limit was reached. Wait before trying again.",
                    503: f"The selected {service} model is unavailable. Try later.",
                })
            raise HTTPException(result.status_code if result.status_code in messages else 502,
                                messages.get(result.status_code, "CallMissed returned an API error. Try later."))
        data = result.json() if result.content else None
        return (data, result.headers.get("X-Request-ID")) if with_request_id else data
    except httpx.TimeoutException as error:
        logger.warning("CallMissed %s: %s after %.2fs", operation, type(error).__name__, time.monotonic() - started)
        if generating:
            message = f"CallMissed {service} generation timed out. It was not retried. Check usage before generating again; the request may have been billed."
        elif creating and not isinstance(error, (httpx.ConnectTimeout, httpx.PoolTimeout)):
            message = "CallMissed voice session creation timed out. It may have created a session, but no connection token was received. The microphone has been released. Avoid immediately starting another call."
        elif creating:
            message = "Could not connect to CallMissed to create a voice session. No creation request was sent. Try again shortly."
        elif path.endswith("/models"):
            message = "CallMissed model lookup timed out. No voice session was created. Try Start again shortly." if service == "voice" else "CallMissed model lookup timed out. No generation was attempted. Try later."
        else:
            message = "CallMissed's session metadata request timed out. Try this request again shortly."
        raise HTTPException(504, message) from None
    except httpx.RequestError as error:
        logger.warning("CallMissed %s: %s after %.2fs", operation, type(error).__name__, time.monotonic() - started)
        message = f"Could not reach CallMissed for {operation}. Check your internet connection and try later."
        if creating and not isinstance(error, httpx.ConnectError):
            message += " Session creation may have succeeded; avoid immediately starting another call."
        if generating:
            message += " It was not retried; check usage before generating again."
        raise HTTPException(502, message) from None
    except ValueError:
        raise HTTPException(502, "CallMissed returned an unreadable response.") from None

async def available_model(model, service):
    catalogue = await upstream("GET", "/v1/models", service=service)
    rows = catalogue.get("data") if isinstance(catalogue, dict) else None
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise HTTPException(502, "CallMissed returned an invalid model catalogue.")
    row = next((row for row in rows if row.get("id") == model), None)
    if not row or row.get("status") == "maintenance":
        raise HTTPException(503, f"The configured {service} model is unavailable. No generation was attempted.")


async def reported_credits(request_id, service, model, endpoint):
    if not request_id:
        return None
    try:
        result = await upstream("GET", "/v1/usage/logs", service="usage", params={
            "days": 1, "service": service, "model": model, "status": "ok", "limit": 100,
        })
        rows = result.get("logs") if isinstance(result, dict) else None
        if not isinstance(rows, list):
            return None
        row = next((row for row in rows if isinstance(row, dict)
                    and row.get("request_id") == request_id and row.get("service") == service
                    and row.get("model") == model and row.get("endpoint") == endpoint), None)
        if row is None or isinstance(row.get("cost_usd"), bool):
            return None
        # Usage API billing units are 0.01 per credit, not the display USD exchange rate.
        amount = Decimal(str(row.get("cost_usd"))) * 100
        if not amount.is_finite() or amount < 0:
            return None
        value = float(amount)
        return value if math.isfinite(value) else None
    except (HTTPException, InvalidOperation, ValueError, OverflowError):
        # Missing scope/logging or delayed metering must not discard a paid result.
        return None
