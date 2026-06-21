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

  assert.match(html, /<pre class="code-block-pre" data-lang="js">/)
  assert.match(html, /<span class="code-lang">js<\/span>/)
  assert.match(html, /<button class="code-copy-btn" data-copy-btn>复制<\/button>/)
  assert.match(html, /<div class="code-block-wrapper">/)
  assert.match(html, /&quot;&lt;tag&gt;&quot;/)
  assert.match(html, /&lt;pre&gt;&lt;img src=x onerror=alert\(1\)&gt;&lt;\/pre&gt;/)
  assert.doesNotMatch(html, /<pre><img/i)
})

test('renderMarkdown renders execution-flow markdown document syntax', () => {
  const html = renderMarkdown([
    '# 专家团执行流程',
    '#### 阶段 1：准备',
    '- [x] 收集输入',
    '  - 校验专家配置',
    '- [ ] 生成交付文档',
    '> 主持人会综合专家意见',
    '> 并标注风险和下一步',
    '---',
    '| 阶段 | 状态 |',
    '| --- | --- |',
    '| 准备 | 完成 |',
  ].join('\n'))

  assert.match(html, /<h1>专家团执行流程<\/h1>/)
  assert.match(html, /<h4>阶段 1：准备<\/h4>/)
  assert.match(html, /<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" disabled checked> 收集输入<\/li>/)
  assert.match(html, /<li class="md-list-depth-1">校验专家配置<\/li>/)
  assert.match(html, /<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" disabled> 生成交付文档<\/li>/)
  assert.match(html, /<blockquote><p>主持人会综合专家意见<br>并标注风险和下一步<\/p><\/blockquote>/)
  assert.match(html, /<hr>/)
  assert.match(html, /<table>/)
  assert.match(html, /<th>阶段<\/th>/)
  assert.match(html, /<td>完成<\/td>/)
})

test('renderMarkdown preserves visual hierarchy for nested execution lists', () => {
  const html = renderMarkdown([
    '1. 准备',
    '  1. 读取上下文',
    '    - [x] 建立基线',
    '      - 记录未处理风险',
    '2. 交付',
  ].join('\n'))

  assert.match(html, /<ol>/)
  assert.match(html, /<li>准备<\/li>/)
  assert.match(html, /<li class="md-list-depth-1">读取上下文<\/li>/)
  assert.match(html, /<li class="task-list-item md-list-depth-2"><input class="task-list-checkbox" type="checkbox" disabled checked> 建立基线<\/li>/)
  assert.match(html, /<li class="md-list-depth-3">记录未处理风险<\/li>/)
  assert.match(html, /<li>交付<\/li>/)
})
