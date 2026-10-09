"""Public typed-chat endpoint."""

from fastapi import APIRouter, Depends, HTTPException

from ..callmissed import available_model, reported_credits, upstream
from ..config import settings
from ..schemas import ChatBody
from ..security import same_origin

router = APIRouter()

@router.post("/api/chat", dependencies=[Depends(same_origin)])
async def chat(body: ChatBody):
    await available_model(settings.CHAT_MODEL, "chat")
    result, request_id = await upstream("POST", "/v1/chat/completions", service="chat", with_request_id=True, json={
        "model": settings.CHAT_MODEL, "messages": [{"role": "system", "content": settings.PROMPT}]
        + [message.model_dump() for message in body.messages], "max_tokens": settings.CHAT_MAX_TOKENS, "stream": False,
    })
    try:
        content = result["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError()
    except (KeyError, IndexError, TypeError, ValueError):
        raise HTTPException(502, "CallMissed returned an empty or invalid chat reply. Check usage before trying again.") from None
    credits = await reported_credits(request_id, "llm", settings.CHAT_MODEL, "/v1/chat/completions")
    return {"content": content.strip()[:1000], "credits": credits}
