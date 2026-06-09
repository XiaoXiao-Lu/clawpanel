import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const assistantJs = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')

function functionBody(name) {
  const start = assistantJs.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `Expected ${name} to exist`)
  const open = assistantJs.indexOf('{', start)
  let depth = 0
  for (let i = open; i < assistantJs.length; i++) {
    const ch = assistantJs[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return assistantJs.slice(open + 1, i)
    }
  }
  throw new Error(`Could not parse ${name} body`)
}

function exportedFunctionBody(name) {
  const start = assistantJs.indexOf(`export function ${name}`)
  assert.notEqual(start, -1, `Expected exported ${name} to exist`)
  const open = assistantJs.indexOf('{', start)
  let depth = 0
  for (let i = open; i < assistantJs.length; i++) {
    const ch = assistantJs[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return assistantJs.slice(open + 1, i)
    }
  }
  throw new Error(`Could not parse exported ${name} body`)
}

test('assistant cleanup detaches the page without aborting in-flight streams', () => {
  const cleanup = exportedFunctionBody('cleanup')
  assert.doesNotMatch(cleanup, /stopStreaming\s*\(/, 'route cleanup should not abort an active assistant reply')
  assert.match(cleanup, /stopStreamRefresh\s*\(/, 'route cleanup should stop only the UI refresh timer')
  assert.match(cleanup, /_messagesEl\s*=\s*null/)
  assert.match(cleanup, /_sendBtn\s*=\s*null/)
})

test('assistant remount preserves live session objects while streaming', () => {
  const render = assistantJs.slice(
    assistantJs.indexOf('export async function render()'),
    assistantJs.indexOf('// ── 事件绑定 ──')
  )
  assert.match(render, /if\s*\(!_isStreaming\)\s*loadSessions\s*\(\)/, 'remounting mid-stream must not replace _sessions')
  assert.match(render, /if\s*\(_isStreaming\)\s*\{[\s\S]*_sendBtn\.innerHTML\s*=\s*stopIcon\s*\(\)[\s\S]*startStreamRefresh\s*\(\)/)
})

test('assistant keeps explicit stop controls wired', () => {
  const stopStreaming = functionBody('stopStreaming')
  assert.match(stopStreaming, /_abortController\.abort\s*\(/, 'explicit stop should still cancel the fetch stream')
  assert.match(assistantJs, /if\s*\(_isStreaming\s*&&\s*!_textarea\.value\.trim\(\)[\s\S]*stopStreaming\s*\(\)/)
  assert.match(assistantJs, /if\s*\(_isStreaming\)\s*stopStreaming\s*\(\)/)
})

test('assistant removes remount-scoped event listeners on cleanup', () => {
  const render = assistantJs.slice(
    assistantJs.indexOf('export async function render()'),
    assistantJs.indexOf('// ── 事件绑定 ──')
  )
  const cleanup = exportedFunctionBody('cleanup')
  assert.match(render, /window\.addEventListener\('assistant-error-injected',\s*handleAssistantErrorInjected\)/)
  assert.match(cleanup, /window\.removeEventListener\('assistant-error-injected',\s*handleAssistantErrorInjected\)/)
})

test('assistant model selector exposes a real auto routing mode', () => {
  assert.match(assistantJs, /const\s+AUTO_MODEL_VALUE\s*=\s*'__auto__'/)
  assert.match(assistantJs, /modelSelectionMode\s*=\s*'auto'/)
  assert.match(assistantJs, /value="\$\{AUTO_MODEL_VALUE\}"/)
  assert.match(assistantJs, /function\s+buildAutoSlots\s*\(messages\)/)
  assert.match(assistantJs, /id="ast-auto-model-reason"/)
  assert.match(assistantJs, /_lastAutoModelReason/)
  assert.match(assistantJs, /_modelSelectSlotMap\.set\(value,\s*slot\)/)
  assert.match(assistantJs, /const\s+value\s*=\s*`slot-\$\{index\}`/)
  assert.doesNotMatch(assistantJs, /<option value="\$\{escHtml\([^}]*baseUrl/)
  assert.doesNotMatch(assistantJs, /<option value="\$\{escHtml\([^}]*apiKey/)

  const switchActiveModel = functionBody('switchActiveModel')
  assert.match(switchActiveModel, /value\s*===\s*AUTO_MODEL_VALUE/)
  assert.match(switchActiveModel, /_config\.modelSelectionMode\s*=\s*'auto'/)
  assert.doesNotMatch(
    switchActiveModel.slice(
      switchActiveModel.indexOf("value === AUTO_MODEL_VALUE"),
      switchActiveModel.indexOf('const slot =')
    ),
    /_config\.model\s*=/,
    'Auto mode should not overwrite the saved manual primary model'
  )
})

test('assistant auto mode routes each request through scored model slots', () => {
  const callAI = functionBody('callAI')
  assert.match(callAI, /isAutoModelMode\(\)\s*\?\s*buildAutoSlots\(messages\)\s*:\s*buildActiveSlots\(\)/)

  const buildAutoSlots = functionBody('buildAutoSlots')
  assert.match(buildAutoSlots, /classifyModelTask\(messages\)/)
  assert.match(buildAutoSlots, /scoreModelSlot\(slot,\s*task\)/)
  assert.match(buildAutoSlots, /autoReason:\s*autoModelReason\(item\.slot,\s*task\)/)
  assert.match(buildAutoSlots, /scored\.sort/)
  assert.match(buildAutoSlots, /return\s+scored\.map/)
})
