# wa-bridge

**WhatsApp ↔ LLM Bridge** — A self-hosted WhatsApp bot that bridges messages to any OpenAI-compatible LLM endpoint. No Meta account, no browser required.

Built on [Baileys](https://github.com/WhiskeySockets/Baileys) (pure JavaScript WhatsApp Web API) with QR Code authentication.

## Features

- 🔐 **QR Code authentication** — connects via WhatsApp Web QR code, persists session locally
- 🤖 **LLM integration** — sends messages to any OpenAI-compatible API endpoint
- 💬 **Multi-mode behavior** — direct messages, group mentions, or always-on
- ⌨️ **Command system** — built-in commands (`!ajuda`, `!status`, `!sair`)
- ⚙️ **Fully configurable** via environment variables
- 📦 **One-command setup** — `./setup.sh`
- 🧪 **Test coverage** — unit tests via Node.js built-in test runner
- 🛡️ **No hardcoded secrets** — all configuration via environment variables

## Quick Start

```bash
git clone https://github.com/admeduardovieira/wa-bridge.git
cd wa-bridge
./setup.sh

# Configure your LLM endpoint
cp .env.example .env
# Edit .env with your LLM_API_KEY, LLM_ENDPOINT, etc.
# Start the bot
npm start
```

Scan the QR code with your WhatsApp → Settings → Devices Connected → Link Device.

## Prerequisites

- **Node.js** >= 18
- **npm** >= 10
- A WhatsApp account (for QR scan)
- An OpenAI-compatible LLM API key (OpenAI, Anthropic, Solar, Ollama, etc.)

## Configuration

All configuration via `.env` file (copy from `.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_ENDPOINT` | No | `''` | OpenAI-compatible API URL |
| `LLM_API_KEY` | No | `''` | API key for authentication |
| `LLM_MODEL` | No | `solar-pro4` | Model name to use |
| `LLM_TEMPERATURE` | No | `0.7` | Sampling temperature (0.0–1.0) |
| `LLM_SYSTEM_PROMPT` | No | *(default)* | System prompt for the LLM |
| `BEHAVIOR_MODE` | No | `mention` | `always` · `direct` · `mention` |
| `COMMAND_PREFIX` | No | `!` | Prefix for bot commands |
| `ADMIN_NUMBERS` | No | `''` | Comma-separated admin numbers |
| `GROUP_MODE` | No | `mention` | Group response mode |
| `SESSION_DIR` | No | `./session` | WhatsApp session storage dir |
| `LOG_LEVEL` | No | `info` | `debug` · `info` · `warn` · `error` |

### Supported LLM Providers

| Provider | Endpoint | Notes |
|----------|----------|-------|
| OpenAI | `https://api.openai.com/v1/chat/completions` | Standard OpenAI format |
| Anthropic | `https://api.anthropic.com/v1/messages` | May need format adapter |
| Solar (Upstage) | `https://api.upstage.ai/v1/solar/chat/completions` | Korean LLM |
| Ollama (local) | `http://localhost:11434/v1/chat/completions` | Run locally, no key needed |

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `!ajuda` or `!help` | Show available commands |
| `!status` | Show bot connection status |
| `!sair` or `!logout` | Disconnect the bot |

### Message Behavior

- **Direct mode** (`BEHAVIOR_MODE=direct`): Only responds to direct messages
- **Always mode** (`BEHAVIOR_MODE=always`): Responds to all messages
- **Mention mode** (`BEHAVIOR_MODE=mention`): Only responds when mentioned (default)

In groups, the bot only responds when:
1. The message starts with the command prefix (`!`)
2. The bot is mentioned in the message

## Development

```bash
npm install          # install dependencies
npm run lint         # lint check
npm test             # run tests
node index.js        # start bot (dev mode)
```

## Architecture

```
wa-bridge/index.js
├── CONFIG          # Environment-based configuration
├── Helpers         # log, extractText, isGroup, getSenderName
├── callLLM()       # LLM API call (OpenAI-compatible)
├── handleMessage()  # Message router (mode check → command → LLM)
├── handleCommand()  # Command dispatcher (ajuda/status/sair)
└── connect()        # Baileys WhatsApp connection + QR + reconnection
```

**Data flow:**
1. WhatsApp sends message → Baileys `messages.upsert` event
2. `handleMessage()` filters by mode (direct/group/mention)
3. If command prefix → `handleCommand()`
4. Otherwise → `callLLM()` → sends to LLM endpoint → reply back to WhatsApp

## Project Structure

```
wa-bridge/
├── index.js           # Main application (single-file for simplicity)
├── package.json       # Dependencies and scripts
├── .env.example       # Environment variable template
├── .gitignore         # Ignores node_modules, session, .env
├── LICENSE            # MIT License
├── README.md          # This file
├── CLAUDE.md          # Claude Code context
├── setup.sh           # One-command bootstrap
├── CONTRIBUTING.md    # Contribution guidelines
├── test/              # Test files
│   └── index.test.js  # Unit tests
└── .github/           # GitHub workflows
    └── ISSUE_TEMPLATE/
        ├── bug_report.md
        └── feature_request.md
```

## Security

- **No hardcoded secrets** — all credentials via environment variables (`LLM_API_KEY`, etc.)
- **Admin authorization** — `ADMIN_NUMBERS` env var gates privileged commands (`!sair`, `!logout`, `!desconectar`); empty list = open (default)
- **Session persistence** — WhatsApp credentials stored locally in `./session/` (restrict to `0o700` in production)
- **`.env` is gitignored** — never committed
- **Input validation** — message text and LLM endpoint are validated
- **Global error handlers** — `unhandledRejection` and `uncaughtException` guards prevent silent crashes
- **Vulnerability monitoring** — `npm audit` is clean (0 vulnerabilities; `sharp`/CVE-2026-96889 resolved via `npm audit fix`)

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the full audit report and [CONTRIBUTING.md](CONTRIBUTING.md#security) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

This project uses the WhatsApp Web API via Baileys. It is not an official WhatsApp product. Use responsibly and in accordance with WhatsApp's Terms of Service.
