import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const modelsPage = readFileSync(new URL('../src/pages/models.js', import.meta.url), 'utf8')
const modelsCss = readFileSync(new URL('../src/style/pages/models.css', import.meta.url), 'utf8')
const locale = readFileSync(new URL('../src/locales/modules/models.js', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return modelsCss.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('OpenClaw models page exposes a primary model control console', () => {
  assert.match(modelsPage, /models-control-console/)
  assert.match(modelsPage, /id="models-primary-combobox-container"/)
  assert.match(modelsPage, /createModelCombobox\(comboContainer/)
  assert.match(modelsPage, /id="models-test-primary"/)
  assert.match(modelsPage, /id="models-locate-primary"/)
  assert.match(modelsPage, /id="models-apply-gateway"/)
  assert.match(modelsPage, /id="models-toggle-fallbacks"/)
  assert.match(modelsPage, /models-route-presets/)
})

test('OpenClaw models page wires quick model switching and fallback actions', () => {
  assert.match(modelsPage, /onSelect\(value\)/)
  assert.match(modelsPage, /setPrimary\(state,\s*value\)/)
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
  assert.match(cssBlock('.models-control-console'), /display:\s*flex/)
  assert.match(cssBlock('.models-control-console'), /flex-direction:\s*column/)
  assert.match(cssBlock('.models-console-footer'), /border-top:\s*1px solid var\(--border-secondary\)/)
  assert.match(cssBlock('.models-preset-btn'), /min-height:\s*30px/)
  assert.match(modelsCss, /(?:^|\n)\.models-status\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(cssBlock('.models-fallback-pill'), /max-width:\s*160px/)
  assert.match(cssBlock('.fallback-workbench'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*0\.92fr\)/)
  assert.match(cssBlock('.model-reasoning-toggle'), /display:\s*inline-flex/)
  assert.match(modelsCss, /@media \(max-width:\s*980px\)[\s\S]*\.fallback-workbench\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(modelsCss, /@media \(max-width:\s*640px\)[\s\S]*\.models-control-console\s*\{[\s\S]*padding:\s*var\(--space-lg\)/)
})

test('Model console locale keys are present', () => {
  for (const key of ['manageFallbacks', 'testPrimary', 'locateModel', 'addFallback', 'removeFallback', 'invalidRefs', 'routeFast', 'routeStable', 'routeContext', 'routeReasoning', 'isReasoningLabel', 'reasoningHint']) {
    assert.match(locale, new RegExp(`${key}:\\s*_\\(`), `${key} should be translated`)
  }
})

test('Models page saves config without restarting Gateway', () => {
  assert.doesNotMatch(modelsPage, /from ['"]\.\.\/lib\/gateway-restart-queue\.js['"]/)
  assert.doesNotMatch(modelsPage, /\bscheduleGatewayRestart\b/)
  assert.doesNotMatch(modelsPage, /\bfireRestartNow\b/)
  assert.doesNotMatch(modelsPage, /\bonRestartState\b/)
  assert.doesNotMatch(modelsPage, /\bcancelPendingRestart\b/)
  assert.match(modelsPage, /writeOpenclawConfig\(state\.config,\s*\{\s*noReload:\s*true\s*\}\)/)
  assert.match(modelsPage, /applyGatewayConfig\(applyGatewayBtn,\s*state\)/)
  assert.match(modelsPage, /api\.reloadGateway\(\)/)
  assert.doesNotMatch(locale, /Gateway restart is queued|安排 Gateway 重启|安排 Gateway 重啟/)
  assert.match(locale, /without restarting Gateway|不会自动重启 Gateway/)
  assert.match(locale, /applyGateway:\s*_\(/)
  assert.match(locale, /applyGatewayHint:\s*_\(/)
})
