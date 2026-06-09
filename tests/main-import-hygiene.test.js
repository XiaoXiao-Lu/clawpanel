import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

test('main avoids redundant dynamic imports for already-loaded core modules', () => {
  for (const specifier of [
    './router.js',
    './lib/app-state.js',
    './lib/tauri-api.js',
    './lib/ws-client.js',
  ]) {
    assert.doesNotMatch(
      mainJs,
      new RegExp(`await\\s+import\\(['"]${specifier.replaceAll('.', '\\.')}['"]\\)`),
      `${specifier} is statically imported by main and should not also be dynamically imported there`,
    )
  }
})
