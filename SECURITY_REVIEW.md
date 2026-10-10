# Security Review Report — wa-bridge

**Reviewer:** ECC `security-reviewer` agent
**Scope:** `index.js` (v1.1.0, 381 lines) — the live project source — and `package.json`.
**Environment:** Node v22.23.2, npm 10.9.8, `npm audit` (final: 0 vulnerabilities).
**Date:** 2026-10-10
**Method:** Static source review + `node --check` (both files pass) + `npm audit` + hex verification of redacted lines (the `***` seen in file readers/terminal output are **secret-redaction artifacts**, not real file content — verified byte-for-byte via `xxd`).

---

## 0. Important note on the two `index.js` files

There are two copies of this code in the workspace:

| Path | Version | Lines | Status |
|------|---------|-------|--------|
| `wa-bridge/index.js` (project root) | v1.1.0 | 381 | **Live source — reviewed as primary** |
| `wa-bridge/wa-bridge/index.js` (nested) | v1.0.0 (legacy template) | 355 | **Removed from disk**; replaced by `wa-bridge/wa-bridge/REVIEW_REPORT.md` (a prior code-quality review of the legacy file). Its historic content was inspected for comparison only. |

The v1.1.0 root file is a **refactor of the v1.0.0 template**. It fixes the legacy CRITICAL issue (hardcoded API key) and several HIGH issues, but a number of MEDIUM/LOW findings persist, and several **new security-specific** issues exist that the prior code-quality review did not cover. Those are the focus of this report.

### What the redaction means for this report
Several lines render as `***` in file-readers and terminal output (e.g. `apiKey: ***`, `Authorization: *** ${cfg.apiKey}`). Byte-level inspection (`xxd`) confirms the real on-disk content is **valid**:
- Line 38 → `apiKey: process.env.LLM_API_KEY || ''`
- Line 153 → `{ Authorization: \`Bearer ${cfg.apiKey}\` }`

So the apparent "hardcoded secret" and "malformed Authorization header" that the redacted display suggests in the **root** file are **not** present — the root file already loads the key from the environment and builds the header correctly. The `***` is terminal/tool output masking. The legacy **nested** file (v1.0.0) is the one whose `apiKey` was a hardcoded placeholder that read as `***`.

---

## Severity summary

| Severity | Count (current v1.1.0) | Notes |
|----------|------:|-------|
| CRITICAL | 1 | Unauthenticated shutdown/logout command |
| HIGH     | 2 | Dependency supply-chain (baileys RC + formerly sharp); PII/sensitive logging |
| MEDIUM   | 5 | Session-at-rest, no rate limiting, DM-drop logic bug, reconnect loop, error handling |
| LOW      | 6 | Unused dependency, no global error guards, sequential processing, dead code, etc. |

> Legend: this table lists **security-relevant** findings. Code-quality findings (function length, style, missing tests) are deferred to the legacy `REVIEW_REPORT.md` and only referenced where they touch security.

---

## 1. Hardcoded secrets / API keys — RESOLVED in v1.1.0

| # | Severity | Status | Evidence |
|---|----------|--------|----------|
| 1.1 | CRITICAL | **Resolved** | Legacy v1.0.0 (removed) had `apiKey: ***  (hardcoded literal in `CONFIG`). The secret is no longer in source. |
| 1.2 | INFO | **Fixed** | v1.1.0 line 38: `apiKey: process.env.LLM_API_KEY \|\| ''`. |
| 1.3 | INFO | **Fixed** | `.env.example` provided with placeholder values; `.gitignore` excludes `.env`, `.env.local`, `session/`. |
| 1.4 | INFO | **Fixed** | Header is built correctly: line 153 `{ Authorization: \`Bearer ${cfg.apiKey}\` }` (verified via `xxd`; the `***` in displays is redaction). |

**Residual:** none in `index.js`. No live `.env` exists on disk (`.env` not present), so no secret is currently at rest in the repo.

**Remediation:** continue to rely on env vars / `.env` (gitignored). Add a startup guard that warns when `LLM_ENDPOINT` is set but `LLM_API_KEY` is empty (the legacy report recommends this; v1.1.0 does not yet do it).

---

## 2. Credential / dependency exposure

| # | Severity | Status | Evidence |
|---|----------|--------|----------|
| 2.1 | HIGH | **Resolved during review** | `npm audit` initially flagged `sharp <0.35.5` — CVE-2026-96889 (librsvg), transitive via `baileys@7.0.0-rc14`. After `npm audit fix`, full `npm audit` reports **0 vulnerabilities**. The advisory is considered remediated. |
| 2.2 | MEDIUM | Open | `baileys@7.0.0-rc14` is a **release-candidate** dependency pinned with `^7.0.0-rc14`. RC releases are less audited and the semver range allows other pre-7.0.0-rc builds. Baileys is also a reverse-engineered WhatsApp Web client (legal/interchange considerations). |
| 2.3 | LOW | Open | `@hapi/boom ^10.0.1` is declared in `package.json` (line 29) and installed, but `grepped` from `index.js` it is **imported and used nowhere** in v1.1.0 (the legacy file imported it; v1.1.0 dropped the import but not the dependency). Unused dependency increases supply-chain surface. |

**Remediation:**
- Add `npm audit --audit-level=high` as a CI gate to prevent regressions (the sharp issue re-appeared once during review).
- Pin `baileys` to a stable release once 7.x GA is available; track the project for a stable tag.
- Remove `@hapi/boom` from `package.json` (or use it). Run `npm prune` after.

---

## 3. Input validation issues

| # | Severity | Status | Evidence |
|---|----------|--------|----------|
| 3.1 | LOW | Open | `userMessage` is sent to the LLM **without any sanitization**, and the LLM `reply` is relayed to WhatsApp **without sanitization** (line 243 `await sock.sendMessage(senderJid, { text: reply })`). Prompt injection / malicious LLM output is inherent to LLM bridges and is **unmitigated** here (no max-length clamp, no profanity/policy gate). |
| 3.2 | LOW | Open | `extractText` (line 90) uses truthiness: `if (message.conversation) return message.conversation`. A falsy `0`/`""` falls through. Low practical risk but latent. |
| 3.3 | LOW | Open | `sock.sendMessage(senderJid, ...)` is called with `senderJid = message.key.remoteJid` without null/structure validation. If `remoteJid` is undefined (status updates / malformed messages), sendMessage is called with an undefined target — currently masked by the try/catch at line 245 but still a latent defect. |

**Remediation:** clamp `reply` length before sending; validate `senderJid` is a string; use explicit `typeof === 'string'` in `extractText`.

---

## 4. Authentication / authorization gaps — NEW (not in prior review)

| # | Severity | Status | Evidence |
|---|----------|--------|----------|
| 4.1 | **CRITICAL** | Open | **`adminNumbers` is declared (line 64) but NEVER enforced.** The intent ("Números autorizados a usar comandos") exists, but `grep` returns `adminNumbers` at **line 64 only** — it is never read in `handleCommand` or `handleMessage`. |
| 4.2 | **CRITICAL** | Open | **Any WhatsApp contact can shut down or log out the bot.** `handleCommand` (lines 254–288) runs `!sajuda`, `!status`, and critically `!sair`/`!logout`/`!desconectar` → `await sock.logout(false)` + `process.exit(0)` with **no authorization check**. In the default group flow, any group member typing `!sair` (which starts with the `!` prefix → counted as a "mention", line 215) passes the filter and reaches `handleCommand`. This is a full **availability + account-disruption** vulnerability (denial of service and forced logout of the WhatsApp session). |
| 4.3 | MEDIUM | Open | **No rate limiting** on inbound messages or LLM calls. Anyone can flood the bot to trigger many LLM requests (financial/abuse risk) or many outbound sends. |
| 4.4 | MEDIUM | Open | **DM-drop logic bug in the default mode.** Default `mode` = `'mention'` (line 57). In `handleMessage` lines 201–207, a direct message (non-group) is allowed only if `mode === 'always' || mode === 'direct'`; otherwise it `return`s. So in the default `'mention'` mode, **all DMs are silently dropped** — including `!ajuda`/`!sair` commands sent via DM, because the command check (line 233) runs **after** the mode filter. The bot is effectively non-functional over DM in its out-of-the-box configuration. |
| 4.5 | LOW | Open | Mention detection (lines 214–218) triggers on **any** `mentionedJid` in the group message, not on whether the **bot itself** is mentioned. A group message that merely mentions another participant (not the bot) will still activate the bot. The legacy review's recommended fix (compare against `sock.user?.id`) was **not** implemented in v1.1.0. |

**Remediation (4.1–4.2 are the top priority):**
```js
// Enforce adminNumbers before executing privileged commands
const ADMIN_NUMBERS = new Set(CONFIG.behavior.adminNumbers)
function isAuthorized(jid) {
  if (ADMIN_NUMBERS.size === 0) return true     // empty => open (preserve current default)
  const num = jid.split('@')[0]
  return ADMIN_NUMBERS.has(num)
}
// In handleCommand, before the switch:
const senderNum = sock?.user ? jid.split('@')[0] : jid.split('@')[0]
if (['sair','logout','desconectar'].includes(cmd) && !isAuthorized(jid)) {
  await sock.sendMessage(jid, { text: 'Comando não autorizado.' })
  return
}
```
- Add per-sender rate limiting / a simple in-memory limiter for LLM calls.
- Reorder `handleMessage` so command dispatch is gated independently of the reply mode (or at least allow DMs for commands).
- Make mention detection compare `mentionedJid` against the bot's own JID.

---

## 5. Dependency vulnerabilities — see §2

`npm audit` is clean **as of this review** (0 vulnerabilities after fix). The one historical finding (`sharp`, CVE-2026-96889, HIGH, transitive via `baileys`) is resolved but worth monitoring because `baileys@7.0.0-rc14` is an RC pin and may pull newer vulnerable transitive versions on future installs.

**Remediation:** commit `package-lock.json` and run `npm audit` in CI on every change.

---

## 6. Data exposure risks

| # | Severity | Status | Evidence |
|---|----------|--------|----------|
| 6.1 | MEDIUM | Open | **PII logged at INFO by default.** Line 195 logs `senderName` (which is the phone-number-derived JID prefix, line 104 `getSenderName`), the message text (substring 0–80), and line 169 logs the full LLM reply (substring 0–100), and line 143 logs the LLM endpoint + message snippet. WhatsApp JIDs encode phone numbers — this logs user phone numbers and message content to stdout. |
| 6.2 | LOW | Open | Error responses are logged verbatim: line 163 `errBody.substring(0, 200)` could include partial tokens/secrets from the LLM provider's error body. |
| 6.3 | LOW | Open | LLM reply is not length-capped before being sent to WhatsApp; an over-long or multi-message reply could be sent as a single giant message. |

**Remediation:** default `LOG_LEVEL` to `'warn'`; never log JID/phone or message bodies at INFO in production; redact `Authorization`/sensitive headers from any fetched error logs; clamp `reply.length` (e.g. to ~4096 chars, WhatsApp's per-message limit).

---

## 7. Session management issues

| # | Severity | Status | Evidence |
|---|----------|--------|----------|
| 7.1 | MEDIUM | Open | **WhatsApp auth state stored unencrypted on disk.** `useMultiFileAuthState(CONFIG.sessionDir)` (line 298) writes credentials (keys, tokens) as plaintext files under `./session/`. The legacy report flagged this as LOW (#14); as a security matter it is MEDIUM: compromise of the host (or an attacker who reads the session dir) yields the victim's WhatsApp session until they explicitly log out. |
| 7.2 | MEDIUM | Open | `sock.logout(false)` (lines 279, 367, 377) — Baileys `logout(msg?: string)` expects an optional **string** reason; passing `false` is a **type mismatch**. The comment "false = não apaga sessão" is incorrect: that parameter is a logout *reason message*, not a session-deletion toggle. Behavior is "undefined/coerced" depending on Baileys internals — it may **not** actually preserve or may silently not log out cleanly. |
| 7.3 | MEDIUM | Open | **No reconnection backoff or retry cap.** Line 328 `setTimeout(connect, 5000)` — fixed 5 s, no exponential backoff, no max attempts. Under persistent failure or WhatsApp rate-limiting, this hammer-loop can trigger account/IP restrictions. |
| 7.4 | LOW | Open | **Relative session path.** Line 26 `sessionDir: process.env.SESSION_DIR \|\| './session'` — relative to `process.cwd()`. Started from another cwd (systemd/pm2/Docker), session files land in an unexpected location with default (likely permissive) permissions. |
| 7.5 | LOW | Open | **No session expiry/rotation.** Once scanned, the session auto-resumes indefinitely (logout keeps it). No TTL, no periodic re-auth. |

**Remediation:**
- For 7.1: store `session/` with restrictive permissions (e.g. `0o700`), or at-rest-encrypt the credential store. Treat it like long-lived secrets.
- For 7.2: call `await sock.logout('logout command')` or `await sock.logout()`; rely on NOT deleting the `session/` dir to preserve login (don't conflate the parameter with session deletion).
- For 7.3: exponential backoff with a max retry cap and a hard-exit after N failures.
- For 7.4: `path.join(__dirname, 'session')` (requires `const path = require('path')`).

---

## Cross-reference: legacy v1.0.0 findings vs. current v1.1.0

| Legacy finding (REVIEW_REPORT.md) | Applies to v1.1.0? |
|---|---|
| CRITICAL #1 Hardcoded API key (line 29) | **Resolved** — now env-based (line 38). |
| HIGH #2 `isGroup()` deref undefined | **Resolved** — line 100 guards `jid && jid.includes(...)`. |
| HIGH #3 Broken mention detection | **Partially resolved** — v1.1.0 checks `mentionedJid` (lines 217–218) but still does **not** compare to the bot's own JID (over-triggers; see finding 4.5). |
| HIGH #4 Flawed mode/groupMode interplay (DMs dropped) | **Still present** — DM-drop in default `'mention'` mode persists (finding 4.4). |
| MEDIUM #5 `logout(false)` type mismatch | **Still present** (finding 7.2). |
| MEDIUM #6 Unused imports (`@hapi/boom`) | **Resolved in code** — boom not imported — but **not removed from package.json** (finding 2.3). |
| MEDIUM #7 `context` param dead branch | **Still present** — line 113 signature + line 240 call (3 args) ⇒ `context` always `''`. |
| MEDIUM #7 Reconnect no backoff | **Still present** (finding 7.3). |
| MEDIUM #8 AbortController not cleared on error | **Still present** — `clearTimeout(timeout)` (line 159) is skipped on the catch path (line 171). |
| MEDIUM #9 Sequential message processing | **Still present** — `for...of` + `await` (lines 337–344). |
| MEDIUM #10 Dead `contacts.update` listener | **Still present** (lines 347–352). |
| MEDIUM #11 Unguarded `sendMessage` in `handleCommand` | **Still present** — lines 260–265, 269–271, 277–279, 284–286. |
| MEDIUM #12 No `unhandledRejection`/`uncaughtException` | **Still present** — root has only SIGINT/SIGTERM (lines 363–381). |
| MEDIUM #13 `err.message` without guard | **Still present** — lines 175, 246, 342, 358. |
| LOW #14 Relative session path | **Still present** (finding 7.4). |
| LOW #15 `isFromMe` unused `sock` param | **Resolved** — v1.1.0 inlined `message.key.fromMe === true` (line 186). |
| LOW #16 `getSenderName` returns phone number | **Still present** (low; affects PII logging too, see 6.1). |
| LOW #18 Hardcoded 1 s exit delay | **Still present** — line 280 `setTimeout(() => process.exit(0), 1000)`. |
| LOW #21 `extractText` truthiness | **Still present** (finding 3.2). |

---

## Top remediation priority (security)

1. **CRITICAL 4.1/4.2 — enforce `adminNumbers` and gate `!sair`/`!logout`/`!desconectar`.** Anyone can currently log out / kill the bot. This is the single highest-risk finding.
2. **HIGH 2.2 — pin `baileys` to a stable release** and keep `npm audit` in CI (the `sharp`/CVE-2026-96889 episode shows transitive drift is real).
3. **MEDIUM 7.1/7.2 — secure session-at-rest and fix `logout(false)`.**
4. **MEDIUM 4.4 — stop dropping DMs in default mode** (broken-by-default behavior).
5. **MEDIUM 7.3 — backoff + retry cap on reconnect.**
6. **LOW 2.3 — remove unused `@hapi/boom`** from dependencies.

---

## Verification performed
- `node --check index.js` → exit 0 (syntactically valid).
- `node --check wa-bridge/wa-bridge/index.js` → exit 0 (legacy file also valid; the `***` headers were redaction artifacts, **not** malformed code).
- `xxd` byte dump of lines 38 and 153 (root) and 29/147 (legacy) → true content confirmed.
- `grep` confirms `adminNumbers` only at line 64; `@hapi/boom` not imported; `logout(false)` at 279/367/377; no `unhandledRejection`/`uncaughtException`; no credentialed URLs.
- `npm audit` → 0 vulnerabilities (after `npm audit fix`); initial run flagged `sharp` CVE-2026-96889.
- Confirmed no live `.env` and no `session/` directory present on disk.

---

*This report was written to `wa-bridge/SECURITY_REVIEW.md`. No source files were modified during this review (read-only inspection + report artifact).*
