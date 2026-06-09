import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tauriConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const chromeJs = readFileSync(new URL('../src/lib/window-chrome.js', import.meta.url), 'utf8')
const layoutCss = readFileSync(new URL('../src/style/layout.css', import.meta.url), 'utf8')
const componentsCss = readFileSync(new URL('../src/style/components.css', import.meta.url), 'utf8')
const variablesCss = readFileSync(new URL('../src/style/variables.css', import.meta.url), 'utf8')

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('Tauri desktop window uses custom frameless chrome', () => {
  assert.equal(tauriConfig.app.windows[0].decorations, false)
  assert.match(mainJs, /initDesktopWindowChrome\(\)/)
  assert.match(chromeJs, /data-tauri-drag-region/)
  assert.match(chromeJs, /getCurrentWindow/)
  assert.match(chromeJs, /toggleMaximize/)
  assert.match(chromeJs, /minimize/)
  assert.match(chromeJs, /close/)
})

test('custom desktop titlebar reserves stable app height', () => {
  const titlebarBlock = cssBlock(layoutCss, 'body.has-desktop-chrome .desktop-titlebar')
  assert.match(cssBlock(layoutCss, 'body.has-desktop-chrome #app'), /height:\s*calc\(100vh - 36px\)/)
  assert.match(titlebarBlock, /height:\s*36px/)
  assert.match(titlebarBlock, /z-index:\s*(?:100000|var\(--z-titlebar\))/)
  if (/z-index:\s*var\(--z-titlebar\)/.test(titlebarBlock)) {
    assert.match(variablesCss, /--z-titlebar:\s*100000;/)
  }
  assert.match(cssBlock(layoutCss, '.desktop-window-btn'), /width:\s*46px/)
  assert.match(cssBlock(layoutCss, '.desktop-window-btn-close:hover'), /background:\s*var\(--error\)/)
  assert.match(cssBlock(componentsCss, 'body.has-desktop-chrome #login-overlay,\nbody.has-desktop-chrome #backend-down-overlay'), /top:\s*36px/)
})
