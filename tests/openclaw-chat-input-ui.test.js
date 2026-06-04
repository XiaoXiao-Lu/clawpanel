import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/style/chat.css', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('OpenClaw chat composer reserves a stable send-button column', () => {
  const block = cssBlock('.chat-input-area')
  assert.match(block, /display:\s*grid/, 'composer should use grid to prevent textarea/button overlap')
  assert.match(block, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*44px/, 'composer should reserve a fixed 44px send column')
})

test('OpenClaw chat send button preserves mobile touch size', () => {
  const block = cssBlock('.chat-send-btn')
  assert.match(block, /width:\s*44px/)
  assert.match(block, /height:\s*44px/)
  assert.match(block, /min-width:\s*44px/)
  assert.match(block, /min-height:\s*44px/)
})
