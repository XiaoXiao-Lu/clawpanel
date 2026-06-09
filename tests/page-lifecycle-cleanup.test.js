import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const openclawSetup = readFileSync(new URL('../src/pages/setup.js', import.meta.url), 'utf8')
const hermesSetup = readFileSync(new URL('../src/engines/hermes/pages/setup.js', import.meta.url), 'utf8')

test('OpenClaw setup page removes focus and visibility listeners on route cleanup', () => {
  assert.match(openclawSetup, /export function cleanup\(\)/)
  assert.match(openclawSetup, /document\.removeEventListener\('visibilitychange',\s*onVisibilityChange\)/)
  assert.match(openclawSetup, /window\.removeEventListener\('focus',\s*onVisibilityChange\)/)
  assert.match(openclawSetup, /cleanup\(\)\s*\n\s*const page = document\.createElement/)
})

test('Hermes setup page registers one document click handler and tears it down', () => {
  assert.match(hermesSetup, /function onDocumentClick\(e\)/)
  assert.match(hermesSetup, /let docClickBound = false/)
  assert.match(hermesSetup, /if\s*\(!docClickBound\)\s*\{[\s\S]*document\.addEventListener\('click',\s*onDocumentClick\)/)
  assert.match(hermesSetup, /document\.removeEventListener\('click',\s*onDocumentClick\)/)
  assert.match(hermesSetup, /new MutationObserver\(\(\) => \{[\s\S]*cleanup\(\)[\s\S]*detachObserver\.disconnect\(\)/)
})

test('Hermes setup cleanup releases Tauri install event listeners', () => {
  assert.match(hermesSetup, /if\s*\(unlisten\)\s*\{\s*unlisten\(\);\s*unlisten = null\s*\}/)
})
