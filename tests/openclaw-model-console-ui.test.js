import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const modelsPage = readFileSync(new URL('../src/pages/models.js', import.meta.url), 'utf8')
const pagesCss = readFileSync(new URL('../src/style/pages.css', import.meta.url), 'utf8')
const locale = readFileSync(new URL('../src/locales/modules/models.js', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return pagesCss.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('OpenClaw models page exposes a primary model control console', () => {
  assert.match(modelsPage, /models-control-console/)
  assert.match(modelsPage, /id="models-primary-select"/)
  assert.match(modelsPage, /<optgroup label=/)
  assert.match(modelsPage, /id="models-test-primary"/)
  assert.match(modelsPage, /id="models-locate-primary"/)
  assert.match(modelsPage, /id="models-toggle-fallbacks"/)
  assert.match(modelsPage, /models-route-presets/)
})

test('OpenClaw models page wires quick model switching and fallback actions', () => {
  assert.match(modelsPage, /primarySelect\.onchange/)
  assert.match(modelsPage, /setPrimary\(state,\s*primarySelect\.value\)/)
  assert.match(modelsPage, /function applyRoutePreset/)
  assert.match(modelsPage, /data-preset="fast"/)
  assert.match(modelsPage, /data-preset="stable"/)
  assert.match(modelsPage, /data-action="toggle-fallback"/)
  assert.match(modelsPage, /data-action="toggle-reasoning"/)
  assert.match(modelsPage, /case 'toggle-reasoning'/)
  assert.match(modelsPage, /function toggleFallbackModel/)
  assert.match(modelsPage, /function testFullModel/)
  assert.match(modelsPage, /function locateModel/)
})

test('Model console styling preserves responsive commercial layout', () => {
  assert.match(cssBlock('.models-control-console'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*420px\)/)
  assert.match(cssBlock('.models-route-presets'), /border-top:\s*1px solid var\(--border-secondary\)/)
  assert.match(cssBlock('.models-preset-btn'), /min-height:\s*30px/)
  assert.match(cssBlock('.models-health-grid'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(cssBlock('.models-fallback-pill'), /max-width:\s*190px/)
  assert.match(cssBlock('.fallback-workbench'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*0\.92fr\)/)
  assert.match(cssBlock('.model-reasoning-toggle'), /display:\s*inline-flex/)
  assert.match(pagesCss, /@media \(max-width:\s*980px\)[\s\S]*\.models-control-console\s*\{[\s\S]*grid-template-columns:\s*1fr/)
})

test('Model console locale keys are present', () => {
  for (const key of ['manageFallbacks', 'testPrimary', 'locateModel', 'addFallback', 'removeFallback', 'invalidRefs', 'routeFast', 'routeStable', 'routeContext', 'routeReasoning', 'isReasoningLabel', 'reasoningHint']) {
    assert.match(locale, new RegExp(`${key}:\\s*_\\(`), `${key} should be translated`)
  }
})
