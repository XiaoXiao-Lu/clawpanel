/**
 * Markdown 渲染器 - 轻量级，支持代码高亮
 * 从 clawapp 移植，去掉 MEDIA 路径处理
 */
import { escapeHtml } from './utils.js'
// 浏览器环境检查：同时检查 window 和 document 存在
// 避免在 SSR/测试环境中触发 document.addEventListener
const _IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.addEventListener === 'function'

// DOMPurify 仅在浏览器环境懒加载（需要 window/document）
let DOMPurify = null
let _purifyReady = false
if (_IS_BROWSER) {
  import('dompurify').then(m => { DOMPurify = m.default; _purifyReady = true }).catch(() => {})
}

const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do',
  'switch','case','break','continue','new','this','class','extends','import',
  'export','from','default','try','catch','finally','throw','async','await',
  'yield','of','in','typeof','instanceof','void','delete','true','false',
  'null','undefined','static','get','set','super','with','debugger',
  'def','print','self','elif','lambda','pass','raise','except','None','True','False',
  'fn','pub','mut','impl','struct','enum','match','use','mod','crate','trait',
  'int','string','bool','float','double','char','byte','long','short','unsigned',
  'package','main','fmt','go','chan','defer','select','type','interface','map','range',
])

function highlightCode(code, lang) {
  const escaped = escapeHtml(code)
  // Two-phase: mark with control chars first, convert to HTML last
  // Prevents keyword regex from matching "class" inside <span class="..."> attributes
  const S = '\x02', E = '\x03'
  const CLS = ['hl-number','hl-comment','hl-string','hl-type','hl-func','hl-keyword']
  return escaped
    .replace(/\b(\d+\.?\d*)\b/g, `${S}0${E}$1${S}c${E}`)
    .replace(/(\/\/.*$|#.*$)/gm, `${S}1${E}$1${S}c${E}`)
    .replace(/(\/\*[\s\S]*?\*\/)/g, `${S}1${E}$1${S}c${E}`)
    .replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;|'[^'\n]*'|`[^`]*`)/g,
      `${S}2${E}$1${S}c${E}`)
    .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, (m, w) =>
      KEYWORDS.has(w) ? m : `${S}3${E}${w}${S}c${E}`)
    .replace(/\b(\w+)(?=\s*\()/g, (m, w) =>
      KEYWORDS.has(w) ? m : `${S}4${E}${w}${S}c${E}`)
    .replace(/\b(\w+)\b/g, (m, w) =>
      KEYWORDS.has(w) ? `${S}5${E}${w}${S}c${E}` : m)
    .replace(/\x02([0-5])\x03/g, (_, i) => `<span class="${CLS[+i]}">`)
    .replace(/\x02c\x03/g, '</span>')
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;')
}

// 预加载 Tauri convertFileSrc
let _convertFileSrc = null
if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
  import('@tauri-apps/api/core').then(m => { _convertFileSrc = m.convertFileSrc }).catch(() => {})
}

/** 将本地文件路径转换为可加载的 URL */
function resolveImageSrc(src) {
  if (!src) return src
  // 已经是 http/https/data URL → 直接返回
  if (/^(https?|data|blob):/i.test(src)) return src
  // Windows 绝对路径 (C:\... or C:/...)
  const isWinPath = /^[A-Za-z]:[\\/]/.test(src)
  // Unix 绝对路径 (/Users/... /home/... /tmp/...)
  const isUnixPath = /^\/[^/]/.test(src)
  if (isWinPath || isUnixPath) {
    // Tauri 环境：使用 convertFileSrc 转换为 asset protocol URL
    if (_convertFileSrc) {
      try { return _convertFileSrc(src) } catch {}
    }
    // Tauri 未就绪或 Web 模式：返回原始路径（onerror 会处理显示）
    return src
  }
  return src
}

function safeLinkUrl(url) {
  const value = String(url ?? '').trim()
  return /^(https?:|mailto:)/i.test(value) ? value : '#'
}

function hasUnsafeProtocol(value, allowedProtocols) {
  const raw = String(value ?? '').trim()
  if (/^[A-Za-z]:[\\/]/.test(raw)) return false
  const match = raw.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)
  return Boolean(match && !allowedProtocols.has(match[1].toLowerCase()))
}

function safeImageSrc(src) {
  const value = String(src ?? '').trim()
  if (!value) return null
  if (/^data:/i.test(value)) {
    return /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(value) ? value : null
  }
  if (hasUnsafeProtocol(value, new Set(['http', 'https', 'blob']))) return null
  return resolveImageSrc(value)
}

export function renderMarkdown(text) {
  if (!text) return ''
  let html = String(text)
  const codeBlocks = []

  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const highlighted = highlightCode(code.trimEnd(), lang)
    const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''
    const block = `<pre data-lang="${escapeAttr(lang)}">${langLabel}<button class="code-copy-btn" data-copy-btn>Copy</button><code>${highlighted}</code></pre>`
    return `\x00MDBLOCK${codeBlocks.push(block) - 1}\x00`
  })

  const lines = html.split('\n')
  const result = []
  let inList = false
  let listType = ''
  let inTable = false
  let tableRows = []
  const closeList = () => {
    if (!inList) return
    result.push(`</${listType}>`)
    inList = false
    listType = ''
  }
  const flushTable = () => {
    if (!inTable) return
    result.push(renderTable(tableRows))
    inTable = false
    tableRows = []
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    const codeBlockMatch = line.match(/^\x00MDBLOCK(\d+)\x00$/)
    if (codeBlockMatch) {
      flushTable()
      closeList()
      result.push(codeBlocks[Number(codeBlockMatch[1])] || '')
      continue
    }

    // 表格检测：表头分隔行 (|---|...|)
    const isTableSeparator = /^\s*\|[\s\-:|]+\|\s*$/.test(line) || 
                             /^\s*[\-:]+(\s*\|\s*[\-:]+)+\s*$/.test(line)
    
    // 检测是否可能是表格行
    const isTableRow = /^\s*\|.*\|\s*$/.test(line) || 
                       /^\s*[^\|]+\s*\|\s*[^\|]+/.test(line)
    
    // 如果在表格中，继续收集行
    if (inTable) {
      if (isTableRow && line.trim() !== '') {
        tableRows.push(line)
        continue
      } else {
        // 表格结束，渲染表格
        flushTable()
      }
    }
    
    // 检测表格开始：当前行是表格行，且下一行是分隔行
    if (!inTable && isTableRow && i + 1 < lines.length) {
      const nextLine = lines[i + 1]
      if (/^\s*\|[\s\-:|]+\|\s*$/.test(nextLine) || 
          /^\s*[\-:]+(\s*\|\s*[\-:]+)+\s*$/.test(nextLine)) {
        closeList()
        inTable = true
        tableRows.push(line)
        continue
      }
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushTable()
      closeList()
      const level = headingMatch[1].length
      result.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`)
      continue
    }

    // 分割线
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushTable()
      closeList()
      result.push('<hr>')
      continue
    }

    // 引用块：连续引用行合并为一个块，避免流程文档被切成多个引用框。
    const quoteMatch = line.match(/^\s{0,3}>\s?(.*)$/)
    if (quoteMatch) {
      flushTable()
      closeList()
      const quoteLines = [quoteMatch[1]]
      while (i + 1 < lines.length) {
        const nextQuote = lines[i + 1].match(/^\s{0,3}>\s?(.*)$/)
        if (!nextQuote) break
        quoteLines.push(nextQuote[1])
        i += 1
      }
      result.push(renderBlockquote(quoteLines))
      continue
    }

    // 任务列表
    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/)
    if (taskMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(`</${listType}>`)
        result.push('<ul>'); inList = true; listType = 'ul'
      }
      const checked = taskMatch[2].toLowerCase() === 'x'
      const depthClass = getListDepthClass(taskMatch[1])
      result.push(`<li class="task-list-item${depthClass}"><input class="task-list-checkbox" type="checkbox" disabled${checked ? ' checked' : ''}> ${inlineFormat(taskMatch[3])}</li>`)
      continue
    }

    // 无序列表
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/)
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(`</${listType}>`)
        result.push('<ul>'); inList = true; listType = 'ul'
      }
      const depthClass = getListDepthClass(ulMatch[1])
      result.push(`<li${depthClass ? ` class="${depthClass.trim()}"` : ''}>${inlineFormat(ulMatch[2])}</li>`)
      continue
    }

    // 有序列表
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/)
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(`</${listType}>`)
        result.push('<ol>'); inList = true; listType = 'ol'
      }
      const depthClass = getListDepthClass(olMatch[1])
      result.push(`<li${depthClass ? ` class="${depthClass.trim()}"` : ''}>${inlineFormat(olMatch[2])}</li>`)
      continue
    }

    closeList()
    if (line.trim() === '') { result.push(''); continue }
    result.push(`<p>${inlineFormat(line)}</p>`)
  }

  closeList()
  // 处理剩余的表格
  flushTable()
  let raw = result.join('\n')
  // DOMPurify 消毒，防止 XSS（仅浏览器环境，已预加载）
  if (_IS_BROWSER && DOMPurify?.sanitize && _purifyReady) {
    raw = DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ['p','br','strong','em','code','pre','button','span','h1','h2','h3','h4','h5','h6','hr','blockquote','ul','ol','li','table','tr','th','td','a','img','input','div'],
      ALLOWED_ATTR: ['class','type','disabled','checked','data-lang','href','target','rel','src','alt','loading','hidden','data-copy-btn'],
      ALLOW_DATA_ATTR: false,
    })
  }
  return raw
}

function getListDepthClass(indent = '') {
  const size = String(indent).replace(/\t/g, '  ').length
  const depth = Math.max(0, Math.min(4, Math.floor(size / 2)))
  return depth ? ` md-list-depth-${depth}` : ''
}

function renderBlockquote(lines) {
  const paragraphs = []
  let current = []
  const flushParagraph = () => {
    if (!current.length) return
    paragraphs.push(`<p>${current.map(part => inlineFormat(part)).join('<br>')}</p>`)
    current = []
  }

  for (const line of lines) {
    if (String(line).trim() === '') {
      flushParagraph()
      continue
    }
    current.push(line)
  }
  flushParagraph()

  return `<blockquote>${paragraphs.join('')}</blockquote>`
}

/**
 * 渲染 Markdown 表格
 * @param {string[]} rows - 表格行数组
 * @returns {string} HTML 表格
 */
function renderTable(rows) {
  if (!rows || rows.length < 2) return ''
  
  const table = ['<table>']
  let isHeaderRow = true
  let hasSeparator = false
  
  for (let i = 0; i < rows.length; i++) {
    let row = rows[i].trim()
    
    // 跳过空行
    if (!row) continue
    // 检测分隔行 (|---|...|)
    const isSeparator = /^\s*\|[\s\-:|]+\|\s*$/.test(row) || 
                        /^\s*[\-:]+(\s*\|\s*[\-:]+)+\s*$/.test(row)
    if (isSeparator) {
      hasSeparator = true
      continue
    }
    
    // 解析单元格
    let cells = []
    if (row.startsWith('|') && row.endsWith('|')) {
      // 标准格式: | cell1 | cell2 |
      cells = row.slice(1, -1).split('|')
    } else {
      // 简化格式: cell1 | cell2
      cells = row.split('|')
    }
    // 清理单元格内容
    cells = cells.map(cell => inlineFormat(cell.trim()))
    if (cells.length === 0) continue
    
    // 渲染行
    const tag = isHeaderRow && !hasSeparator && i === 0 ? 'th' : 'td'
    table.push('  <tr>')
    cells.forEach(cell => {
      table.push(`    <${tag}>${cell}</${tag}>`)
    })
    table.push('  </tr>')
    
    // 第一行后切换到数据行（如果有分隔行）
    if (hasSeparator && i === 0) {
      isHeaderRow = false
    }
  }
  
  table.push('</table>')
  return table.join('\n')
}

function inlineFormat(text) {
  const tokens = []
  const saveToken = (html) => {
    const index = tokens.push(html) - 1
    return `\x00MD${index}\x00`
  }

  let html = String(text ?? '')
    .replace(/`([^`\n]+)`/g, (_, code) => saveToken(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(((?:[^()\s]|\\[()]|\([^()\s]*\))+)\)/g, (_, alt, src) => {
      const safeSrc = safeImageSrc(src)
      if (!safeSrc) {
        return saveToken('<span class="msg-img-fallback">[图片已拦截]</span>')
      }
      const escapedSrc = escapeAttr(safeSrc).replace(/\\/g, '&#x5c;')
      const escapedRawSrc = escapeHtml(src)
      const fallback = `<span class="msg-img-fallback img-error-target" hidden>[图片无法加载: ${escapedRawSrc}]</span>`
      return saveToken(`<img src="${escapedSrc}" alt="${escapeAttr(alt)}" class="msg-img" loading="lazy" />${fallback}`)
    })
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\\[()]|\([^()\s]*\))+)\)/g, (_, label, url) => {
      const safe = safeLinkUrl(url)
      return saveToken(`<a href="${escapeAttr(safe)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`)
    })

  html = escapeHtml(html)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // 避免 (?<!\w) 负向后查找：旧版 Safari / 部分 WebView 会报 invalid group specifier name
    .replace(/(^|[^A-Za-z0-9_])_(.+?)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>')

  return html.replace(/\x00MD(\d+)\x00/g, (_, index) => tokens[Number(index)] || '')
}

if (_IS_BROWSER) {
  // 图片加载失败处理（使用事件委托替代内联 onerror）
  document.addEventListener('error', (e) => {
    const img = e.target.closest('img.msg-img')
    if (!img) {
      // 处理 skills 图标的多图兜底
      const iconImg = e.target.closest('[data-icon-fallback-icon]')
      if (iconImg) {
        const fallbacks = JSON.parse(iconImg.dataset.iconFallbacks || '[]')
        const next = fallbacks.shift()
        if (next) {
          iconImg.dataset.iconFallbacks = JSON.stringify(fallbacks)
          iconImg.src = next
        } else {
          iconImg.style.display = 'none'
        }
        return
      }
      return
    }
    img.style.display = 'none'
    const fallback = img.nextElementSibling
    if (fallback?.classList.contains('img-error-target')) {
      fallback.hidden = false
    }
  }, true) // 捕获阶段

  // 复制按钮（使用事件委托）
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-btn]')
    if (!btn) return
    const pre = btn.closest('pre')
    const code = pre?.querySelector('code')
    if (!code) return
    navigator.clipboard.writeText(code.innerText).then(() => {
      btn.textContent = '✓'
      setTimeout(() => { btn.textContent = 'Copy' }, 1500)
    }).catch(() => {
      btn.textContent = '✗'
      setTimeout(() => { btn.textContent = 'Copy' }, 1500)
    })
  })
}
