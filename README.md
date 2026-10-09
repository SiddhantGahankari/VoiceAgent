# CallMissed Voice Agent

A React + Vite + TypeScript app with Voice, Chat, and Images views, backed by Python + FastAPI. CallMissed is the only AI provider. The browser connects directly to the API-issued voice session using `livekit-client`; the backend and Vercel never relay live audio.

The app is publicly usable without a login or demo access code. API credentials stay on the backend. Runtime mock mode has been removed; using the app can incur real CallMissed charges.

## Features

- **Voice:** Start/End controls, connection status, microphone guidance, agent audio, and final transcript lines labeled You and Agent. End releases audio resources and retrieves the stored transcript and reported credits. Switching views keeps an active call mounted.
- **Chat:** Written responses to typed messages. Enter sends; Ctrl+Enter inserts a newline. History stays in browser memory for the current visit, and Clear chat erases it. Requests send the latest four exchanges plus the new message.
- **Images:** One image per prompt, with a temporary signed URL preferred and PNG/JPEG base64 fallback supported. Results stay in browser memory; save an image before its link expires.

All views handle loading and API errors and prevent duplicate submissions. Chat and Images hide credit displays; Voice retains its post-call credit report. No database or user accounts are used.

## Run locally

Requirements: Node 22.12+ or Node 24+, Python 3.12+, and npm.

Run from the project root:

```bash
npm ci
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Copy the environment template **only if `.env` does not already exist**:

```bash
cp .env.example .env
```

Edit the project-root `.env` privately:

```dotenv
CALLMISSED_API_KEY=
```

Put your key after `CALLMISSED_API_KEY=`. Do not add it to source code, `config.yaml`, `.env.example`, or a `VITE_*` variable. `.env` is ignored by Git and excluded from Vercel uploads.

Start FastAPI:

```bash
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` requests to FastAPI on port 8000. Allow microphone access when starting Voice; HTTPS or localhost is required for microphone use.

For local runs, FastAPI loads the project-root `.env` without overriding existing environment variables. On Vercel it uses server-side environment settings and skips `.env`. Restart FastAPI after changing `.env` or `backend/config.yaml`.

To serve a fresh production frontend through FastAPI locally:

```bash
npm run build
uvicorn app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Start FastAPI after building so it mounts `dist/`.

## Backend configuration

Edit [`backend/config.yaml`](backend/config.yaml) for models, prompts, greeting, voice settings, and output limits. [`backend/config.py`](backend/config.py) safely loads and validates these settings at startup.

| Setting | Current value |
| --- | --- |
| Chat model | `sarvam-105b` |
| Chat output limit | 256 tokens; returned text limited to 1000 characters |
| Image model | `sdxl-lightning` |
| Image request | One image, `1024x1024`, URL response format |
| Voice LLM | `sarvam-105b`, with `gemma-4-31b` fallback |
| Speech recognition | `saaras:v3` |
| Speech synthesis | `bulbul:v3`, voice `shubh` |
| Voice duration | 90 seconds maximum |

Chat accepts up to nine alternating user/assistant messages, each with 1–1000 trimmed characters. Image prompts have the same character limit. Browser-provided model overrides, system messages, and multiple-image options are rejected. YAML validation caps voice duration at 90 seconds and chat output at 256 tokens.

The backend checks the authenticated model catalogue before creation or generation. Catalogue presence does not guarantee key permission: CallMissed enforces voice, `llm`, and `image` permissions and allowed-model access. Generation requests are not automatically retried after uncertain failures.

## Deploy to Vercel

Deploy the **repository root**, not the `backend/` directory. The repository is [SiddhantGahankari/VoiceAgent](https://github.com/SiddhantGahankari/VoiceAgent).

Import the repository into Vercel and select the **FastAPI** framework preset. The existing configuration specifies:

| Configuration | Value |
| --- | --- |
| Python entrypoint | `app:app` |
| Build command | `npm ci && npm run build` |
| Built frontend | `dist/` |
| Function maximum duration | 90 seconds |
| Backend configuration included | `backend/config.yaml` |

In Vercel Project → Settings → Environment Variables, add **`CALLMISSED_API_KEY`** as a sensitive server-side variable for the desired environments, then deploy. No demo access code is required. Vercel supplies `VERCEL`; the backend skips local `.env` loading there.

Alternatively, deploy through the CLI from the project root:

```bash
npx vercel@latest login
npx vercel@latest link
npx vercel@latest --prod
```

`.vercelignore` excludes local dependencies, prebuilt local `dist/`, documentation, environment files, caches, and agent tooling from uploads. Vercel receives the frontend build inputs and builds fresh assets. Function exclusions keep development files and frontend source out of the Python runtime bundle; the backend YAML and generated static assets remain available. No local files are deleted by these rules.

The built frontend is served as static files, with Vercel static promotion configured in `pyproject.toml`. The Python function handles finite API requests; live voice media connects directly from the browser to CallMissed. Configuration and environment changes require a new deployment.

## API and security

| Method and route | Purpose |
| --- | --- |
| `GET /api/config` | Public duration and compatibility flags; no credentials |
| `POST /api/voice/sessions` | Create a voice session; return only ID, WebSocket URL, and connection token |
| `POST /api/voice/sessions/{session_id}/end` | End the creating browser's voice session |
| `GET /api/voice/sessions/{session_id}` | Retrieve session finalization status |
| `GET /api/voice/sessions/{session_id}/transcript` | Retrieve stored transcript |
| `GET /api/voice/sessions/{session_id}/cost` | Retrieve actual reported voice credits |
| `POST /api/chat` | Generate a written reply from bounded message history |
| `POST /api/images` | Generate one image from a prompt |

Creation and generation endpoints are public. Voice status, transcript, cost, and End require a signed session cookie belonging to the creating browser. Cookie signatures use a server-only key derived from `CALLMISSED_API_KEY`, stable across Vercel instances. Rotating the API key invalidates existing session cookies. Cookies are HTTP-only, strict same-site, and secure over HTTPS.

API responses use `Cache-Control: no-store`. Mutation endpoints check Origin when supplied. The server filters provider metadata and errors, and logs operation/status/timing without credentials. These checks preserve session ownership; they are not authentication or a spending limit for public generation endpoints.

## Budget and verification

The current allowance is **US$2 total CallMissed spend**, including the user's previous voice test. The app does not enforce a cumulative spending limit. Anyone who can reach a public deployment can consume the server key's credits; provider-side budget controls are needed to enforce a limit.

Before further live acceptance tests, check existing spend and remaining key budget in the CallMissed console. Keep sessions short and sequential, make at most one short Chat test and one Image test, and record actual credits after each. Do not buy credits, upgrade a plan, or raise a cap.

Verification recorded on **8 October 2026**:

- Voice was live-tested by the user; detailed results and cumulative billed credits were not supplied.
- Backend and frontend/browser automated test suites, configurations, and test-only dependencies have been removed at the user’s request.
- TypeScript checking and a frontend production build into a temporary directory passed; the project’s existing `dist/` was not replaced.
- Temporary offline API checks passed for Voice lifecycle/report/ownership, Chat, Images, input limits, same-origin protection, safe provider errors, and missing-key handling. No live provider calls were made.
- Chat and Images have not been live-tested by the coding agent. Console access is unavailable, so remaining budget and cumulative spend are unknown.
- The latest Vercel deployment and live HTTPS URL have not been independently verified. No deployment URL is claimed here.

Check frontend types without making API calls:

```bash
npx tsc --noEmit
```

No frontend/browser or backend automated test suite is included. Verification during cleanup uses temporary offline checks; this does not establish live audio or provider availability.

After deployment, verify HTTPS page/assets, public access, a direct media connection to the issued `ws_url`, microphone release on End, stored transcript/credits, and rejection of another browser's session reads or End requests. Live audio, interruption, Hindi/Hinglish, Chat, and Images checks must stay within the remaining budget.

## Project structure

```text
app.py                  Root Vercel/uvicorn entrypoint
backend/
  main.py               App assembly, middleware, routers, static mount
  config.py             YAML validation and project-root .env loading
  config.yaml           Non-secret models, prompts, and limits
  callmissed.py         Provider requests, model checks, usage lookup
  security.py           Signed session cookies and same-origin checks
  schemas.py            Request and response validation
  routes/
    voice.py            Voice session lifecycle and reports
    chat.py             Typed chat
    images.py           Image generation and response handling
    system.py           Public frontend configuration
src/
  main.tsx              Shared navigation and Voice view
  voice.ts              LiveKit connection and audio cleanup
  features.tsx          Chat and Images views
  api.ts                Browser API calls and transcript normalization
  style.css             Shared responsive cream/olive styling
vercel.json             Vercel build, function, and security headers
pyproject.toml          Python dependencies and Vercel entrypoint/static settings
.env.example            Empty server-side environment template
```

## Troubleshooting

- **403 on creation/generation:** check that the Vite proxy preserves the frontend Host header (`changeOrigin: false`). Provider permission errors identify the required service permission or model access.
- **Microphone denied or busy:** allow the site to use the microphone and close other recording apps. Headphones help prevent feedback.
- **Voice connection/DNS failure:** check the API-issued media hostname without exposing the token. Browser Secure DNS and system DNS can resolve differently. Fix connectivity before starting another paid session.
- **Session creation timeout:** the provider may have created a session despite the missing response. Avoid immediately retrying; inspect provider activity first.
- **End failure:** the microphone is released, but Start remains blocked until server End is confirmed. Retry End after restoring connectivity.
- **Expired image URL:** save images promptly. Failed image loads do not trigger automatic regeneration.

## References

- [CallMissed voice sessions](https://docs.callmissed.com/docs/voice-sessions-api)
- [Browser voice client guide](https://docs.callmissed.com/docs/voice-sdk)
- [Available voice models](https://docs.callmissed.com/docs/managed-voice-agent#list-available-models)
- [Chat completions](https://docs.callmissed.com/docs/chat-completion)
- [Image generation](https://docs.callmissed.com/docs/image-generation)
- [Key permissions and budget controls](https://docs.callmissed.com/docs/keys)
- [Provider pricing](https://docs.callmissed.com/docs/pricing)
- [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [Vercel deployment exclusions](https://vercel.com/docs/deployments/vercel-ignore)
