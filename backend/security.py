"""Signed session cookies and same-origin checks for the public demo."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from uuid import UUID

from fastapi import HTTPException, Request

LOCAL_SIGNING_KEY = secrets.token_bytes(32)

def secret():
    key = os.getenv("CALLMISSED_API_KEY")
    if key:
        # Domain separation keeps cookie signatures distinct from provider credentials.
        return hmac.new(key.encode(), b"callmissed-session-cookies-v1", hashlib.sha256).digest()
    if not os.getenv("VERCEL"):
        return LOCAL_SIGNING_KEY
    raise HTTPException(503, "CALLMISSED_API_KEY is not configured on the server.")


def sign(subject, lifetime=3600):
    payload = base64.urlsafe_b64encode(json.dumps([subject, int(time.time()) + lifetime]).encode()).decode()
    signature = hmac.new(secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def verify(value, subject):
    try:
        payload, signature = value.split(".")
        expected = hmac.new(secret(), payload.encode(), hashlib.sha256).hexdigest()
        who, expiry = json.loads(base64.urlsafe_b64decode(payload))
        return hmac.compare_digest(signature, expected) and who == subject and expiry > time.time()
    except (ValueError, TypeError):
        return False


def owned(session_id: UUID, request: Request):
    if not verify(request.cookies.get(f"cm_session_{session_id}", ""), f"live:{session_id}"):
        raise HTTPException(403, "This browser does not have access to that session.")
    return str(session_id)


def same_origin(request: Request):
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "Please use this demo from its own website.")
