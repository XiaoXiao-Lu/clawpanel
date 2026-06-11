import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const assistantJs = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')

// Brace-matching helpers fail on regex literals like {1,6} inside this function,
// so assert against the raw source instead.

test('expert team live preview supports tail mode that follows the latest output', () => {
  assert.match(assistantJs, /function expertTeamLiveText\(content, limit = 900, opts = \{\}\)/)
  assert.match(assistantJs, /if \(opts\.tail\)/, 'tail branch must exist')
  assert.match(assistantJs, /plain\.slice\(plain\.length - limit\)/, 'tail must slice from the end')
  assert.match(assistantJs, /return `\.\.\.\$\{head\.trim\(\)\}`/, 'tail output is ellipsis + tail text')
  assert.match(assistantJs, /const slice = plain\.slice\(0, limit\)/, 'head truncation still present')
})

test('live streaming callers request tail mode', () => {
  const tailCalls = assistantJs.match(/expertTeamLiveText\([^)]*\{ tail: true \}\)/g) || []
  assert.ok(tailCalls.length >= 3, `expected >=3 tail callers, got ${tailCalls.length}`)
})

test('live DOM update auto-scrolls the streaming text to the bottom', () => {
  assert.match(assistantJs, /querySelector\('\.ex-live-text, \.ast-expert-live-text'\)/, 'must locate the scrollable live text')
  assert.match(assistantJs, /scroller\.scrollTop = scroller\.scrollHeight/, 'must scroll to bottom')
})

test('expert team overview is a polite atomic live region for screen readers', () => {
  assert.match(
    assistantJs,
    /class="ex-overview" role="status" aria-live="polite" aria-atomic="true"/,
    'overview must be a polite atomic status region',
  )
})
