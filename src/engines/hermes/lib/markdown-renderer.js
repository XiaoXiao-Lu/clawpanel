/**
 * Hermes — Enhanced Markdown → HTML Renderer.
 *
 * Renders GitHub-Flavored Markdown with syntax-highlighted code blocks.
 * Processing order is critical:
 *   1. Escape HTML
 *   2. Extract fenced code blocks (so their content is never touched by
 *      subsequent passes)
 *   3. Block-level: tables, headings, hr, blockquotes, lists
 *   4. Inline: code, bold, italic, strikethrough, links
 *   5. Restore code blocks
 *
 * No external dependencies. Syntax highlighting is done with pure regex.
 *
 * Usage:
 *   import { renderMarkdown } from './markdown-renderer.js'
 *   const html = renderMarkdown(md)
 */

// ---------- helpers ----------

/** Escape HTML special characters. */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------- syntax highlighting tokenizers ----------

/**
 * Keywords indexed by language alias.
 * @type {Record<string, string[]>}
 */
const KEYWORDS = {
  js: [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class',
    'extends', 'super', 'import', 'export', 'default', 'from', 'as', 'try',
    'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'await',
    'async', 'yield', 'static', 'get', 'set', 'delete', 'void', 'null',
    'undefined', 'true', 'false', 'NaN', 'Infinity', 'debugger',
  ],
  ts: [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class',
    'extends', 'super', 'import', 'export', 'default', 'from', 'as', 'try',
    'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'await',
    'async', 'yield', 'static', 'get', 'set', 'delete', 'void', 'null',
    'undefined', 'true', 'false', 'NaN', 'Infinity', 'debugger', 'type',
    'interface', 'enum', 'implements', 'abstract', 'readonly', 'private',
    'protected', 'public', 'keyof', 'infer', 'extends', 'namespace', 'module',
    'declare', 'global',
  ],
  python: [
    'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break',
    'continue', 'pass', 'import', 'from', 'as', 'try', 'except', 'finally',
    'raise', 'with', 'yield', 'lambda', 'global', 'nonlocal', 'assert', 'del',
    'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None', 'self', 'async',
    'await', 'print',
  ],
  shell: [
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done',
    'case', 'esac', 'in', 'function', 'return', 'exit', 'export', 'source',
    'alias', 'unalias', 'local', 'readonly', 'shift', 'break', 'continue',
    'echo', 'cd', 'ls', 'pwd', 'set', 'unset', 'trap', 'eval', 'exec',
    'true', 'false',
  ],
  json: [],
  yaml: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
}

/** Aliases that map to the same tokenizer. */
const LANG_ALIAS = {
  javascript: 'js',
  typescript: 'ts',
  bash: 'shell',
  sh: 'shell',
}

/**
 * Build a regex alternation of keyword tokens, longest-first so that
 * `instanceof` matches before `in`.
 */
function buildKeywordRe(lang) {
  const tokens = KEYWORDS[lang] || []
  if (!tokens.length) return null
  // Sort by descending length for greedy match.
  const sorted = [...tokens].sort((a, b) => b.length - a.length)
  return new RegExp('\\b(' + sorted.map(escapeRe).join('|') + ')\\b', 'g')
}

/** Escape special regex characters in a string. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Apply syntax highlighting to code within a fenced block.
 * @param {string} code - already HTML-escaped
 * @param {string} lang - language identifier
 * @returns {string} HTML with token spans
 */
function highlightCode(code, lang) {
  const resolved = LANG_ALIAS[lang] || lang
  const kwRe = buildKeywordRe(resolved)

  // We walk through the code line by line to apply comment highlighting
  // first (line-level), then keyword/number/string on the remainder.
  const lines = code.split('\n')
  const out = []

  for (const line of lines) {
    out.push(tokenizeLine(line, resolved, kwRe))
  }

  return out.join('\n')
}

/**
 * Tokenize a single line: comments first, then strings, numbers, keywords.
 * @param {string} line
 * @param {string} lang
 * @param {RegExp|null} kwRe
 * @returns {string}
 */
function tokenizeLine(line, lang, kwRe) {
  // --- Comments (line-level, before anything else) ---
  if (lang === 'python') {
    const ci = line.indexOf('#')
    if (ci !== -1) {
      const before = line.slice(0, ci)
      const comment = line.slice(ci)
      return tokenizeFragment(before, kwRe) +
        '<span class="tk-comment">' + comment + '</span>'
    }
  }
  if (lang === 'shell') {
    const ci = line.indexOf('#')
    if (ci !== -1) {
      const before = line.slice(0, ci)
      const comment = line.slice(ci)
      return tokenizeFragment(before, kwRe) +
        '<span class="tk-comment">' + comment + '</span>'
    }
  }
  if (lang === 'yaml') {
    const ci = line.indexOf('#')
    if (ci !== -1) {
      const before = line.slice(0, ci)
      const comment = line.slice(ci)
      return tokenizeFragment(before, kwRe) +
        '<span class="tk-comment">' + comment + '</span>'
    }
  }
  if (lang === 'js' || lang === 'ts') {
    // Single-line comment
    const si = line.indexOf('//')
    if (si !== -1) {
      const before = line.slice(0, si)
      const comment = line.slice(si)
      return tokenizeFragment(before, kwRe) +
        '<span class="tk-comment">' + comment + '</span>'
    }
  }
  // json has no comments.

  return tokenizeFragment(line, kwRe)
}

/**
 * Tokenize a fragment that has no comments:
 *   strings → numbers → keywords → rest
 * @param {string} frag
 * @param {RegExp|null} kwRe
 * @returns {string}
 */
function tokenizeFragment(frag, kwRe) {
  // --- Strings ---
  // Order matters: template literals first (backtick), then double-quoted,
  // then single-quoted. For shell we also need single-quoted strings.
  let result = frag

  // Template literals (JS/TS only — safe to apply here; no backtick strings
  // in python/shell/json/yaml)
  result = result.replace(/(`(?:[^`\\]|\\.)*`)/g, '<span class="tk-string">$1</span>')

  // Double-quoted strings (with escape support)
  result = result.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="tk-string">$1</span>')

  // Single-quoted strings
  result = result.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="tk-string">$1</span>')

  // --- Numbers ---
  result = result.replace(/\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, '<span class="tk-number">$1</span>')

  // --- Keywords ---
  if (kwRe) {
    result = result.replace(kwRe, '<span class="tk-keyword">$1</span>')
  }

  return result
}

// ---------- main renderer ----------

/**
 * Render a Markdown string to HTML.
 *
 * Processing pipeline:
 *   1. Escape HTML
 *   2. Extract code blocks → placeholders
 *   3. Tables
 *   4. Block elements (hr, headings, blockquotes, lists, task lists)
 *   5. Inline elements (code, bold, italic, strikethrough, links)
 *   6. Restore code blocks
 *   7. Paragraph wrapping + line breaks
 *
 * @param {string} md - raw markdown input
 * @returns {string} HTML string
 */
export function renderMarkdown(md) {
  if (!md || typeof md !== 'string') return ''

  let text = escHtml(md)

  // ---- Step 2: extract code blocks ----
  const codeBlocks = []
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length
    // Trim trailing newline that often comes after the opening fence.
    const trimmed = code.replace(/\n$/, '')
    const highlighted = highlightCode(trimmed, lang || '')
    const lineCount = trimmed.split('\n').length
    const foldable = lineCount > 15
    const langLabel = '<span class="code-lang">' + escHtml(lang || 'text') + '</span>'
    const foldBtn = foldable
      ? '<button class="code-fold-btn" data-fold-btn aria-label="折叠/展开代码" title="折叠/展开"></button>'
      : ''
    const wrapperAttrs = foldable ? ' data-foldable' : ''
    codeBlocks.push(
      '<div class="code-block-wrapper"' + wrapperAttrs + '>' +
      '<div class="code-block-header">' + langLabel +
      '<div class="code-block-actions">' +
      '<button class="code-copy-btn" data-copy-btn>复制</button>' + foldBtn +
      '</div></div>' +
      '<pre class="code-block-pre"><code>' + highlighted + '</code></pre>' +
      '</div>'
    )
    return '\x00CODE' + idx + '\x00'
  })

  // ---- Step 3: tables (GFM) ----
  text = renderTables(text)

  // ---- Step 4a: horizontal rules ----
  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '<hr>')

  // ---- Step 4b: ATX headings ----
  text = text.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_, content) => {
    const level = _.match(/^[ \t]*(#{1,6})/)[1].length
    return '<h' + level + '>' + content + '</h' + level + '>'
  })

  // ---- Step 4c: blockquotes ----
  // Process lines starting with >
  text = renderBlockquotes(text)

  // ---- Step 4d: unordered lists ----
  text = renderUnorderedLists(text)

  // ---- Step 4e: ordered lists ----
  text = renderOrderedLists(text)

  // ---- Step 5: inline elements (in order: code, image, link, del, bold, italic) ----

  // Inline code (must be before bold/italic so `**` inside backticks isn't touched)
  text = text.replace(/(`+)([^`]+?)\1/g, '<code>$2</code>')

  // Images ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    '<img src="$2" alt="$1" title="$3">')

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    '<a href="$2" title="$3" target="_blank" rel="noopener">$1</a>')

  // Strikethrough ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>')

  // Bold **text** or __text__
  text = text.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')

  // Italic *text* or _text_ (but not inside words with underscores)
  text = text.replace(/(?<!\w)(\*|_)([^*_\n]+?)\1(?!\w)/g, '<em>$2</em>')

  // ---- Step 6: restore code blocks ----
  text = text.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeBlocks[+idx] || '')

  // ---- Step 7: paragraph wrapping ----
  // Split on double newlines to create paragraphs. Skip lines that already
  // start with a block-level HTML tag.
  const blocks = text.split(/\n\n+/)
  const result = blocks.map(block => {
    const trimmed = block.trim()
    if (!trimmed) return ''
    // Skip wrapping if already a block-level element.
    if (/^<(h[1-6]|hr|ul|ol|li|table|blockquote|pre|div|p|nav)\b/i.test(trimmed)) {
      return trimmed
    }
    // Convert single newlines within paragraph to <br>
    const withBreaks = trimmed.replace(/\n/g, '<br>')
    return '<p>' + withBreaks + '</p>'
  })

  return result.join('\n\n')
}

// ---------- sub-renderers ----------

/**
 * Render GFM tables.
 * Expects input that already had code blocks extracted.
 * @param {string} text
 * @returns {string}
 */
function renderTables(text) {
  // Match: header row, separator row (with optional colons for alignment),
  // then one or more body rows.
  const tableRe = /^[ \t]*\|(.+)\|\s*\n[ \t]*\|([\s\-:|]+)\|\s*\n([\s\S]*?)(?=\n\n|$)/gm

  return text.replace(tableRe, (match, header, sep, body) => {
    const headers = header.split('|').map(s => s.trim())
    const aligns = sep.split('|').map(s => {
      const t = s.trim()
      if (t.startsWith(':') && t.endsWith(':')) return 'center'
      if (t.endsWith(':')) return 'right'
      return 'left'
    })

    // Build header row.
    const thead = '<thead><tr>' + headers.map((h, i) => {
      const al = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : ''
      return '<th' + al + '>' + h + '</th>'
    }).join('') + '</tr></thead>'

    // Build body rows.
    const rows = body.trim().split('\n')
    const tbody = '<tbody>' + rows.map(row => {
      const cells = row.replace(/^\||\|$/g, '').split('|').map(s => s.trim())
      return '<tr>' + cells.map((c, i) => {
        const al = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : ''
        return '<td' + al + '>' + c + '</td>'
      }).join('') + '</tr>'
    }).join('') + '</tbody>'

    return '<table>' + thead + tbody + '</table>'
  })
}

/**
 * Render blockquotes. Handles nested quotes (>>).
 * @param {string} text
 * @returns {string}
 */
function renderBlockquotes(text) {
  const lines = text.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(/^[ \t]*(>{1,})(.*)$/)
    if (match) {
      const depth = match[1].length
      let html = match[2]
      i++
      // Collect continuation lines (same depth of quoting or empty quote lines).
      while (i < lines.length) {
        const l = lines[i]
        const cm = l.match(/^[ \t]*(>{1,})(.*)$/)
        if (cm) {
          if (cm[1].length === depth) {
            html += '\n' + cm[2]
          } else {
            // Nested depth — include as-is.
            html += '\n' + l
          }
          i++
        } else if (l.trim() === '') {
          // Look ahead: if next non-empty line is a quote, keep going.
          let j = i + 1
          while (j < lines.length && lines[j].trim() === '') j++
          if (j < lines.length && /^[ \t]*>/.test(lines[j])) {
            html += '\n'
            i = j
          } else {
            break
          }
        } else {
          break
        }
      }
      out.push('<blockquote>' + html.trim() + '</blockquote>')
    } else {
      out.push(line)
      i++
    }
  }

  return out.join('\n')
}

/**
 * Render unordered lists.
 * Handles:
 *   - item
 *   * item
 *   - [ ] task (unchecked)
 *   - [x] task (checked)
 * @param {string} text
 * @returns {string}
 */
function renderUnorderedLists(text) {
  const lines = text.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // Match lines starting with - or * followed by a space.
    const listMatch = line.match(/^[ \t]*([-*])[ \t]+(.*)$/)
    if (listMatch) {
      // Start a list.
      const items = []
      while (i < lines.length) {
        const li = lines[i]
        const m = li.match(/^[ \t]*([-*])[ \t]+(.*)$/)
        if (!m) break
        items.push(m[2])
        i++
      }
      // Check if any item is a task list.
      const isTaskList = items.some(it => /^\[[ x]\]/.test(it))
      const listTag = isTaskList ? '<ul class="task-list">' : '<ul>'
      const inner = items.map(it => {
        if (isTaskList) {
          const tmatch = it.match(/^\[([ x])\]\s*(.*)$/)
          if (tmatch) {
            const checked = tmatch[1] === 'x' ? ' checked' : ''
            return '<li class="task-list-item"><input type="checkbox" disabled' + checked + '>' + tmatch[2] + '</li>'
          }
        }
        return '<li>' + it + '</li>'
      }).join('')
      out.push(listTag + inner + '</ul>')
    } else {
      out.push(line)
      i++
    }
  }

  return out.join('\n')
}

/**
 * Render ordered lists (1. item).
 * @param {string} text
 * @returns {string}
 */
function renderOrderedLists(text) {
  const lines = text.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const listMatch = line.match(/^[ \t]*(\d+)\.[ \t]+(.*)$/)
    if (listMatch) {
      const items = []
      while (i < lines.length) {
        const li = lines[i]
        const m = li.match(/^[ \t]*(\d+)\.[ \t]+(.*)$/)
        if (!m) break
        items.push(m[2])
        i++
      }
      const inner = items.map(it => '<li>' + it + '</li>').join('')
      out.push('<ol>' + inner + '</ol>')
    } else {
      out.push(line)
      i++
    }
  }

  return out.join('\n')
}

// ---------- code block toolbar events (copy + fold) ----------
// 使用全局标志，与 src/lib/markdown.js 共享同一份事件委托，防止重复注册
if (typeof window !== 'undefined' && !window.__codeBlockEventsReady) {
  window.__codeBlockEventsReady = true
  document.addEventListener('click', (e) => {
    // 复制按钮
    const copyBtn = e.target.closest('[data-copy-btn]')
    if (copyBtn) {
      const wrapper = copyBtn.closest('.code-block-wrapper')
      const code = (wrapper || copyBtn.closest('pre'))?.querySelector('code')
      if (!code) return
      navigator.clipboard.writeText(code.innerText).then(() => {
        copyBtn.textContent = '✓'
        setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
      }).catch(() => {
        copyBtn.textContent = '✗'
        setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
      })
      return
    }
    // 折叠按钮
    const foldBtn = e.target.closest('[data-fold-btn]')
    if (foldBtn) {
      const wrapper = foldBtn.closest('.code-block-wrapper')
      if (!wrapper) return
      wrapper.classList.toggle('collapsed')
    }
  })
}
