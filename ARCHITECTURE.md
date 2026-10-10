# wa-bridge — Architecture Report

> WhatsApp ↔ LLM bridge. Single long-lived Node.js process using Baileys
> (WhiskeySockets) for WhatsApp Web, rendering a QR code for pairing, then
> routing inbound messages to an OpenAI-compatible LLM endpoint and replying.

**Analyzed build:** `C:/Users/User/wa-bridge`
**Runtime:** Node v22.23.2 (ESM `require(esm)` supported at runtime)
**Primary entry:** `index.js` (root, 381 lines) — canonical
**Secondary copy:** `wa-bridge/index.js` (355 lines) — older/legacy duplicate

---

## 1. Entry Points

| File | Lines | Role |
|---|---|---|
| `index.js` (root) | 381 | **Canonical entry.** `npm run`/ `node index.js`. Reads all config from `process.env` (+ optional `.env` via `dotenv`). URL-validates the LLM endpoint; real mention detection; graceful SIGTERM+SIGINT. |
| `wa-bridge/index.js` | 355 | Legacy/parallel copy. Hardcoded `CONFIG` object (no env). Imports `@hapi/boom` but never uses it. Cruder mention detection. No SIGTERM. **Not** referenced by `package.json` (`main: index.js`). |
| `.env.example` | 63 | Env template — the contract for configuring the canonical entry. |

**Note on the duplicate:** Two near-identical entry files drift in behavior.
The root `index.js` (declared `main` in `package.json`) is the run entry; the
`wa-bridge/` copy is functionally older and should be reconciled or removed.

---

## 2. Execution Flow (end-to-end)

```
process boot
  │
  ├─ require('.')
  │    ├─ require('dotenv').config()   // optional, swallowed if absent
  │    ├─ require('baileys')          // makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers
  │    ├─ require('qrcode-terminal')
  │    ├─ require('url')              // URL (for endpoint validation)
  │    └─ CONFIG = {...env-driven...}
  │
  └─ connect()
       │
       ├─ useMultiFileAuthState(sessionDir)  ── restores prior creds / prepares to save them
       ├─ makeWASocket({ auth: state, browser, printQRInTerminal:false })
       │
       ├─ sock.ev.on('creds.update',  saveCreds)      ── persist session to disk
       ├─ sock.ev.on('connection.update',  handler)
       │     • qr         → qrcode.generate(qr)       (render pairing QR)
       │     • 'open'     → log "conectado"
       │     • 'close'    → reason !== DisconnectReason.loggedOut ?
       │                      reconnect via setTimeout(connect, 5000) :
       │                      process.exit(1)        (session invalid → wipe ./session)
       │
       ├─ sock.ev.on('messages.upsert',  handler)
       │     └─ for each message → handleMessage(sock, message)
       │
       └─ sock.ev.on('contacts.update', log)         // passive contact sync
```

**Per-message path inside `handleMessage`:**

```
message (messages.upsert)
  └─ guard: !message.message?            return            // no payload
  └─ guard: key.fromMe === true?        return            // ignore own messages
  └─ extractText(message.message)        → text | ''      // conversation/extendedTextMessage/images/audio/docs
  └─ guard: !text?                       return
  └─ senderJid = key.remoteJid
  └─ groupChat = isGroup(senderJid)      // '@g.us' in jid
  └─ log inbound

  ├─ groupChat?
  │     groupMode==='mention'?  must be prefixed-command OR extendedTextMessage.context.mentionedJid non-empty
  │     groupMode==='always'?   allow
  │     else                     return
  └─ !groupChat?
        mode==='always'||'direct'?  allow
        else                         return

  ├─ text starts with commandPrefix?
  │     cmd = text.slice(prefix).trim().toLowerCase()
  │     ── handleCommand(sock, jid, text, cmd)   (ajuda/help | status | sair/logout/desconectar | default)
  └─ else
        reply = await callLLM(text, senderName, groupChat)
        reply?  sock.sendMessage(senderJid, { text: reply })
```

**`callLLM`:** POST to `CONFIG.llm.endpoint` (OpenAI Chat Completions shape) with
native `fetch` + `AbortController` timeout. Reads `choices[0].message.content`,
falling back to `.reply` / `.response`. Empty endpoint ⇒ warn + no reply.

**Reconnect loop:** on `connection === 'close'`, if
`lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut` it
re-runs `connect()` after 5 s (fixed backoff; no incremental cap/jitter).

---

## 3. Architecture Layers (logical, single file)

1. **Configuration layer** — `CONFIG{}` built once from env vars (`LLM_*`,
   `BEHAVIOR_*`, `SESSION_DIR`, `LOG_LEVEL`). Twelve-factor style; no runtime
   reload.
2. **Utility layer** — `log()` (level-gated timestamped console),
   `extractText()`, `isGroup()`, `getSenderName()`.
3. **LLM integration layer** — `callLLM()`: HTTP, auth header, AbortController
   timeout, response-shape normalization, error/logging contract.
4. **Message-routing layer** — `handleMessage()`: the decision engine (group vs
   direct, mention detection, command-vs-LLM dispatch) plus the fromMe/text
   guards.
5. **Command-handling layer** — `handleCommand()`: prefix-matched, switch-based
   mini-commands.
6. **Connection/session layer** — `connect()`: socket lifecycle, QR emission,
   credential persistence, reconnect policy, graceful shutdown.

**Cross-cutting:** a single module-global `let sock = null`; all layers reach
the same socket instance. Logging (`log()`) threads through every layer.

---

## 4. Patterns & Abstractions

| Pattern | Where | Notes |
|---|---|---|
| Single long-lived process, event loop | top-level | no worker pool; one async flow per Wa hook |
| Mutable module-global socket | `let sock` | shared by handler closures; set in `connect()` |
| Guard-clause message intake | `handleMessage` | multiple early `return`s for noise filtering |
| Env-first configuration | `CONFIG` | `process.env.X || default`; optional `dotenv` |
| Graceful degradation | `callLLM` | missing endpoint ⇒ no-op instead of crash |
| Per-message isolation | `messages.upsert` | each message wrapped in try/catch |
| Reconnect-with-fixed-delay | `connection.update`'s `'close'` | 5 s `setTimeout`; not exponential |
| OpenAI-compatible adapter | `callLLM` payload/response | `model/messages/temperature/max_tokens` + 3 fallback reply keys |
| Prefix command registry | `handleCommand` `switch` | `ajuda/help`, `status`, `sair/logout/desconectar`, `default` |

---

## 5. Key Files

- **`index.js`** — the only source that matters at runtime. Sections clearly
  delimited by `// ===` banner comments (CONFIG / Helpers / LLM / Router /
  Commands / Main).
- **`wa-bridge/index.js`** — legacy mirror; functionally a less-complete version.
  Differences: hardcoded config, unused `Boom` import, string-match (not
  `mentionedJid`) mention detection, SIGINT only, no URL validation, has
  literal `***` redaction placeholders that read as syntax hazards.
- **`.env.example`** — documents the full configuration contract and defaults.
- **`package.json`** — deps: `baileys ^7.0.0-rc14`, `qrcode-terminal ^0.12.0`,
  `@hapi/boom ^10.0.1` (declared but unused by canonical entry), `dotenv`
  (optional, present in install but not in root package.json deps).
- **`ARCHITECTURE.md`** — this report.

---

## 6. Dependencies (external)

| Package | Version | Role | Status |
|---|---|---|---|
| `baileys` | 7.0.0-rc14 | WhatsApp Web socket (WASocket, auth state, events) | ESM (`"type":"module"`, `import/export`); Node 22 runs it via `require(esm)`. Live require hung >30 s because Baileys performs native init (`whatsapp-rust-bridge`) + WebSocket dial — expected, not a syntax error. |
| `qrcode-terminal` | 0.12.0 | Renders pairing QR to terminal in `connection.update` | CJS; used directly |
| `@hapi/boom` | 10.0.1 | Error shaping | **Declared but unused** by canonical entry. Imported-but-unused in legacy `wa-bridge/index.js`. `DisconnectReason.loggedOut` (numeric) is used instead. |
| `dotenv` | present | `.env` loader | Optional; guarded `try/catch` so absence is fine. Not listed in root `package.json` deps (install drift). |
| (Node globals) `fetch` / `AbortController` / `URL` | Node ≥18 | LLM HTTP call + timeout | Node 22 here ✓ |

All four packages verified installed under `node_modules/` (baileys depends on
`@hapi/boom@^9.1.3` nested too).

---

## 7. Findings & Recommendations

### Architectural (evidence-backed)

1. **Duplicate entry points drift.** Root `index.js` is the real entry (`main`
   in `package.json`, has `Usage:` block); `wa-bridge/index.js` is a stale copy
   with weaker behavior. **Recommendation:** keep one, delete the other, or
   explicitly designate one as the reference.
2. **Single-file, no physical modules.** All "layers" are comment-delimited
   sections. Fine for a 380-line bot; **recommendation:** if behavior grows,
   split into `config/`, `llm.js`, `router.js`, `commands.js`, `bot.js` with the
   socket passed explicitly (removes the module-global `sock`).
3. **Event-driven, single process.** No concurrency limit on
   `messages.upsert` processing — under burst load, `callLLM` calls fan out with
   no queue/backpressure. **Recommendation:** add a small concurrency limiter
   (e.g. `p-limit`) per chat to avoid LLM stampede and rate-limit burns.

### Correctness concerns

4. **`@hapi/boom` is dead.** Imported in the legacy copy, never used in the
   canonical entry. **Recommendation:** drop it from `package.json` to remove
   surface area; use `DisconnectReason` numeric codes (already done) or a
   real `instanceof` Boom check where error shaping is actually needed.
5. **`adminNumbers` is parsed but not enforced.** `handleCommand` runs for any
   sender; the config even says "leave blank to not restrict," but populated
   admins are never checked. **Recommendation:** guard `handleCommand` / LLM use
   with an `ownerOnly`/`adminOnly` check on `!args`/specific commands.
6. **`args` is computed then unused** in `handleCommand` — dead variable.

### Runtime nuances

7. **Baileys is ESM; entry uses `require`.** Works on Node 22 via `require(esm)`
   but the process performs real network/native init on import, so it can't be
   unit-tested without mocking `baileys`. **Recommendation:** for testability,
   inject the socket (or a mock) into `handleMessage`/`handleCommand` rather
   than relying on the module-global `sock`.
8. **Reconnect is fixed-delay, no jitter / cap.** `setTimeout(connect, 5000)`
   loops forever on persistent errors (could hammer while offline). **Recommendation:**
   incremental backoff with a ceiling; only reconnect on transient codes, not
   on all non-`loggedOut` reasons.

### Quality of life (low-risk)

9. `getSenderName` returns the JID phone-number prefix, not the contact's
   display name (no contact store). Acceptable given the "simple attempt"
   comment.
10. Mention detection is correct in the canonical entry
    (`extendedTextMessage.context.mentionedJid`); the legacy copy's string-match
    on `senderName` (a phone prefix) is wrong — reinforces fixing the duplicate.
11. QR is rendered inside `connection.update` (correct pairing with
    `printQRInTerminal: false`).

---

_No tests exist (`npm test` stubs `echo Error`). The bot is integration-only;
verification today = scan QR + send a WhatsApp message._
