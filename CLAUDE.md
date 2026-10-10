# wa-bridge

**Port:** N/A (CLI bot) | **Stack:** Node.js + Baileys | **Runtime:** Node.js >=18

## What

A self-hosted WhatsApp ↔ LLM bridge. Connects to WhatsApp via QR code (using
Baileys — pure JS WhatsApp Web API), receives messages, routes them to any
OpenAI-compatible LLM endpoint, and replies with the LLM's response.

No Meta account required. No browser automation. Just scan a QR code and go.

## Quick Start

```bash
./setup.sh              # First-time setup (installs deps, creates .env)
npm start               # Start the bot
```

## Commands

```bash
# Development
npm install             # Install dependencies
npm start               # Start the bot
npm run lint            # Lint check
npm test                # Run tests

# Config
cp .env.example .env    # Configure LLM endpoint and settings
# Then edit .env with your API key
```

## Architecture

```
index.js
├── CONFIG          # Environment-based configuration (dotenv)
├── Helpers         # log, extractText, isGroup, getSenderName
├── callLLM()       # LLM API call (OpenAI-compatible REST)
├── handleMessage()  # Message router: mode check → command → LLM
├── handleCommand()  # Command dispatcher: !ajuda / !status / !sair
└── connect()        # Baileys WhatsApp connection + QR + auto-reconnect
```

**Data flow:**
1. WhatsApp message → Baileys `messages.upsert` event
2. `handleMessage()` checks behavior mode (direct/group/mention)
3. If command prefix → `handleCommand()`
4. Otherwise → `callLLM()` → REST to LLM endpoint → reply back to WhatsApp

## Configuration

All config via `.env`. See `.env.example`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_ENDPOINT` | No | `''` | OpenAI-compatible API URL |
| `LLM_API_KEY` | No | `''` | API key for LLM provider |
| `LLM_MODEL` | No | `solar-pro4` | Model name |
| `BEHAVIOR_MODE` | No | `mention` | `always` · `direct` · `mention` |
| `SESSION_DIR` | No | `./session` | WhatsApp session storage dir |
| `LOG_LEVEL` | No | `info` | `debug` · `info` · `warn` · `error` |

## Testing

```bash
npm test                # Run unit tests
```

Tests cover: helper functions, config loading, message extraction, and
group detection logic.

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Main application — WhatsApp connection, message handling, LLM integration |
| `package.json` | Dependencies and scripts |
| `.env.example` | Environment variable template |
| `test/index.test.js` | Unit tests |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
