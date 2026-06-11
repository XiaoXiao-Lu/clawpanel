import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const about = readFileSync(new URL('../src/pages/about.js', import.meta.url), 'utf8')

test('about page escapes remote version strings before injecting into innerHTML', () => {
  // The version list option markup feeds raw npm-registry version keys into the DOM.
  // Both the value attribute and visible text must be escaped to block stored XSS.
  assert.match(
    about,
    /<option value="\$\{escapeAttr\(v\)\}">\$\{escapeHtml\(v\)\}/,
    'version <option> must escape both attribute and text content',
  )

  // No upgrade/downgrade hint should interpolate a raw version value into innerHTML.
  const innerHtmlAssignments = about.match(/innerHTML\s*=\s*`[^`]*`/g) || []
  const RAW_VERSION_REFS = [
    /\$\{\s*targetVer\s*\}/,
    /\$\{\s*currentVersion\.current\s*\}/,
    /\$\{\s*version\.current\s*\}/,
    /\$\{\s*version\.recommended\s*\}/,
    /\$\{\s*version\.latest\s*\}/,
    /\{\s*ver:\s*version\.(recommended|latest)\s*\}/,
    /\{\s*version:\s*latest\s*\}/,
    /\{\s*current:\s*version\.current\b/,
  ]
  for (const block of innerHtmlAssignments) {
    for (const re of RAW_VERSION_REFS) {
      assert.doesNotMatch(block, re, `unescaped remote version interpolation in innerHTML: ${block.slice(0, 80)}`)
    }
  }
})

test('about page has both escape helpers available', () => {
  assert.match(about, /import \{ escapeHtml \} from '\.\.\/lib\/utils\.js'/, 'escapeHtml must be imported')
  assert.match(about, /function escapeAttr\(value\)/, 'escapeAttr must be defined locally')
})
