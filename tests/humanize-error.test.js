import test from 'node:test'
import assert from 'node:assert/strict'

import { humanizeError, humanizeErrorText } from '../src/lib/humanize-error.js'

test('humanizeError must not be coerced with String() or template literals', () => {
  const h = humanizeError(new Error('ECONNREFUSED 127.0.0.1:443'), 'Import scan failed')
  assert.equal(typeof h, 'object')
  assert.equal(String(h), '[object Object]')
  assert.ok(h.message)
})

test('humanizeErrorText is safe for plain-string contexts', () => {
  const line = humanizeErrorText(new Error('ENOENT no such file'), 'Import scan failed')
  assert.match(line, /Import scan failed/)
  assert.doesNotMatch(line, /\[object Object\]/)
})

test('humanizeError classifies gateway connection failures before generic network errors', () => {
  const h = humanizeError('Gateway not running: ECONNREFUSED 127.0.0.1:18789', 'Gateway start failed')
  assert.equal(h.kind, 'gatewayDown')
  assert.equal(h.action?.route, '/services')
  assert.ok(h.action?.label)
})
