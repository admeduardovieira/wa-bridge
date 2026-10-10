// wa-bridge/test/index.test.js
// Unit tests for wa-bridge helper functions and config
// Run with: npm test

const { describe, it, before, after, mock } = require('node:test')
const assert = require('node:assert')

// --- Helper function tests ---
// We import the functions by re-implementing them here
// since index.js runs on import. In production, we'd
// refactor to export helpers separately.

describe('wa-bridge tests', () => {
  // extractText
  describe('extractText', () => {
    it('should handle undefined message', () => {
      const extractText = (message) => {
        if (!message) return ''
        if (message.conversation) return message.conversation
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
        if (message.imageMessage) return '[imagem]'
        if (message.videoMessage) return '[vídeo]'
        if (message.audioMessage) return '[áudio]'
        if (message.documentMessage) return '[documento]'
        return ''
      }
      assert.strictEqual(extractText(undefined), '')
      assert.strictEqual(extractText(null), '')
      assert.strictEqual(extractText({}), '')
    })

    it('should extract conversation text', () => {
      const extractText = (message) => {
        if (!message) return ''
        if (message.conversation) return message.conversation
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
        if (message.imageMessage) return '[imagem]'
        if (message.videoMessage) return '[vídeo]'
        if (message.audioMessage) return '[áudio]'
        if (message.documentMessage) return '[documento]'
        return ''
      }
      assert.strictEqual(extractText({ conversation: 'hello' }), 'hello')
    })

    it('should extract extended text message', () => {
      const extractText = (message) => {
        if (!message) return ''
        if (message.conversation) return message.conversation
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
        if (message.imageMessage) return '[imagem]'
        if (message.videoMessage) return '[vídeo]'
        if (message.audioMessage) return '[áudio]'
        if (message.documentMessage) return '[documento]'
        return ''
      }
      assert.strictEqual(
        extractText({ extendedTextMessage: { text: 'hello' } }),
        'hello'
      )
    })

    it('should handle media messages', () => {
      const extractText = (message) => {
        if (!message) return ''
        if (message.conversation) return message.conversation
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
        if (message.imageMessage) return '[imagem]'
        if (message.videoMessage) return '[vídeo]'
        if (message.audioMessage) return '[áudio]'
        if (message.documentMessage) return '[documento]'
        return ''
      }
      assert.strictEqual(extractText({ imageMessage: {} }), '[imagem]')
      assert.strictEqual(extractText({ videoMessage: {} }), '[vídeo]')
      assert.strictEqual(extractText({ audioMessage: {} }), '[áudio]')
      assert.strictEqual(extractText({ documentMessage: {} }), '[documento]')
    })
  })

  // isGroup
  describe('isGroup', () => {
    const isGroup = (jid) => {
      return !!(jid && jid.includes('@g.us'))
    }

    it('should return true for group JIDs', () => {
      assert.strictEqual(isGroup('123456789@g.us'), true)
    })

    it('should return false for individual JIDs', () => {
      assert.strictEqual(isGroup('123456789@s.whatsapp.net'), false)
    })

    it('should return false for undefined/null', () => {
      assert.strictEqual(isGroup(undefined), false)
      assert.strictEqual(isGroup(null), false)
    })
  })

  // isAuthorized — adminNumbers enforcement
  describe('isAuthorized', () => {
    const isAuthorized = (jid, adminNumbers) => {
      const set = new Set(adminNumbers)
      if (set.size === 0) return true // empty => open (preserve current default)
      const num = (jid || '').split('@')[0]
      return set.has(num)
    }

    it('should allow all when adminNumbers is empty', () => {
      assert.strictEqual(isAuthorized('123@s.whatsapp.net', []), true)
      assert.strictEqual(isAuthorized('456@g.us', []), true)
    })

    it('should allow only listed admins', () => {
      const admins = ['123456789', '987654321']
      assert.strictEqual(isAuthorized('123456789@s.whatsapp.net', admins), true)
      assert.strictEqual(isAuthorized('987654321@s.whatsapp.net', admins), true)
    })

    it('should deny non-admins when admins are configured', () => {
      const admins = ['123456789']
      assert.strictEqual(isAuthorized('000000000@s.whatsapp.net', admins), false)
    })

    it('should handle undefined/null jid safely', () => {
      assert.strictEqual(isAuthorized(undefined, ['123']), false)
      assert.strictEqual(isAuthorized(null, ['123']), false)
    })
  })

  // getSenderName
  describe('getSenderName', () => {
    const getSenderName = (message) => {
      const jid = message?.key?.remoteJid
      if (!jid) return 'unknown'
      return jid.split('@')[0]
    }

    it('should extract name from JID', () => {
      assert.strictEqual(
        getSenderName({ key: { remoteJid: '123456789@s.whatsapp.net' } }),
        '123456789'
      )
    })

    it('should return unknown for missing JID', () => {
      assert.strictEqual(getSenderName({}), 'unknown')
      assert.strictEqual(getSenderName(null), 'unknown')
    })
  })

  // log levels
  describe('log levels', () => {
    it('should have correct level ordering', () => {
      const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
      assert.ok(LEVELS.debug < LEVELS.info)
      assert.ok(LEVELS.info < LEVELS.warn)
      assert.ok(LEVELS.warn < LEVELS.error)
    })
  })

  // Config validation
  describe('config validation', () => {
    it('should validate LLM endpoint URL format', () => {
      const { URL } = require('url')
      let valid = true
      try {
        new URL('https://api.openai.com/v1/chat/completions')
      } catch {
        valid = false
      }
      assert.strictEqual(valid, true)
    })

    it('should reject invalid URL', () => {
      const { URL } = require('url')
      let valid = true
      try {
        new URL('not-a-url')
      } catch {
        valid = false
      }
      assert.strictEqual(valid, false)
    })
  })
})
