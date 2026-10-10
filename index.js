// wa-bridge/index.js
// Intermediário WhatsApp ↔ LLM
// Baileys (WhiskeySockets) + QR Code — sem Meta, sem browser
//
// Usage:
//   cp .env.example .env      # configure sua LLM endpoint
//   npm install               # instala dependências
//   node index.js             # inicia o bot

// Carrega variáveis de ambiente do .env
try {
  require('dotenv').config()
} catch {
  // dotenv é opcional — variáveis também funcionam via ambiente
}

const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('baileys')
const qrcode = require('qrcode-terminal')
const { URL } = require('url')

// Admin authorization — guards privileged commands (sair/logout/desconectar)
const ADMIN_NUMBERS = new Set(CONFIG.behavior.adminNumbers)
function isAuthorized(jid) {
  if (ADMIN_NUMBERS.size === 0) return true // empty => open (preserve current default)
  const num = (jid || '').split('@')[0]
  return ADMIN_NUMBERS.has(num)
}

// ============================================================
// CONFIG — carregado de env vars
// ============================================================
const CONFIG = {
  // Pasta onde a sessão é salva (escaneia QR uma vez)
  sessionDir: process.env.SESSION_DIR || './session',

  // Browser fingerprint (opcional)
  browser: Browsers.ubuntu('wa-bridge'),

  // LLM — conexão com o modelo de linguagem
  llm: {
    // Endpoint OpenAI-compatible (ex: Solar, OpenAI, Azure, etc.)
    // Deixe em branco para não chamar — o bot só reencaminha a mensagem
    endpoint: process.env.LLM_ENDPOINT || '',

    // Chave de API (deixe em branco se o endpoint não exigir)
    apiKey: process.env.LLM_API_KEY || '',

    // Modelo para usar
    model: process.env.LLM_MODEL || 'solar-pro4',

    // Temperatura
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,

    // System prompt — como você quer que o bot se comporte
    systemPrompt: process.env.LLM_SYSTEM_PROMPT ||
      'Você é um assistente de WhatsApp. Responda de forma natural, direta e útil.',

    // Timeout para a chamada LLM (ms)
    timeout: parseInt(process.env.LLM_TIMEOUT) || 30000,
  },

  // Comportamento do bot
  behavior: {
    // 'always' = responde tudo | 'direct' = só mensagens diretas | 'mention' = só com menção
    mode: process.env.BEHAVIOR_MODE || 'mention',

    // Prefixo de comando (opcional)
    commandPrefix: process.env.COMMAND_PREFIX || '!',

    // Números autorizados a usar comandos (formato internacional, sem +)
    // Deixe vazio para não restringir
    adminNumbers: (process.env.ADMIN_NUMBERS || '')
      .split(',')
      .map(n => n.trim())
      .filter(Boolean),

    // Em grupos: só responder com menção?
    groupMode: process.env.GROUP_MODE || 'mention',
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info', // 'debug' | 'info' | 'warn' | 'error'
}

// ============================================================
// Helpers
// ============================================================
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

function log(level, msg) {
  if (LEVELS[level] < LEVELS[CONFIG.logLevel]) return
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`)
}

function extractText(message) {
  if (!message) return ''
  if (message.conversation) return message.conversation
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
  if (message.imageMessage) return '[imagem]'
  if (message.videoMessage) return '[vídeo]'
  if (message.audioMessage) return '[áudio]'
  if (message.documentMessage) return '[documento]'
  return ''
}

function isGroup(jid) {
  return !!(jid && jid.includes('@g.us'))
}

function getSenderName(message) {
  // Extrai nome do remetente a partir do JID
  const jid = message?.key?.remoteJid
  if (!jid) return 'unknown'
  return jid.split('@')[0]
}

// ============================================================
// LLM Call
// ============================================================
async function callLLM(userMessage, senderName, isGroupChat, context = '') {
  const cfg = CONFIG.llm

  if (!cfg.endpoint) {
    log('warn', 'LLM endpoint não configurado — não responde')
    return null
  }

  // Valida endpoint
  try {
    new URL(cfg.endpoint)
  } catch {
    log('error', `LLM endpoint inválido: ${cfg.endpoint}`)
    return null
  }

  const userContent = context
    ? `Contato: ${senderName}\n${isGroupChat ? 'Grupo' : 'Individual'}\n\n${context}\n\nMensagem: ${userMessage}`
    : `${senderName}: ${userMessage}${isGroupChat ? ' (em grupo)' : ''}`

  const payload = {
    model: cfg.model,
    messages: [
      { role: 'system', content: cfg.systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: cfg.temperature,
    max_tokens: 1024,
  }

  log('debug', `Chamando LLM: ${cfg.endpoint} — "${userMessage.substring(0, 50)}"`)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), cfg.timeout)

    const response = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      throw new Error(`LLM HTTP ${response.status}: ${errBody.substring(0, 200)}`)
    }

    const data = await response.json()
    // OpenAI-compatible response
    const reply = data.choices?.[0]?.message?.content || data.reply || data.response || ''
    log('info', `LLM respondeu: "${reply.substring(0, 100)}"`)
    return reply
  } catch (err) {
    if (err.name === 'AbortError') {
      log('error', 'LLM timeout')
    } else {
      log('error', `LLM erro: ${err.message}`)
    }
    return null
  }
}

// ============================================================
// Message Router
// ============================================================
async function handleMessage(sock, message) {
  if (!message.message) return
  if (message.key.fromMe === true) return // ignora mensagens do próprio bot

  const text = extractText(message.message)
  if (!text) return

  const senderJid = message.key.remoteJid
  const senderName = getSenderName(message)
  const groupChat = isGroup(senderJid)

  log('info', `Msg de ${senderName}${groupChat ? ' (grupo)' : ''}: "${text.substring(0, 80)}"`)

  // === Comportamento por modo ===
  const mode = CONFIG.behavior.mode
  const groupMode = CONFIG.behavior.groupMode

  // Mensagens diretas
  if (!groupChat) {
    if (mode === 'always' || mode === 'direct') {
      // OK — responde
    } else {
      return
    }
  }

  // Grupos: checa menção ou comando
  if (groupChat) {
    if (groupMode === 'mention') {
      const prefix = CONFIG.behavior.commandPrefix
      const isMention =
        text.startsWith(prefix) ||
        // Baileys inclui menções em extendedTextMessage.context
        (message.message.extendedTextMessage?.context?.mentionedJid &&
          message.message.extendedTextMessage.context.mentionedJid.length > 0)

      if (!isMention) {
        log('debug', 'Grupo — sem menção, ignora')
        return
      }
    } else if (groupMode === 'always') {
      // responde tudo no grupo
    } else {
      return
    }
  }

  // === Comandos ===
  const prefix = CONFIG.behavior.commandPrefix
  if (text.startsWith(prefix)) {
    const cmd = text.substring(prefix.length).trim().toLowerCase()
    log('info', `Comando detectado: ${cmd}`)
    return handleCommand(sock, senderJid, text, cmd)
  }

  // === Resposta normal via LLM ===
  const reply = await callLLM(text, senderName, groupChat)
  if (reply) {
    try {
      await sock.sendMessage(senderJid, { text: reply })
      log('info', `Resposta enviada para ${senderName}`)
    } catch (err) {
      log('error', `Falha ao enviar: ${err.message}`)
    }
  }
}

// ============================================================
// Comandos
// ============================================================
async function handleCommand(sock, jid, fullText, cmd) {
  const args = fullText.substring(fullText.indexOf(' ') + 1).trim()

  // Guard privileged commands — adminNumbers only
  const senderNum = (jid || '').split('@')[0]
  if (['sair', 'logout', 'desconectar'].includes(cmd) && !isAuthorized(senderNum)) {
    log('warn', `Comando restrito recusado: ${cmd} de ${senderNum}`)
    await sock.sendMessage(jid, { text: '🚫 Comando restrito a administradores.' })
    return
  }

  switch (cmd) {
    case 'ajuda':
    case 'help':
      await sock.sendMessage(jid, {
        text: `Comandos disponíveis:\n` +
          `${CONFIG.behavior.commandPrefix}ajuda — mostra esta mensagem\n` +
          `${CONFIG.behavior.commandPrefix}sair — desconecta o bot\n` +
          `${CONFIG.behavior.commandPrefix}status — estado da conexão`,
      })
      break

    case 'status':
      await sock.sendMessage(jid, {
        text: `Bot online. Modo: ${CONFIG.behavior.mode}${isGroup(jid) ? ' | Grupo' : ' | Individual'}.`,
      })
      break

    case 'sair':
    case 'logout':
    case 'desconectar':
      await sock.sendMessage(jid, { text: 'Desconectando...' })
      log('info', 'Comando sair recebido — desconectando')
      await sock.logout() // preserve session — do NOT delete sessionDir
      setTimeout(() => process.exit(0), 1000)
      break

    default:
      await sock.sendMessage(jid, {
        text: `Comando "${cmd}" não reconhecido. Use ${CONFIG.behavior.commandPrefix}ajuda`,
      })
  }
}

// ============================================================
// Main — conectar e rodar
// ============================================================
let sock = null

async function connect() {
  log('info', 'Conectando ao WhatsApp via QR Code...')

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.sessionDir)

  sock = makeWASocket({
    auth: state,
    browser: CONFIG.browser,
    printQRInTerminal: false, // render manual via connection.update
  })

  // Persiste credenciais
  sock.ev.on('creds.update', saveCreds)

  // Connection lifecycle + QR Code
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      log('info', 'Scanneie o QR Code abaixo com o WhatsApp → Ajustes → Dispositivos conectados → Linkar dispositivo')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      log('info', '✅ Conectado ao WhatsApp!')
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = reason !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        log('warn', `Conexão fechada (motivo: ${reason}). Reconectando...`)
        setTimeout(connect, 5000)
      } else {
        log('error', 'Desconectado — sessão inválida. Apague a pasta ./session e reconecte.')
        process.exit(1)
      }
    }
  })

  // Mensagens
  sock.ev.on('messages.upsert', async (event) => {
    for (const message of event.messages) {
      try {
        await handleMessage(sock, message)
      } catch (err) {
        log('error', `Erro ao processar mensagem: ${err.message}`)
      }
    }
  })

  // Atualiza contatos
  sock.ev.on('contacts.update', (contacts) => {
    if (contacts && contacts.length > 0) {
      log('debug', `Contatos atualizados: ${contacts.length}`)
    }
  })
}

// Iniciar
connect().catch((err) => {
  log('error', `Falha na conexão: ${err.message}`)
  console.error(err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  log('info', 'Desligando...')
  if (sock) {
    try {
      await sock.logout()
    } catch {}
  }
  process.exit(0)
})

process.on('SIGTERM', async () => {
  log('info', 'Recebido SIGTERM — desligando...')
  if (sock) {
    try {
      await sock.logout()
    } catch {}
  }
  process.exit(0)
})

// Global error handlers
process.on('unhandledRejection', (err) => {
  log('error', `Unhandled rejection: ${err.message || err}`)
})

process.on('uncaughtException', (err) => {
  log('error', `Uncaught exception: ${err.message || err}`)
  process.exit(1)
})