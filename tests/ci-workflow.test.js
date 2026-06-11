import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

test('CI runs frontend tests before the production build', () => {
  const installIndex = ci.indexOf('run: npm ci')
  const testIndex = ci.indexOf('run: npm test')
  const buildIndex = ci.indexOf('run: npm run build')

  assert.notEqual(installIndex, -1, 'CI should install frontend dependencies')
  assert.notEqual(testIndex, -1, 'CI should run frontend tests')
  assert.notEqual(buildIndex, -1, 'CI should run the production build')
  assert.ok(installIndex < testIndex, 'frontend tests should run after npm ci')
  assert.ok(testIndex < buildIndex, 'frontend tests should run before npm run build')
})
