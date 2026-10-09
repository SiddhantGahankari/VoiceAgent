"""Validated API input and response shapes."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

class SessionConnection(BaseModel):
    id: UUID
    ws_url: str
    token: str


TextInput = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: TextInput


class ChatBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: list[ChatMessage] = Field(min_length=1, max_length=9)

    @model_validator(mode="after")
    def conversation(self):
        if len(self.messages) % 2 != 1 or any(
            message.role != ("user" if index % 2 == 0 else "assistant")
            for index, message in enumerate(self.messages)
        ):
            raise ValueError("Send alternating user/assistant turns ending in a user message.")
        return self


class ImageBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: TextInput
