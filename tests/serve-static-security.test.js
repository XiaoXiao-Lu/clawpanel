import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  DIST_DIR,
  isPathInsideDirectory,
  resolveStaticFilePath,
} from '../scripts/serve.js'

test('headless static server resolves normal dist assets safely', () => {
  const resolved = resolveStaticFilePath('/assets/app.js?cache=1')

  assert.equal(resolved.ok, true)
  assert.equal(resolved.filePath, path.resolve(DIST_DIR, 'assets/app.js'))
  assert.equal(resolved.urlPath, '/assets/app.js')
})

test('headless static server rejects dist-prefix sibling traversal', () => {
  const sibling = path.resolve(DIST_DIR, '..', `${path.basename(DIST_DIR)}-evil`, 'secret.txt')

  assert.equal(isPathInsideDirectory(DIST_DIR, sibling), false)
  assert.deepEqual(
    resolveStaticFilePath(`/../${path.basename(DIST_DIR)}-evil/secret.txt`),
    { ok: false, statusCode: 403, message: 'Forbidden' },
  )
})

test('headless static server rejects encoded directory traversal', () => {
  assert.deepEqual(
    resolveStaticFilePath('/%2e%2e/package.json'),
    { ok: false, statusCode: 403, message: 'Forbidden' },
  )
})

test('headless static server rejects malformed encoded paths', () => {
  assert.deepEqual(
    resolveStaticFilePath('/assets/%E0%A4%A'),
    { ok: false, statusCode: 400, message: 'Bad Request' },
  )
})
