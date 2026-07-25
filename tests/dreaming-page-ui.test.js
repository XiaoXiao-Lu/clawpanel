import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/dreaming.js', import.meta.url), 'utf8')

test('Dreaming page scopes styles and decorative elements behind content', () => {
  assert.match(source, /page\.className = 'page dream-page'/)
  assert.match(source, /\.dream-star \{[^}]*z-index:0;[^}]*pointer-events:none/)
  assert.match(source, /\.dream-moon \{[^}]*z-index:0;[^}]*pointer-events:none/)
  assert.match(source, /\.dream-hero-body \{[^}]*z-index:1/)
  assert.match(source, /\.dream-hero::after \{[^}]*z-index:2;[^}]*border:1px solid[^}]*pointer-events:none/)
})

test('Dreaming page keeps mobile content inside the viewport', () => {
  assert.match(source, /@media \(max-width:560px\)/)
  assert.match(source, /\.dream-hero-tags \.badge \{[^}]*overflow-wrap:anywhere/)
  assert.match(source, /\.dream-actions \.btn \{[^}]*flex:1 1 150px/)
  assert.doesNotMatch(source, /letter-spacing:-/)
})

test('Dreaming constellation keeps the stats row inside the frame', () => {
  assert.match(source, /\.dream-hero \{[^}]*min-height:320px/)
  assert.match(source, /\.dream-hero-body \{[^}]*flex-shrink:0/)
  assert.match(source, /\.dream-stats-row \{[^}]*flex-shrink:0/)
  assert.match(source, /@media \(max-width:900px\) \{ \.dream-hero \{ min-height:360px/)
})
