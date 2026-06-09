import test from 'node:test'
import assert from 'node:assert/strict'

import { renderMarkdown } from '../src/lib/markdown.js'

test('renderMarkdown escapes raw HTML instead of injecting it into message bubbles', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>\n<script>alert(1)</script>')

  assert.doesNotMatch(html, /<script\b/i)
  assert.doesNotMatch(html, /<img\b[^>]*onerror=alert/i)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('renderMarkdown sanitizes links but keeps safe links clickable', () => {
  const html = renderMarkdown('[docs](https://example.com/docs) [bad](javascript:alert(1))')

  assert.match(html, /<a href="https:\/\/example\.com\/docs"[^>]*>docs<\/a>/)
  assert.match(html, /<a href="#"[^>]*>bad<\/a>/)
  assert.doesNotMatch(html, /javascript:/i)
})

test('renderMarkdown sanitizes image URLs and escapes image attributes', () => {
  const html = renderMarkdown('![x" onerror="alert(1)](javascript:alert(1)) ![ok](https://example.com/a.png)')

  assert.match(html, /\[图片已拦截\]/)
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="ok" class="msg-img"/)
  assert.doesNotMatch(html, /src="javascript:/i)
  assert.doesNotMatch(html, /alt="x" onerror=/i)
})

test('renderMarkdown preserves inline code and common inline formatting', () => {
  const html = renderMarkdown('Use `const x = "<tag>"` with **bold** and _emphasis_.')

  assert.match(html, /<code>const x = &quot;&lt;tag&gt;&quot;<\/code>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<em>emphasis<\/em>/)
})

test('renderMarkdown preserves fenced code blocks without trusting raw pre tags', () => {
  const html = renderMarkdown('```js\nconst x = "<tag>"\n```\n<pre><img src=x onerror=alert(1)></pre>')

  assert.match(html, /<pre data-lang="js">/)
  assert.match(html, /<span class="code-lang">js<\/span>/)
  assert.match(html, /&quot;&lt;tag&gt;&quot;/)
  assert.match(html, /&lt;pre&gt;&lt;img src=x onerror=alert\(1\)&gt;&lt;\/pre&gt;/)
  assert.doesNotMatch(html, /<pre><img/i)
})
