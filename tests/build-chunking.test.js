import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import viteConfig from '../vite.config.js'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const buildWithLock = fs.readFileSync(new URL('../scripts/build-with-dist-lock.mjs', import.meta.url), 'utf8')
const expertTeamsSmoke = fs.readFileSync(new URL('../scripts/expert-teams-ui-smoke.mjs', import.meta.url), 'utf8')
const linuxDeploy = fs.readFileSync(new URL('../scripts/linux-deploy.sh', import.meta.url), 'utf8')
const contributing = fs.readFileSync(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8')

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

test('build and expert team smoke share the dist lock contract', () => {
  assert.equal(pkg.scripts.build, 'node scripts/build-with-dist-lock.mjs')
  assert.match(buildWithLock, /withDistLock\(root,\s*'vite-build'/)
  assert.match(buildWithLock, /node_modules['"],\s*['"]vite['"],\s*['"]bin['"],\s*['"]vite\.js['"]/)
  assert.match(buildWithLock, /run\(process\.execPath,\s*\[viteCli,\s*'build'\]\)/)
  assert.doesNotMatch(buildWithLock, /shell:\s*true/)
  assert.match(expertTeamsSmoke, /import\s+\{\s*withDistLock\s*\}\s+from\s+['"]\.\/lib\/dist-lock\.js['"]/)
  assert.match(expertTeamsSmoke, /withDistLock\(root,\s*'expert-teams-ui-smoke'/)
  assert.ok(
    expertTeamsSmoke.indexOf("withDistLock(root, 'expert-teams-ui-smoke'") < expertTeamsSmoke.indexOf('const server = startServer()'),
    'expert team smoke should acquire the dist lock before starting the static server',
  )
  assert.match(contributing, /scripts\/build-with-dist-lock\.mjs/)
  assert.match(contributing, /不要直接执行 `vite build` 或 `npx vite build`/)
  assert.match(contributing, /`npm run expert-teams:ui` 共用 `\.tmp\/dist\.lock`/)
  assert.match(linuxDeploy, /npm run build/)
  assert.doesNotMatch(linuxDeploy, /\bnpx\s+vite\s+build\b/)
  assert.doesNotMatch(linuxDeploy, /(^|\s)vite\s+build\b/)
})
