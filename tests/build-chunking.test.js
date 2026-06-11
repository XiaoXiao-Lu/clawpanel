import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import viteConfig from '../vite.config.js'

const config = typeof viteConfig === 'function'
  ? viteConfig({ command: 'build', mode: 'production' })
  : viteConfig

const manualChunks = config?.build?.rollupOptions?.output?.manualChunks

test('Vite root resolves to the real project directory for stable HTML output names', () => {
  const expectedRoot = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)))
  assert.equal(config.root, expectedRoot)
})

test('Vite build splits heavy runtime and locale modules into stable chunks', () => {
  assert.equal(typeof manualChunks, 'function')

  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/node_modules/three/build/three.module.js'),
    'vendor-three',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/node_modules/three/addons/loaders/GLTFLoader.js'),
    'vendor-three-addons',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/node_modules/@tauri-apps/api/core.js'),
    'vendor-tauri',
  )

  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/src/locales/helper.js'),
    'locale-helper',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/src/locales/index.js'),
    'locale-index',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/src/locales/modules/engine.js'),
    'locale-engine',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/src/locales/modules/channels.js'),
    'locale-ops',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/src/locales/modules/assistant.js'),
    'locale-ai',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/src/locales/modules/usage.js'),
    'locale-data',
  )
  assert.equal(
    manualChunks('E:/Code/codex/ChatCraw/src/locales/modules/common.js'),
    'locale-shell',
  )

  assert.equal(config.build.chunkSizeWarningLimit, 700)
})

test('Vite dev server ignores locked Tauri build outputs on Windows paths', () => {
  const ignored = config?.server?.watch?.ignored
  assert.equal(typeof ignored, 'function')

  assert.equal(
    ignored('E:\\Code\\codex\\ChatCraw\\src-tauri\\target\\release\\deps\\clawpanel.exe'),
    true,
  )
  assert.equal(
    ignored('E:/Code/codex/ChatCraw/src/main.js'),
    false,
  )
})
