"""Compose the API and serve the built frontend after its routes."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import PROJECT_ROOT
from .routes import chat, images, system, voice

app = FastAPI(title="CallMissed voice demo", docs_url=None, redoc_url=None)


@app.middleware("http")
async def no_cache_api(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


for router in (system.router, voice.router, chat.router, images.router):
    app.include_router(router)

# Vercel promotes these assets to its CDN; this also serves local production builds.
DIST = PROJECT_ROOT / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
