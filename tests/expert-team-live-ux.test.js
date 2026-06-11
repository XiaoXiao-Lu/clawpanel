import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const assistantJs = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')
const assistantCss = readFileSync(new URL('../src/style/assistant.css', import.meta.url), 'utf8')

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
  assert.match(assistantJs, /const liveClass = compactLive \? 'ex-live-text' : 'ast-expert-live-text'/, 'must pick the right live text class')
  assert.match(assistantJs, /scroller\.scrollTop = scroller\.scrollHeight/, 'must scroll to bottom')
})

test('expert team overview is a polite atomic live region for screen readers', () => {
  assert.match(
    assistantJs,
    /class="ex-overview" role="status" aria-live="polite" aria-atomic="true"/,
    'overview must be a polite atomic status region',
  )
})

test('expert team live output exposes throttled screen reader announcements', () => {
  assert.match(assistantJs, /const EXPERT_TEAM_LIVE_ANNOUNCE_INTERVAL = 3500/, 'announcement interval must be explicit')
  assert.match(assistantJs, /function expertTeamLiveAnnouncerHtml\(liveId\)/, 'initial render must include announcer markup')
  assert.match(assistantJs, /data-expert-live-announcer="\$\{escAttr\(liveId\)\}"/, 'announcer must be keyed to the live slot')
  assert.match(assistantJs, /aria-live="polite" aria-atomic="true"/, 'announcer must be polite and atomic')
  assert.match(assistantJs, /function shouldAnnounceExpertTeamLive\(key, content\)/, 'announcement throttle helper must exist')
  assert.match(assistantJs, /now - last < EXPERT_TEAM_LIVE_ANNOUNCE_INTERVAL/, 'announcements must be throttled')
  assert.match(assistantJs, /previousPayload\?\.announcement \|\| ''/, 'pending announcement must survive DOM debounce overwrites')
})

test('live DOM updates preserve a stable screen reader announcer node', () => {
  assert.match(assistantJs, /function ensureExpertTeamLiveAnnouncer\(slot, liveId\)/, 'announcer should be ensured instead of recreated blindly')
  assert.match(assistantJs, /slot\.insertBefore\(scroller, announcer\)/, 'visible text should be inserted before the announcer')
  assert.match(assistantJs, /if \(payload\.announcement\) announcer\.textContent = payload\.announcement/, 'announcer text must update only for throttled snapshots')
})

test('assistant live console text can be manually reviewed', () => {
  const liveTextRule = assistantCss.match(/^\.ast-expert-live-text \{[\s\S]*?\n\}/m)?.[0] || ''
  assert.match(liveTextRule, /overflow-y: auto;/, 'console live text should be scrollable')
  assert.match(liveTextRule, /scrollbar-width: thin;/, 'scrollbar should stay compact')
  assert.doesNotMatch(liveTextRule, /mask-image:/, 'scrollable review area should not fade out the bottom text')
})
