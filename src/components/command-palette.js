/**
 * Command Palette (Ctrl+K / Cmd+K)
 * 居中浮层，支持模糊搜索、键盘导航、命令执行
 */
import { t } from '../lib/i18n.js'
import { navigate } from '../router.js'
import { escapeHtml } from '../lib/utils.js'

const _commandIndex = []
const COMMAND_PALETTE_COMMANDS_KEY = '__clawpanelCommandPaletteCommands'
const COMMAND_FREQ_KEY = '__clawpanelCommandFreq'
let _overlay = null
let _input = null
let _resultsEl = null
let _liveRegion = null
let _selectedIndex = 0
let _filteredItems = []
let _previousFocus = null
let _hydratedGlobalCommands = null
let _globalCommandIds = new Set()
let _currentQuery = ''

/** 读取命令使用频率 */
function getFreqMap() {
  try {
    const raw = localStorage.getItem(COMMAND_FREQ_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

/** 保存命令使用频率 */
function recordUsage(cmdId) {
  if (!cmdId) return
  try {
    const map = getFreqMap()
    map[cmdId] = (map[cmdId] || 0) + 1
    localStorage.setItem(COMMAND_FREQ_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

function hydrateGlobalCommands() {
  if (typeof window === 'undefined') return
  const commands = window[COMMAND_PALETTE_COMMANDS_KEY]
  if (!Array.isArray(commands) || commands === _hydratedGlobalCommands) return

  if (_globalCommandIds.size) {
    for (let i = _commandIndex.length - 1; i >= 0; i--) {
      if (_globalCommandIds.has(_commandIndex[i]?.id)) _commandIndex.splice(i, 1)
    }
  }

  _hydratedGlobalCommands = commands
  _globalCommandIds = new Set(commands.map(cmd => cmd?.id).filter(Boolean))
  if (commands.length) {
    const existingIds = new Set(_commandIndex.map(cmd => cmd?.id).filter(Boolean))
    _commandIndex.push(...commands.filter(cmd => !cmd?.id || !existingIds.has(cmd.id)))
  }
}

/** 注册单个命令 */
export function registerCommand(cmd) {
  hydrateGlobalCommands()
  _commandIndex.push(cmd)
}

/** 批量注册命令 */
export function registerCommands(cmds) {
  _commandIndex.push(...cmds)
}

/** 搜索匹配 */
export function searchCommands(query) {
  hydrateGlobalCommands()
  const q = query.toLowerCase().trim()
  _currentQuery = q
  if (!q) {
    // 无搜索时按使用频率排序
    const freq = getFreqMap()
    return _commandIndex.filter(c => !c.disabled).sort((a, b) => {
      const fa = a.id ? (freq[a.id] || 0) : 0
      const fb = b.id ? (freq[b.id] || 0) : 0
      return fb - fa
    })
  }
  return _commandIndex.filter(c => {
    if (c.disabled) return false
    const haystack = [c.label, c.hint || '', ...(c.keywords || [])].join(' ').toLowerCase()
    if (c.label.toLowerCase().startsWith(q)) return true
    if (haystack.includes(q)) return true
    const tokens = q.split(/\s+/)
    return tokens.every(t => haystack.includes(t))
  }).sort((a, b) => {
    const aPrefix = a.label.toLowerCase().startsWith(q) ? 0 : 1
    const bPrefix = b.label.toLowerCase().startsWith(q) ? 0 : 1
    if (aPrefix !== bPrefix) return aPrefix - bPrefix
    // 前缀相同时按频率排序
    const freq = getFreqMap()
    const fa = a.id ? (freq[a.id] || 0) : 0
    const fb = b.id ? (freq[b.id] || 0) : 0
    return fb - fa
  })
}

/** 高亮匹配文本 */
function highlightMatch(text, query) {
  if (!query) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${q})`, 'gi')
  return escaped.replace(regex, '<mark class="cp-highlight">$1</mark>')
}

/** 打开 Command Palette */
export function openPalette() {
  hydrateGlobalCommands()
  if (_overlay) return
  _previousFocus = document.activeElement
  _selectedIndex = 0

  // 创建遮罩层
  _overlay = document.createElement('div')
  _overlay.className = 'command-palette-overlay'
  _overlay.addEventListener('click', (e) => {
    if (e.target === _overlay) closePalette()
  })

  // 主容器
  const palette = document.createElement('div')
  palette.className = 'command-palette'
  palette.setAttribute('role', 'dialog')
  palette.setAttribute('aria-label', t('commandPalette.title') || '命令面板')

  // 搜索输入框
  _input = document.createElement('input')
  _input.className = 'command-palette-input'
  _input.type = 'text'
  _input.placeholder = t('commandPalette.placeholder') || '搜索命令...'
  _input.setAttribute('role', 'combobox')
  _input.setAttribute('aria-expanded', 'false')
  _input.setAttribute('aria-autocomplete', 'list')
  _input.setAttribute('aria-controls', 'command-palette-results')
  _input.addEventListener('input', () => {
    _selectedIndex = 0
    renderResults(searchCommands(_input.value))
  })
  _input.addEventListener('keydown', handleKeydown)
  palette.appendChild(_input)

  // 结果列表
  _resultsEl = document.createElement('div')
  _resultsEl.id = 'command-palette-results'
  _resultsEl.className = 'command-palette-results'
  _resultsEl.setAttribute('role', 'listbox')
  palette.appendChild(_resultsEl)

  // 键盘提示 footer
  const footer = document.createElement('div')
  footer.className = 'command-palette-footer'
  footer.innerHTML = `
    <span class="cp-footer-hint"><kbd>↑↓</kbd> ${escapeHtml(t('commandPalette.footerNavigate'))}</span>
    <span class="cp-footer-hint"><kbd>↵</kbd> ${escapeHtml(t('commandPalette.footerSelect'))}</span>
    <span class="cp-footer-hint"><kbd>Esc</kbd> ${escapeHtml(t('commandPalette.footerClose'))}</span>
  `
  palette.appendChild(footer)

  // 实时区域 — 播报搜索结果数量
  _liveRegion = document.createElement('div')
  _liveRegion.setAttribute('role', 'status')
  _liveRegion.setAttribute('aria-live', 'polite')
  _liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)'
  palette.appendChild(_liveRegion)

  _overlay.appendChild(palette)
  document.body.appendChild(_overlay)

  // 焦点陷阱
  _overlay.addEventListener('keydown', handleOverlayKeydown)

  // 渲染全部命令
  renderResults(searchCommands(''))
  _input.focus()
}

/** 关闭 Command Palette */
export function closePalette() {
  if (_overlay) {
    _overlay.removeEventListener('keydown', handleOverlayKeydown)
    _overlay.remove()
    _overlay = null
    _input = null
    _resultsEl = null
    _liveRegion = null
    if (_previousFocus && _previousFocus.focus) _previousFocus.focus()
    _previousFocus = null
  }
}

export function togglePalette() {
  if (_overlay) closePalette()
  else openPalette()
}

/** 焦点陷阱处理 */
function handleOverlayKeydown(e) {
  if (e.key !== 'Tab') return
  if (!_overlay) return

  const palette = _overlay.querySelector('.command-palette')
  const focusableEls = palette.querySelectorAll(
    'input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  const firstEl = focusableEls[0]
  const lastEl = focusableEls[focusableEls.length - 1]

  if (e.shiftKey) {
    if (document.activeElement === firstEl) {
      e.preventDefault()
      lastEl.focus()
    }
  } else {
    if (document.activeElement === lastEl) {
      e.preventDefault()
      firstEl.focus()
    }
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    _selectedIndex = Math.min(_selectedIndex + 1, _filteredItems.length - 1)
    updateSelection()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    _selectedIndex = Math.max(_selectedIndex - 1, 0)
    updateSelection()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (_filteredItems[_selectedIndex]) {
      executeCommand(_filteredItems[_selectedIndex])
    }
    return
  }
}

function renderResults(items) {
  _filteredItems = items
  if (!_resultsEl) return
  _resultsEl.innerHTML = ''

  // 更新 combobox aria-expanded
  if (_input) {
    _input.setAttribute('aria-expanded', items.length > 0 ? 'true' : 'false')
  }

  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'command-palette-empty'
    empty.textContent = t('commandPalette.noResults')
    _resultsEl.appendChild(empty)
    if (_input) _input.removeAttribute('aria-activedescendant')
    // 播报空结果
    if (_liveRegion) _liveRegion.textContent = t('commandPalette.noResults')
    return
  }

  // 播报结果数量
  if (_liveRegion) _liveRegion.textContent = t('commandPalette.resultCount', { count: items.length })

  // 按 category 分组
  const groups = {}
  items.forEach((item, idx) => {
    const cat = item.category || 'other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push({ ...item, _idx: idx })
  })

  const categoryLabels = {
    navigation: t('commandPalette.categoryNavigation'),
    engine: t('commandPalette.categoryEngine'),
    action: t('commandPalette.categoryAction'),
    settings: t('commandPalette.categorySettings'),
    other: ''
  }

  for (const [cat, catItems] of Object.entries(groups)) {
    if (categoryLabels[cat] !== undefined && categoryLabels[cat]) {
      const groupLabel = document.createElement('div')
      groupLabel.className = 'command-palette-group-label'
      groupLabel.textContent = categoryLabels[cat]
      _resultsEl.appendChild(groupLabel)
    }

    catItems.forEach(item => {
      const row = document.createElement('div')
      row.className = 'command-palette-item'
      row.setAttribute('role', 'option')
      row.setAttribute('id', `cp-option-${item._idx}`)
      row.setAttribute('aria-selected', item._idx === _selectedIndex ? 'true' : 'false')
      if (item._idx === _selectedIndex) row.classList.add('active')
      row.dataset.idx = item._idx

      const iconSpan = document.createElement('span')
      iconSpan.className = 'command-palette-item-icon'
      iconSpan.textContent = item.icon || ''
      row.appendChild(iconSpan)

      const labelSpan = document.createElement('span')
      labelSpan.className = 'command-palette-item-label'
      labelSpan.innerHTML = highlightMatch(item.label, _currentQuery)
      row.appendChild(labelSpan)

      if (item.hint) {
        const hintSpan = document.createElement('span')
        hintSpan.className = 'command-palette-item-hint'
        hintSpan.innerHTML = highlightMatch(item.hint, _currentQuery)
        row.appendChild(hintSpan)
      }

      if (item.shortcut) {
        const shortcutSpan = document.createElement('span')
        shortcutSpan.className = 'command-palette-item-shortcut'
        shortcutSpan.textContent = item.shortcut
        row.appendChild(shortcutSpan)
      }

      row.addEventListener('click', () => executeCommand(item))
      _resultsEl.appendChild(row)
    })
  }

  if (_input) _input.setAttribute('aria-activedescendant', `cp-option-${_selectedIndex}`)
}

function updateSelection() {
  if (!_resultsEl) return
  const items = _resultsEl.querySelectorAll('.command-palette-item')
  items.forEach((el, i) => {
    const isActive = parseInt(el.dataset.idx) === _selectedIndex
    el.classList.toggle('active', isActive)
    el.setAttribute('aria-selected', isActive ? 'true' : 'false')
  })
  // 更新 combobox aria-activedescendant
  if (_input) {
    _input.setAttribute('aria-activedescendant', `cp-option-${_selectedIndex}`)
  }
  // 滚动到可见区域
  const active = _resultsEl.querySelector('.command-palette-item.active')
  if (active) active.scrollIntoView({ block: 'nearest' })
}

function executeCommand(cmd) {
  recordUsage(cmd.id)
  closePalette()
  if (cmd && typeof cmd.execute === 'function') {
    try { cmd.execute() } catch (err) { console.error('Command execute error:', err) }
  }
}

/** 初始化：绑定全局快捷键 */
export function initCommandPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      togglePalette()
    }
  })
}
