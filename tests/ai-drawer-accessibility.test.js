import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const aiDrawerJs = readFileSync(new URL('../src/components/ai-drawer.js', import.meta.url), 'utf8')

test('AI floating assistant button exposes an accessible name', () => {
  assert.match(aiDrawerJs, /fab\.title\s*=\s*t\('sidebar\.assistant'\)/)
  assert.match(aiDrawerJs, /fab\.setAttribute\('aria-label',\s*t\('sidebar\.assistant'\)\)/)
})
