import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wsClient = readFileSync(new URL('../src/lib/ws-client.js', import.meta.url), 'utf8')

function functionBody(name) {
  const start = wsClient.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `Expected ${name} to exist`)
  const open = wsClient.indexOf('{', start)
  let depth = 0
  for (let i = open; i < wsClient.length; i++) {
    const ch = wsClient[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return wsClient.slice(open + 1, i)
    }
  }
  throw new Error(`Could not parse ${name} body`)
}

function methodBody(name) {
  const match = new RegExp(`\\n\\s{2}(?:async\\s+)?${name}\\(`).exec(wsClient)
  assert.ok(match, `Expected ${name} method to exist`)
  const start = match.index
  const lineEnd = wsClient.indexOf('\n', start + 1)
  const open = wsClient.lastIndexOf('{', lineEnd)
  let depth = 0
  for (let i = open; i < wsClient.length; i++) {
    const ch = wsClient[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return wsClient.slice(open + 1, i)
    }
  }
  throw new Error(`Could not parse ${name} method body`)
}

test('ws-client debug logging is gated behind the dev environment', () => {
  const body = functionBody('logWsDebug')
  assert.match(body, /if\s*\(!import\.meta\.env\?\.DEV\)\s*return/)
  assert.match(body, /console\.debug\(message,\s*\.\.\.details\)/)
  assert.doesNotMatch(wsClient, /console\.log\(/, 'production WebSocket client should not use bare console.log')
})

test('ws-client logs do not expose session keys or attachment details', () => {
  const connectSuccess = methodBody('_handleConnectSuccess')
  assert.match(connectSuccess, /logWsDebug\('\[ws\] Gateway 就绪'\)/)
  const connectLogCalls = connectSuccess.split('\n').filter(line => line.includes('logWsDebug(')).join('\n')
  assert.doesNotMatch(connectLogCalls, /this\._sessionKey/)
  assert.doesNotMatch(connectLogCalls, /sessionKey['"`]?\s*[:,]/)

  const chatSend = methodBody('chatSend')
  assert.match(chatSend, /logWsDebug\('\[ws\] 发送附件:',\s*\{\s*count:\s*attachments\.length\s*\}\)/)
  assert.doesNotMatch(chatSend, /fileName/)
  assert.doesNotMatch(chatSend, /content\?\.length/)
  assert.doesNotMatch(chatSend, /附件详情/)
})

test('ws-client production error logs use sanitized summaries', () => {
  const safeError = functionBody('safeErrorSummary')
  assert.match(safeError, /safeLogText\(error\.message/)
  assert.match(safeError, /summary\.code = safeLogText\(error\.code\)/)

  const safeText = functionBody('safeLogText')
  assert.match(safeText, /\[redacted\]/)
  assert.match(safeText, /token\|password\|secret\|api/)

  const unsafeLogPattern = /console\.(?:warn|error)\([^)\n]*(?:,\s*(?:e|err|error)(?:[\s,)])|e\.reason)/
  assert.doesNotMatch(wsClient, unsafeLogPattern, 'production logs should not print raw error objects or close reasons')

  const autoPair = methodBody('_autoPairAndReconnect')
  assert.match(autoPair, /const summary = safeErrorSummary\(e\)/)
  assert.doesNotMatch(autoPair, /e\?\.message \|\| e/)

  const refresh = methodBody('_refreshCredentialsAndReconnect')
  assert.match(refresh, /const summary = safeErrorSummary\(e\)/)
  assert.doesNotMatch(refresh, /e\?\.message \|\| e/)
})

test('ws-client close reasons are sanitized before logging or display', () => {
  const closeReason = functionBody('safeCloseReason')
  assert.match(closeReason, /Gateway authentication rejected/)
  assert.match(closeReason, /safeLogText\(reason\)/)

  const doConnect = methodBody('_doConnect')
  assert.match(doConnect, /const safeReason = safeCloseReason\(e\.reason\)/)
  assert.doesNotMatch(doConnect, /console\.warn\([^)\n]*e\.reason/)
  assert.doesNotMatch(doConnect, /_setConnected\([^)\n]*e\.reason/)
  assert.doesNotMatch(doConnect, /认证失败: \$\{e\.reason/)
  assert.doesNotMatch(doConnect, /设备认证失败: \$\{e\.reason/)
})
