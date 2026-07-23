import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const componentsCss = readFileSync(new URL('../src/style/components.css', import.meta.url), 'utf8')

test('installer update modal uses a bounded icon and scrollable layout', () => {
  assert.match(
    mainJs,
    /<svg width="28" height="28" viewBox="0 0 24 24"/,
    'installer update icon should declare a fixed SVG size',
  )
  assert.match(
    componentsCss,
    /\.installer-update-modal\s*\{[^}]*max-height:\s*min\(720px,\s*calc\(100vh - 32px\)\);[^}]*overflow-y:\s*auto;[^}]*\}/s,
    'installer update modal should be vertically bounded and scrollable',
  )
  assert.match(
    componentsCss,
    /\.installer-update-icon svg\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*\}/s,
    'installer update icon SVG should be capped at 28px',
  )
  assert.match(
    componentsCss,
    /\.installer-update-actions\s*\{[^}]*flex-wrap:\s*wrap;[^}]*\}/s,
    'installer update actions should wrap on narrow screens',
  )
})
