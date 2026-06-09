import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/connectors.js', import.meta.url), 'utf8')
const engine = readFileSync(new URL('../src/engines/openclaw/index.js', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../src/components/sidebar.js', import.meta.url), 'utf8')
const pagesCss = readFileSync(new URL('../src/style/pages.css', import.meta.url), 'utf8')
const locale = readFileSync(new URL('../src/locales/modules/connectors.js', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return pagesCss.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('OpenClaw registers connectors route and navigation item', () => {
  assert.match(engine, /route:\s*'\/connectors'/)
  assert.match(engine, /path:\s*'\/connectors'/)
  assert.match(engine, /pages\/connectors\.js/)
  assert.match(sidebar, /sidebar\.connectors/)
  assert.match(sidebar, /connectors:/)
})

test('Connectors page exposes commercial MCP management controls', () => {
  for (const token of [
    'connectors-console',
    'connectors-search',
    'connectors-filter',
    'data-action="add"',
    'data-action="import"',
    'data-action="export"',
    'data-action="save"',
    'connectors-preview',
    'connectors-editor',
    'data-editor-transport="stdio"',
    'data-editor-transport="http"',
  ]) {
    assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Connectors page uses structured MCP config helpers instead of ad hoc writes', () => {
  assert.match(page, /normalizeMcpServers/)
  assert.match(page, /validateMcpServer/)
  assert.match(page, /buildMcpConfigWithServers/)
  assert.match(page, /api\.readMcpConfig/)
  assert.match(page, /api\.writeMcpConfig/)
})

test('Connectors styling keeps responsive admin layout', () => {
  assert.match(cssBlock('.connectors-console'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*440px\)/)
  assert.match(cssBlock('.connectors-layout'), /grid-template-columns:\s*minmax\(280px,\s*380px\)\s*minmax\(0,\s*1fr\)/)
  assert.match(cssBlock('.connectors-preview-grid'), /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(cssBlock('.connectors-textarea'), /font-family:\s*var\(--font-mono\)/)
  assert.match(pagesCss, /@media \(max-width:\s*(?:1080|1024)px\)[\s\S]*\.connectors-layout\s*\{[\s\S]*grid-template-columns:\s*1fr/)
})

test('Connectors locale includes key operational text', () => {
  for (const key of ['title', 'add', 'importJson', 'exportJson', 'saveChanges', 'purposeTitle', 'checkTitle']) {
    assert.match(locale, new RegExp(`${key}:\\s*_\\(`), `${key} should be translated`)
  }
})
