"""Voice session lifecycle; browser media connects directly to LiveKit."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..callmissed import upstream
from ..config import settings
from ..schemas import SessionConnection
from ..security import owned, same_origin, sign

router = APIRouter()

def select_models(catalogue):
    selected = {}
    for stage, candidates in settings.VOICE_MODELS.items():
        rows = catalogue.get(stage, [])
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise HTTPException(502, "CallMissed returned an invalid model catalogue.")
        found = next((row for candidate in candidates for row in rows
                      if row.get("id") == candidate
                      and row.get("verdict") not in {"unsupported", "too_slow"}
                      and (row.get("eligible") is True or row.get("verdict") == "unmeasured")), None)
        if not found:
            raise HTTPException(503, f"No supported configured {stage.upper()} model is currently available.")
        selected[f"{stage}_model"] = found["id"]
        if stage == "tts" and settings.VOICE_NAME not in found.get("voices", []):
            raise HTTPException(503, "The configured voice is not available in the current model catalogue.")
    return selected

@router.post("/api/voice/sessions", response_model=SessionConnection,
          dependencies=[Depends(same_origin)])
async def create_session(request: Request, response: Response):
    catalogue = await upstream("GET", "/api/v1/voice/models")
    if not isinstance(catalogue, dict):
        raise HTTPException(502, "CallMissed returned an invalid model catalogue.")
    session = await upstream("POST", "/v1/voice/sessions", json={
        "system_prompt": settings.PROMPT, "greeting": settings.GREETING, "voice": settings.VOICE_NAME, "language": settings.VOICE_LANGUAGE,
        "max_duration_seconds": settings.MAX_DURATION, **select_models(catalogue),
    })
    try:
        connection = SessionConnection.model_validate(session)
        if not connection.ws_url.startswith("wss://") or not connection.token:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(502, "CallMissed returned invalid connection credentials. Check the console before retrying.") from None
    response.set_cookie(f"cm_session_{connection.id}", sign(f"live:{connection.id}"), httponly=True,
                        secure=request.url.scheme == "https", samesite="strict", max_age=3600,
                        path=f"/api/voice/sessions/{connection.id}")
    return connection


@router.post("/api/voice/sessions/{session_id}/end", dependencies=[Depends(same_origin)])
async def end_session(session_id: str = Depends(owned)):
    await upstream("DELETE", f"/v1/voice/sessions/{session_id}")
    return {"status": "completed"}


@router.get("/api/voice/sessions/{session_id}")
async def get_session(session_id: str = Depends(owned)):
    result = await upstream("GET", f"/v1/voice/sessions/{session_id}")
    return {key: result.get(key) for key in ["status", "duration_seconds", "end_reason"]}


@router.get("/api/voice/sessions/{session_id}/transcript")
async def transcript(session_id: str = Depends(owned)):
    result = await upstream("GET", f"/v1/voice/sessions/{session_id}/transcript", params={"format": "json"})
    if not isinstance(result, list):
        raise HTTPException(502, "CallMissed returned an invalid transcript.")
    return [{key: turn.get(key) for key in ["id", "turn_index", "user_transcript", "agent_response", "interrupted"]}
            for turn in result]


@router.get("/api/voice/sessions/{session_id}/cost")
async def cost(session_id: str = Depends(owned)):
    result = await upstream("GET", f"/v1/voice/sessions/{session_id}/cost")
    return {key: result.get(key) for key in ["session_id", "total_credits", "items"]}
