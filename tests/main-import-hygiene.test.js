import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const tauriApiJs = readFileSync(new URL('../src/lib/tauri-api.js', import.meta.url), 'utf8')
const hermesLibDir = new URL('../src/engines/hermes/lib/', import.meta.url)

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

test('tauri api avoids dynamic import for already-loaded WebSocket client', () => {
  assert.match(
    tauriApiJs,
    /import\s+\{\s*wsClient\s*\}\s+from\s+['"]\.\/ws-client\.js['"]/,
    'tauri-api should use the existing static ws-client binding',
  )
  assert.doesNotMatch(
    tauriApiJs,
    /import\(['"]\.\/ws-client\.js['"]\)/,
    'ws-client is already statically imported by the app and should not be dynamically imported by tauri-api',
  )
})

test('Hermes shared lib helpers import src/lib without escaping to repo root', () => {
  for (const entry of readdirSync(hermesLibDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue

    const fileUrl = new URL(entry.name, hermesLibDir)
    const source = readFileSync(fileUrl, 'utf8')
    assert.doesNotMatch(
      source,
      /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/utils\.js['"]/,
      `${entry.name} should import ../../../lib/utils.js from src/lib`,
    )
  }
})
