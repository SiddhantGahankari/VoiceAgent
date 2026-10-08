"""Load and validate non-secret backend settings at startup."""

import os
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_local_env(path=PROJECT_ROOT / ".env"):
    # Deployed settings take precedence; local secrets never need to be uploaded.
    if not os.getenv("VERCEL"):
        load_dotenv(path, override=False)


load_local_env()


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    BASE: Literal["https://api.callmissed.com"]
    CHAT_MODEL: str = Field(min_length=1)
    IMAGE_MODEL: str = Field(min_length=1)
    CHAT_MAX_TOKENS: int = Field(ge=1, le=256)
    IMAGE_SIZE: Literal["1024x1024"]
    MAX_DURATION: int = Field(ge=1, le=90)
    VOICE_MODELS: dict[Literal["llm", "stt", "tts"], list[str]]
    VOICE_NAME: str = Field(min_length=1)
    VOICE_LANGUAGE: str = Field(min_length=1)
    PROMPT: str = Field(min_length=1, max_length=1000)
    GREETING: str = Field(min_length=1, max_length=1000)


with Path(__file__).with_name("config.yaml").open(encoding="utf-8") as file:
    settings = Settings.model_validate(yaml.safe_load(file))
