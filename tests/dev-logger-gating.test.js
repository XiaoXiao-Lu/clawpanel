import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

const logger = read('../src/lib/logger.js')

test('dev logger gates console output behind import.meta.env.DEV', () => {
  assert.match(logger, /export function devLog/, 'devLog should be exported')
  assert.match(logger, /export function devWarn/, 'devWarn should be exported')
  // Both helpers must early-return when not in DEV before touching the console.
  for (const fn of ['devLog', 'devWarn']) {
    const start = logger.indexOf(`export function ${fn}`)
    assert.notEqual(start, -1, `${fn} should exist`)
    const open = logger.indexOf('{', start)
    let depth = 0
    let body = ''
    for (let i = open; i < logger.length; i++) {
      const ch = logger[i]
      if (ch === '{') depth++
      if (ch === '}') {
        depth--
        if (depth === 0) { body = logger.slice(open + 1, i); break }
      }
    }
    assert.match(body, /if\s*\(!isDev\(\)\)\s*return/, `${fn} must early-return outside DEV`)
  }
  assert.match(logger, /import\.meta\.env\?\.DEV/, 'isDev should read import.meta.env.DEV')
})

const GATED_FILES = [
  '../src/pages/agents.js',
  '../src/pages/chat.js',
  '../src/lib/app-state.js',
  '../src/lib/window-chrome.js',
]

test('production-facing modules route debug logs through the dev logger', () => {
  for (const rel of GATED_FILES) {
    const src = read(rel)
    assert.match(src, /import \{ devLog \} from ['"][^'"]*logger\.js['"]/, `${rel} should import devLog`)
    assert.doesNotMatch(src, /\bconsole\.log\(/, `${rel} should not call bare console.log in production code`)
  }
})
