# Code Review Report — wa-bridge/index.js
**Reviewer:** ECC `typescript-reviewer` agent  
**File:** `wa-bridge/index.js` (355 lines)  
**Baileys:** 7.0.0-rc14  
**Date:** 2026-10-10  

---

## CRITICAL

### 1. Hardcoded API key in source — Line 29

**Location:** Line 29 (`apiKey: ***`)  
**Description:** The LLM API key is hardcoded directly in the `CONFIG` object literal. Multiple tooling layers (file readers, shell, Python) automatically redact this value, confirming a real secret is present. Committing this to version control exposes the credential to anyone with repo access, CI/CD logs, and any fork.  
**Suggested fix:** Load from an environment variable with a guard:
```js
const CONFIG = {
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    // ...
  }
}
// At startup, warn if endpoint is set but no key:
if (CONFIG.llm.endpoint && !CONFIG.llm.apiKey) {
  log('warn', 'LLM endpoint configured but LLM_API_KEY env var is not set')
}
```
Add a `.env.example` file and load `.env` via `dotenv` (or instruct users to export the variable). Add `*.env` and `session/` to `.gitignore`.

---

## HIGH

### 2. `isGroup()` dereferences `undefined` — Line 102

**Location:** Lines 101–103
```js
function isGroup(jid) {
  return jid.includes('@g.us')
}
```
**Description:** `jid` is called from `getSenderName` (line 186) and `handleCommand` (line 254) using `message.key.remoteJid` (line 185). If `remoteJid` is `undefined` (edge cases in Baileys, malformed messages, or status updates), `.includes()` throws `TypeError: Cannot read properties of undefined (reading 'includes')`. This crashes the message handler.  
**Suggested fix:**
```js
function isGroup(jid) {
  return typeof jid === 'string' && jid.includes('@g.us')
}
```

### 3. Broken mention detection — Lines 186, 199

**Location:** Line 186 (`getSenderName` → phone number), Line 199 (`text.includes(senderName)`)
```js
const senderName = getSenderName(sock, senderJid)  // returns sender's phone number
const isMention =
  text.toLowerCase().includes(senderName.toLowerCase()) ||  // checks if text contains SENDER's number
  text.startsWith(CONFIG.behavior.commandPrefix)
```
**Description:** `getSenderName` returns `jid.split('@')[0]` — the **sender's** phone number, not the bot's identity or a display name. Checking whether a group message contains the sender's own phone number is meaningless for mention detection. The bot's own JID is never compared. In Baileys, proper mention detection uses `message.message?.extendedTextMessage?.context?.mentionedJid`. As written, group mention filtering is entirely non-functional.  
**Suggested fix:**
```js
// Get the bot's own JID
const botJid = sock.user?.id

// In handleMessage:
const mentionedJids = message.message?.extendedTextMessage?.context?.mentionedJid || []
const isMention = mentionedJids.some(j => j === botJid) || text.startsWith(prefix)
```

### 4. Flawed mode/groupMode interplay — Lines 207–216

**Location:** Lines 207–216
```js
if (!groupChat && mode === 'direct')    { /* continue */ }
else if (!groupChat && mode === 'always')  { /* continue */ }
else if (groupChat && mode === 'always')   { /* continue */ }
else { return }                          // ← drops many valid messages
```
**Description:** Three problems:
- **DMs in `'mention'` mode are silently ignored** — falls to `else { return }`. Since DM channels cannot have mentions, all DMs should be allowed.
- **Group messages that mention the bot in `'direct'` mode are dropped** — even though the sender explicitly addressed the bot, the mode check returns early.
- **Group messages that mention the bot in `'mention'` mode are dropped** — the `groupMode === 'mention'` filter (line 196) passes mentioned messages through, but the `mode` check on line 207–216 then rejects them because there's no `mode === 'mention'` branch.
- The `if/else` chain is redundant: the first two branches can be collapsed.
**Suggested fix:** Replace with clear boolean logic:
```js
// DM: respond if mode allows DMs
const dmAllowed = !groupChat && (mode === 'direct' || mode === 'always' || mode === 'mention')
// Group: respond if mode is 'always', or if 'mention'/'direct' and the message mentioned the bot or is a command
const groupAllowed = groupChat && (mode === 'always' || isMention)
if (!dmAllowed && !groupAllowed) return
```

---

## MEDIUM

### 5. `sock.logout(false)` — type mismatch — Lines 263, 351

**Location:** Lines 263, 351
```js
await sock.logout(false) // false = não apaga sessão
```
**Description:** Baileys's `logout` signature is `(msg?: string) => Promise<void>`. It accepts an optional **string** message, not a boolean. Passing `false` (boolean) is a type mismatch — the parameter is either silently ignored or coerced. The comment "false = não apaga sessão" (false = don't delete session) is incorrect; this parameter is a *logout reason message*, not a session-deletion toggle. The session directory is managed separately by `useMultiFileAuthState`.  
**Suggested fix:** Either remove the argument (`await sock.logout()`) or pass a descriptive string (`await sock.logout('logout command')`). If session preservation is desired, ensure the `./session` directory is not deleted.

### 6. Unused imports and variables — Lines 7, 116, 242

**Location:**
- Line 7: `const { Boom } = require('@hapi/boom')` — `Boom` is never referenced. `DisconnectReason` (same import) IS used (line 309).
- Line 116/227: `callLLM(userMessage, senderName, isGroupChat, context = '')` — the `context` parameter (lines 123–125) is always `''` (falsy) because `handleMessage` (line 227) calls `callLLM` with only 3 args. The entire `context ? ... : ...` branch is dead code.
- Line 242: `const args = fullText.substring(fullText.indexOf(' ') + 1).trim()` — computed in `handleCommand` but never read by any switch case.
**Suggested fix:** Remove the unused `Boom` destructure, remove the `context` parameter and its dead branch, and remove the `args` line. If command args are needed later, parse them inside each case.

### 7. No exponential backoff or retry cap on reconnect — Line 313

**Location:** Line 313: `setTimeout(connect, 5000)`
**Description:** On connection close, the bot reconnects after a fixed 5-second delay with no exponential backoff and no maximum retry count. Under persistent network failure or WhatsApp rate-limiting, this creates a tight reconnect loop that could trigger IP blocking or account lockout.  
**Suggested fix:**
```js
let reconnectAttempts = 0
const MAX_RETRIES = 5
// ...
if (shouldReconnect && reconnectAttempts < MAX_RETRIES) {
  reconnectAttempts++
  const delay = Math.min(5000 * 2 ** (reconnectAttempts - 1), 60000)
  setTimeout(connect, delay)
}
```

### 8. AbortController timeout not cleared on error path — Lines 141–172

**Location:** Lines 141, 153, 165–172
```js
const timeout = setTimeout(() => controller.abort(), cfg.timeout)
const response = await fetch(...)      // line 143
clearTimeout(timeout)                   // line 153
...
} catch (err) {                         // line 165 — skip clear!
```
**Description:** If `fetch` or `response.json()` throws a non-AbortError, execution jumps to the `catch` block, skipping `clearTimeout(timeout)`. The orphan timer fires later, calling `controller.abort()` on an already-settled controller (harmless but wasteful — keeps a closure alive and prevents clean exit).  
**Suggested fix:** Move `clearTimeout(timeout)` into a `finally` block:
```js
try {
  const response = await fetch(...)
  // ...
} catch (err) {
  // ...
} finally {
  clearTimeout(timeout)
}
```

### 9. Sequential message processing — Lines 322–330

**Location:** Lines 322–330
```js
sock.ev.on('messages.upsert', async (event) => {
  for (const message of event.messages) {
    try {
      await handleMessage(sock, message)
    } catch (err) { ... }
  }
})
```
**Description:** Messages are processed strictly sequentially with `await`. A single message triggering an LLM call (up to 30s timeout) blocks processing of all subsequent messages in the batch. During bursts (e.g., someone sends 5 messages quickly), users experience significant latency.  
**Suggested fix:** Use `Promise.allSettled` for concurrent processing, or implement a queue with bounded concurrency:
```js
await Promise.all(event.messages.map(m =>
  handleMessage(sock, m).catch(err => log('error', `...${err.message}`))
))
```
Note: `handleMessage` is independent per message, so concurrent processing is safe.

### 10. Dead `contacts.update` listener — Lines 333–336

**Location:** Lines 333–336
```js
sock.ev.on('contacts.update', (contacts) => {
  // Atualiza contatos se necessário
  log('debug', `Contatos atualizados: ${contacts.length}`)
})
```
**Description:** The comment says "Time para manter conexão viva" (a timer to keep the connection alive), but this listener does nothing to keep the connection alive and doesn't actually update any contact store. It only logs at `debug` level (which is below the default `info` level, so it never fires). The listener serves no purpose.  
**Suggested fix:** Remove the listener, or replace with actual functionality (e.g., updating a local contact cache). If kept for future use, document it clearly.

### 11. `handleCommand` sendMessage calls not individually guarded — Lines 247–271

**Location:** Lines 247, 253, 261, 268
**Description:** None of the `sock.sendMessage(...)` calls inside `handleCommand` are wrapped in `try/catch`. If WhatsApp rejects the send (network, ban, etc.), the error propagates to the `messages.upsert` handler's catch (line 326), but the switch statement halts — subsequent cases or fallthrough logic is skipped. For the `sair` case (lines 258–265), if `sendMessage` on line 261 throws, `sock.logout()` on line 263 is **never reached** — the bot fails to disconnect when the user explicitly asked it to.  
**Suggested fix:** Wrap each `sendMessage` in `try/catch` or add a helper:
```js
async function sendSafe(sock, jid, content) {
  try { return await sock.sendMessage(jid, content) }
  catch (err) { log('error', `Falha ao enviar: ${err.message}`) }
}
```

### 12. No `unhandledRejection` / `uncaughtException` handler — Module level

**Location:** Module scope (no handler anywhere)
**Description:** The process has no `process.on('unhandledRejection')` or `process.on('uncaughtException')` handler. Any promise rejection that escapes the catch blocks (e.g., a future code path, a Baileys internal error, or an error thrown inside the `log` function itself) will crash the process with an unhandled rejection.  
**Suggested fix:**
```js
process.on('unhandledRejection', (err) => {
  log('error', `Unhandled rejection: ${err?.message || String(err)}`)
})
process.on('uncaughtException', (err) => {
  log('error', `Uncaught exception: ${err?.message || String(err)}`)
  process.exit(1)
})
```

### 13. `err.message` accessed without Error-type guard — Lines 169, 233, 327, 341

**Location:** Lines 169, 233, 327, 341
```js
log('error', `LLM erro: ${err.message}`)           // line 169
log('error', `Falha ao enviar: ${err.message}`)    // line 233
log('error', `Erro ao processar mensagem: ${err.message}`) // line 327
log('error', `Falha na conexão: ${err.message}`)   // line 341
```
**Description:** In JavaScript, any value can be thrown (e.g., `throw 'string'`, `throw null`). If `err` is not an `Error` object, `err.message` is `undefined`, producing "undefined" in logs. While this doesn't crash, it makes debugging harder.  
**Suggested fix:** Use optional chaining and a fallback:
```js
log('error', `LLM erro: ${err?.message || String(err)}`)
```

---

## LOW

### 14. Relative session directory path — Line 15

**Location:** Line 15: `sessionDir: './session'`  
**Description:** A relative path depends on the process's current working directory (`process.cwd()`). If the bot is started from a different directory (e.g., via systemd, pm2, or a Docker container), the session is stored in an unexpected location, potentially creating session files in unintended directories.  
**Suggested fix:** Use `path.join(__dirname, 'session')` (requires `const path = require('path')`).

### 15. `isFromMe` has unused `sock` parameter — Line 92

**Location:** Line 92: `function isFromMe(sock, message)`  
**Description:** The `sock` parameter is declared but never used inside the function. It only reads `message.key.fromMe`.  
**Suggested fix:** `function isFromMe(message) { try { return message.key.fromMe === true } catch { return false } }` and update the call site on line 180.

### 16. `getSenderName` returns phone number, not a name — Lines 105–111

**Location:** Lines 105–111
```js
function getSenderName(sock, jid) {
  if (isGroup(jid)) { return jid.split('@')[0] + ' (grupo)' }
  return jid.split('@')[0]
}
```
**Description:** Returns the phone number portion of the JID, not a display name. The comment acknowledges this ("em produção use o store de contatos"). While not a bug, it means command/mention logic and log messages show phone numbers instead of names.  
**Suggested fix:** In `connect()`, build a contact store from `sock.ev.on('contacts.upsert', ...)` and resolve names there. This is a known limitation, not a defect.

### 17. `handleMessage` function length — Lines 178–236

**Location:** Lines 178–236 (~59 lines)
**Description:** The function handles three responsibilities: message filtering/permissions, command dispatch, and LLM reply. It exceeds comfortable readability thresholds and would benefit from extraction of the mode-checking logic and command dispatch.  
**Suggested fix:** Extract `shouldRespond(groupChat, message, senderJid)` and `dispatchCommand(sock, jid, text, cmd)` into separate functions.

### 18. Hardcoded 1-second exit delay — Line 264

**Location:** Line 264: `setTimeout(() => process.exit(0), 1000)`  
**Description:** The `!sair` command waits a hardcoded 1 second before exiting. There's no confirmation that `sock.logout()` completed, and the delay is arbitrary. If `logout` takes longer than 1 second, the process exits mid-disconnect.  
**Suggested fix:** Await `sock.logout()` fully and remove the `setTimeout`, or use `sock.logout().then(() => process.exit(0))`.

### 19. Empty "bot online" block — Line 304

**Location:** Line 304: `// Envie um aviso de que o bot está online (opcional)`  
**Description:** When `connection === 'open'`, the code logs a connection message but the "send online notice" is an empty comment placeholder. No actual broadcast is implemented.  
**Suggested fix:** If the feature is not needed, remove the dead comment. If needed, implement a `sock.sendMessage` to admin numbers.

### 20. No tests configured — `package.json`

**Location:** `package.json` line 7: `"test": "echo \"Error: no test specified\" && exit 1"`  
**Description:** No test framework is configured. The project has zero test coverage for critical paths (message routing, command parsing, LLM calls, error handling).  
**Suggested fix:** Add a test framework (Jest, Vitest) and write tests covering `extractText`, `isGroup`, `handleCommand` argument parsing, and the mode/groupMode decision logic.

### 21. `extractText` truthiness for falsy conversation — Line 83

**Location:** Line 83: `if (message.conversation) return message.conversation`  
**Description:** If `message.conversation` is `0`, `false`, or an empty string, the truthiness check is skipped and the function falls through to other checks. For WhatsApp text messages, `conversation` is always a non-empty string, so this is not a practical issue, but it's a latent edge case.  
**Suggested fix:** Use explicit type check: `if (typeof message.conversation === 'string') return message.conversation`.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 4     |
| MEDIUM   | 9     |
| LOW      | 8     |
| **Total**| **22**|

### Risk assessment

The project compiles and runs but has **one CRITICAL security issue** (hardcoded API key) that must be addressed before any deployment. The **4 HIGH findings** affect core correctness: the bot cannot reliably detect mentions (finding #3), will crash on messages without a `remoteJid` (finding #2), and has contradictory mode logic that silently drops addressed messages (finding #4). The **9 MEDIUM findings** affect reliability (no backoff reconnect, orphaned timers, sequential message blocking) and maintainability (dead code, type mismatches). The **8 LOW findings** are code-quality and maintainability improvements.
