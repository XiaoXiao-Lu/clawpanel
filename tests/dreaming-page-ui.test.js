import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/dreaming.js', import.meta.url), 'utf8')

test('Dreaming page scopes styles and decorative elements behind content', () => {
  assert.match(source, /page\.className = 'page dream-page'/)
  assert.match(source, /\.dream-star \{[^}]*z-index:0;[^}]*pointer-events:none/)
  assert.match(source, /\.dream-moon \{[^}]*z-index:0;[^}]*pointer-events:none/)
  assert.match(source, /\.dream-hero-body \{[^}]*z-index:1/)
})

test('Dreaming page keeps mobile content inside the viewport', () => {
  assert.match(source, /@media \(max-width:560px\)/)
  assert.match(source, /\.dream-hero-tags \.badge \{[^}]*overflow-wrap:anywhere/)
  assert.match(source, /\.dream-actions \.btn \{[^}]*flex:1 1 150px/)
  assert.doesNotMatch(source, /letter-spacing:-/)
})
