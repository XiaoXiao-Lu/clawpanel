import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/style/chat.css', import.meta.url), 'utf8')
const chatPage = readFileSync(new URL('../src/pages/chat.js', import.meta.url), 'utf8')
const chatLocale = readFileSync(new URL('../src/locales/modules/chat.js', import.meta.url), 'utf8')
const icons = readFileSync(new URL('../src/lib/icons.js', import.meta.url), 'utf8')
const wsClient = readFileSync(new URL('../src/lib/ws-client.js', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

function functionBody(name) {
  const start = chatPage.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} should exist`)
  const next = chatPage.indexOf('\nfunction ', start + 1)
  return chatPage.slice(start, next === -1 ? undefined : next)
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

test('OpenClaw chat exposes session management controls', () => {
  assert.match(chatPage, /id="chat-session-search"/)
  assert.match(chatPage, /id="chat-session-agent-filter"/)
  assert.match(chatPage, /id="chat-session-bulk-bar"/)
  assert.match(chatPage, /data-pin=/)
  assert.match(chatPage, /data-select=/)
  assert.match(chatPage, /function deleteSelectedSessions/)
  assert.match(chatPage, /STORAGE_SESSION_PINS_KEY/)
})

test('OpenClaw chat exposes message search controls', () => {
  assert.match(chatPage, /id="chat-message-search"/)
  assert.match(chatPage, /id="chat-message-search-prev"/)
  assert.match(chatPage, /id="chat-message-search-next"/)
  assert.match(chatPage, /function updateMessageSearch/)
  assert.match(chatPage, /function jumpMessageSearch/)
  assert.match(cssBlock('.chat-message-search'), /display:\s*flex/)
  assert.match(css, /\.msg\.search-current/)
})

test('OpenClaw chat model switcher uses safe option ids and visible status', () => {
  assert.match(chatPage, /id="chat-model-select"/)
  assert.match(chatPage, /id="chat-model-status"/)
  assert.match(chatPage, /let _modelOptionMap = new Map\(\)/)
  assert.match(chatPage, /const value = `model-\$\{index\}`/)
  assert.match(chatPage, /_modelOptionMap\.set\(value,\s*full\)/)
  assert.match(chatPage, /_selectedModel = _modelOptionMap\.get\(_modelSelectEl\.value\) \|\| ''/)
  assert.match(chatPage, /function formatChatModelLabel/)
  assert.doesNotMatch(chatPage, /<option value="\$\{escapeAttr\(full\)\}"/)

  assert.match(cssBlock('.chat-model-group'), /border:\s*1px solid var\(--border-primary\)/)
  assert.match(cssBlock('.chat-model-select'), /font-family:\s*var\(--font-mono\)/)
  assert.match(cssBlock('.chat-model-status'), /text-overflow:\s*ellipsis/)
})

test('OpenClaw chat sends selected model as provider/model override', () => {
  assert.match(chatPage, /function parseSelectedModelRef/)
  assert.match(chatPage, /function getSessionModelRef/)
  assert.match(chatPage, /function syncSelectedModelForSession/)
  assert.match(chatPage, /provider:\s*text\.slice\(0,\s*slash\)/)
  assert.match(chatPage, /model:\s*text\.slice\(slash \+ 1\)/)
  assert.match(chatPage, /modelRef \? \{ provider:\s*modelRef\.provider,\s*model:\s*modelRef\.model \} : undefined/)
  assert.doesNotMatch(chatPage, /chatSend\(_sessionKey,\s*`\/model \$\{_selectedModel\}`/)
  assert.doesNotMatch(chatPage, /wsClient\.sessionsPatch\(_sessionKey/)

  assert.match(wsClient, /chatSend\(sessionKey,\s*message,\s*attachments,\s*options = \{\}\)/)
  assert.match(wsClient, /if \(options\.provider\) params\.provider = options\.provider/)
  assert.match(wsClient, /if \(options\.model\) params\.model = options\.model/)
  assert.doesNotMatch(wsClient, /providerOverride/)
  assert.doesNotMatch(wsClient, /modelOverride/)
})

test('OpenClaw chat management translations and icons are present', () => {
  for (const key of ['sessionSearchPlaceholder', 'sessionDeleteSelected', 'messageSearchPlaceholder', 'messageSearchNoResult']) {
    assert.match(chatLocale, new RegExp(`${key}:\\s*_\\(`), `${key} should be translated`)
  }
  assert.match(icons, /'chevron-up'/)
  assert.match(icons, /'chevron-down'/)
})

test('OpenClaw chat AI feedback is stable, localized, and keyboard visible', () => {
  assert.match(chatPage, /function renderMessageFeedbackControls\(\)/)
  assert.match(chatPage, /svgIcon\('thumbs-up',\s*13\)/)
  assert.match(chatPage, /svgIcon\('thumbs-down',\s*13\)/)
  assert.match(chatPage, /appendAiMessage\(msg\.content \|\| '',\s*msgTime,\s*images,\s*\[\],\s*\[\],\s*\[\],\s*\[\],\s*msg\.id\)/)
  assert.match(chatPage, /appendAiMessage\(msg\.text,\s*msgTime,\s*msg\.images,\s*msg\.videos,\s*msg\.audios,\s*msg\.files,\s*msg\.tools,\s*msg\.id\)/)
  assert.match(chatPage, /const assistantMessageId = payload\.runId \|\| uuid\(\)/)
  assert.match(chatPage, /wrapper\.dataset\.msgId = assistantMessageId/)
  assert.match(chatPage, /_restoreFeedbackUI\(wrap\)/)
  assert.match(functionBody('appendAiMessage'), /renderMessageFeedbackControls\(\)/)
  assert.doesNotMatch(functionBody('appendUserMessage'), /renderMessageFeedbackControls\(\)/)
  assert.doesNotMatch(chatPage, /feedbackLike'\) \|\| '有帮助'/)
  assert.doesNotMatch(chatPage, /feedbackDislike'\) \|\| '待改进'/)

  for (const key of ['feedbackLike', 'feedbackDislike']) {
    assert.match(chatLocale, new RegExp(`${key}:\\s*_\\(`), `${key} should be translated`)
  }
  assert.match(icons, /'thumbs-up'/)
  assert.match(icons, /'thumbs-down'/)
  assert.match(cssBlock('.msg-fb-btn'), /min-width:\s*30px/)
  assert.match(cssBlock('.msg-fb-btn'), /min-height:\s*30px/)
  assert.match(css, /\.msg:focus-within \.msg-feedback/)
  assert.match(cssBlock('.msg-fb-btn:focus-visible'), /outline:\s*2px solid/)
})
