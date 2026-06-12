import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const variablesCss = readFileSync(new URL('../src/style/variables.css', import.meta.url), 'utf8')
const resetCss = readFileSync(new URL('../src/style/reset.css', import.meta.url), 'utf8')
const layoutCss = readFileSync(new URL('../src/style/layout.css', import.meta.url), 'utf8')
const componentsCss = readFileSync(new URL('../src/style/components.css', import.meta.url), 'utf8')
const pagesCss = readFileSync(new URL('../src/style/pages.css', import.meta.url), 'utf8')
const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const srcDir = fileURLToPath(new URL('../src', import.meta.url))

const runtimeCssTokens = new Set([
  '--agent-color', // set inline by agent-office-scene.js for each status panel
])

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function cssFiles(dir = srcDir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) cssFiles(file, files)
    else if (entry.isFile() && file.endsWith('.css')) files.push(file)
  }
  return files
}

test('design tokens define legacy aliases used across older pages', () => {
  const rootTokens = cssBlock(variablesCss, ':root')
  for (const name of [
    '--primary',
    '--primary-hover',
    '--border',
    '--border-color',
    '--bg-hover',
    '--bg-active',
    '--accent-bg',
    '--accent-border',
    '--accent-subtle',
    '--shadow-brand',
    '--shadow-slate',
  ]) {
    assert.match(variablesCss, new RegExp(`${name}\\s*:`), `${name} should be defined as a stable token`)
  }
  assert.match(rootTokens, /--primary-hover:\s*var\(--(?:brand|aether-primary)-[a-z-]+\)/, '--primary-hover should follow the brand hover color')
  assert.match(rootTokens, /--accent-bg:\s*var\(--(?:brand|aether-primary)-[a-z-]+\)/, '--accent-bg should follow the faint brand surface')
  assert.match(rootTokens, /--accent-subtle:\s*var\(--(?:brand|aether-primary)-[a-z-]+\)/, '--accent-subtle should follow the faint brand surface')
  assert.match(mainJs, /import '\.\/style\/compat\.css'/, 'runtime should load compatibility aliases after variables.css')
})

test('global controls keep polished focus and touch affordances', () => {
  const focusBlock = cssBlock(resetCss, '[tabindex]:focus-visible')
  assert.match(focusBlock, /outline:\s*2px solid var\(--(?:brand|aether-primary)\)/)
  assert.match(focusBlock, /outline-offset:\s*2px/)
  assert.match(cssBlock(componentsCss, '.btn:focus-visible'), /box-shadow:\s*var\(--shadow-glow\)/)
  assert.match(cssBlock(componentsCss, '.btn'), /min-height:\s*3[89]px|min-height:\s*40px/)
  assert.match(cssBlock(componentsCss, '.btn-sm'), /min-height:\s*3[023]px/)
  assert.match(cssBlock(componentsCss, '.input,\n.form-input'), /min-height:\s*3[89]px|min-height:\s*4[02]px/)
  assert.match(cssBlock(componentsCss, '.tab'), /min-height:\s*3[89]px|min-height:\s*40px/)
})

test('main app shell has restrained commercial surfaces', () => {
  assert.match(cssBlock(variablesCss, ':root'), /--radius-lg:\s*12px/)
  assert.match(cssBlock(variablesCss, ':root'), /--radius-xl:\s*16px/)
  assert.match(cssBlock(variablesCss, ':root'), /--accent:\s*var\(--(?:brand|aether-primary)\)/)
  assert.match(cssBlock(layoutCss, '#content'), /background(?:-image)?:\s*linear-gradient|background:\s*var/)
  assert.match(cssBlock(layoutCss, '.nav-item'), /min-height:\s*3[689]px|min-height:\s*40px/)
  assert.match(cssBlock(layoutCss, '.nav-item.active'), /box-shadow:\s*inset 3px 0 0 var\(--(?:brand|accent|aether-primary)\)/)
})

test('dashboard and skill marketplace use raised surfaces with stable list hierarchy', () => {
  assert.match(cssBlock(variablesCss, ':root'), /--info-border:\s*rgba\([\d,\s.]+\)/)
  assert.match(cssBlock(pagesCss, '.dashboard-health-card'), /background:\s*var\(--(?:surface-raised|aether-elevated)\)/)
  assert.match(cssBlock(pagesCss, '.dashboard-health-card'), /box-shadow:\s*var\(--shadow-md\)/)
  assert.match(cssBlock(pagesCss, '.skills-store-searchbar'), /background:\s*var\(--(?:surface-raised|aether-elevated)\)/)
  assert.match(cssBlock(pagesCss, '.skills-store-results'), /display:\s*grid/)
  assert.match(cssBlock(pagesCss, '.clawhub-item.store-item:hover'), /transform:\s*translateY\(-1px\)/)
})

test('CSS variable references resolve globally or provide local fallbacks', () => {
  const definitions = new Set()
  const sourceFiles = cssFiles()

  for (const file of sourceFiles) {
    const css = stripCssComments(readFileSync(file, 'utf8'))
    for (const match of css.matchAll(/(^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)) {
      definitions.add(match[2])
    }
  }

  const unresolved = []
  for (const file of sourceFiles) {
    const css = stripCssComments(readFileSync(file, 'utf8'))
    for (const match of css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([^)]*)\)/g)) {
      const token = match[1]
      const hasFallback = match[2].includes(',')
      if (definitions.has(token) || hasFallback || runtimeCssTokens.has(token)) continue
      const displayFile = relative(srcDir, file).replaceAll('\\', '/')
      unresolved.push(`${displayFile}: ${token}`)
    }
  }

  assert.deepEqual(unresolved, [], `CSS vars without definitions or fallbacks:\n${unresolved.join('\n')}`)
})
