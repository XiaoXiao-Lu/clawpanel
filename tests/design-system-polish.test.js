import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const variablesCss = readFileSync(new URL('../src/style/variables.css', import.meta.url), 'utf8')
const resetCss = readFileSync(new URL('../src/style/reset.css', import.meta.url), 'utf8')
const layoutCss = readFileSync(new URL('../src/style/layout.css', import.meta.url), 'utf8')
const componentsCss = readFileSync(new URL('../src/style/components.css', import.meta.url), 'utf8')
const pagesCss = readFileSync(new URL('../src/style/pages.css', import.meta.url), 'utf8')

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('design tokens define legacy aliases used across older pages', () => {
  for (const name of ['--primary', '--primary-hover', '--border', '--border-color', '--bg-hover']) {
    assert.match(variablesCss, new RegExp(`${name}\\s*:`), `${name} should be defined as a stable token`)
  }
})

test('global controls keep polished focus and touch affordances', () => {
  assert.match(resetCss, /:focus-visible[^}]*box-shadow:\s*var\(--shadow-glow\)/s)
  assert.match(cssBlock(componentsCss, '.btn'), /min-height:\s*38px/)
  assert.match(cssBlock(componentsCss, '.btn-sm'), /min-height:\s*32px/)
  assert.match(cssBlock(componentsCss, '.input,\n.form-input'), /min-height:\s*38px/)
  assert.match(cssBlock(componentsCss, '.tab'), /min-height:\s*38px/)
})

test('main app shell has restrained commercial surfaces', () => {
  assert.match(cssBlock(variablesCss, ':root'), /--radius-lg:\s*8px/)
  assert.match(cssBlock(variablesCss, ':root'), /--radius-xl:\s*10px/)
  assert.match(cssBlock(layoutCss, '#content'), /background-image:\s*linear-gradient/)
  assert.match(cssBlock(layoutCss, '.nav-item'), /min-height:\s*36px/)
  assert.match(cssBlock(layoutCss, '.nav-item.active'), /box-shadow:\s*inset 3px 0 0 var\(--accent\)/)
})

test('dashboard and skill marketplace use raised surfaces with stable list hierarchy', () => {
  assert.match(cssBlock(pagesCss, '.dashboard-health-card'), /background:\s*var\(--surface-raised\)/)
  assert.match(cssBlock(pagesCss, '.dashboard-health-card'), /box-shadow:\s*var\(--shadow-md\)/)
  assert.match(cssBlock(pagesCss, '.skills-store-searchbar'), /background:\s*var\(--surface-raised\)/)
  assert.match(cssBlock(pagesCss, '.skills-store-preview'), /position:\s*sticky/)
  assert.match(cssBlock(pagesCss, '.clawhub-item.store-item:hover,\n.clawhub-item.store-item.active'), /transform:\s*translateY\(-1px\)/)
})
