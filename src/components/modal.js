/**
 * Modal 弹窗组件
 */

import { t } from '../lib/i18n.js'
import { escapeAttr } from '../lib/utils.js'

/** 焦点栈 — 支持嵌套 modal 时正确恢复焦点 */
const _focusStack = []
function pushFocus() { _focusStack.push(document.activeElement) }
function popFocus() { const el = _focusStack.pop(); if (el?.focus) el.focus() }

/** Body scroll lock — 防止 modal 打开时背景滚动 */
let _scrollLockCount = 0
let _scrollPosition = 0
function lockBodyScroll() {
  if (_scrollLockCount === 0) {
    _scrollPosition = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${_scrollPosition}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
  }
  _scrollLockCount++
}
function unlockBodyScroll() {
  _scrollLockCount = Math.max(0, _scrollLockCount - 1)
  if (_scrollLockCount === 0) {
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    document.body.style.overflow = ''
    window.scrollTo(0, _scrollPosition)
  }
}

/**
 * Focus trap — 将 Tab 键限制在 modal 内部
 * @param {HTMLElement} overlay
 * @param {HTMLElement} modalEl
 */
function trapFocus(overlay, modalEl) {
  const focusableSelectors = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return
    const focusables = [...modalEl.querySelectorAll(focusableSelectors)]
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  })
}


/**
 * 给 overlay 绑定"点击遮罩关闭"事件（带拖拽防误触）
 * 点击拖动内容（如滚动、选词）时不会误关闭弹窗
 * @param {HTMLElement} overlay
 * @param {Function} [onClose] 关闭时的回调（如 showConfirm 需要 resolve promise）
 */
function bindOverlayClose(overlay, onClose) {
  let pStart = null
  overlay.addEventListener('pointerdown', (e) => {
    pStart = e.target === overlay ? { x: e.clientX, y: e.clientY } : null
  })
  overlay.addEventListener('pointerup', (e) => {
    if (pStart && e.target === overlay) {
      const dx = e.clientX - pStart.x
      const dy = e.clientY - pStart.y
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        if (onClose) onClose()
        else overlay.remove()
      }
    }
    pStart = null
  })
}


/**
 * 自定义确认弹窗，替代原生 confirm()
 * Tauri WebView 不支持原生 confirm/alert，必须用自定义弹窗
 *
 * 入参 message 支持两种：
 *   1) string                                  —— 旧用法（向后兼容）
 *   2) { message, impact?, ...options }        —— 结构化致命操作确认：
 *        - message:     主问题（"删除 Agent 'main'？"）
 *        - impact:      影响列表 string[]，渲染成 ul（让小白看清楚删了会丢什么）
 *        - title/confirmText/cancelText/variant: 同 options 同名字段
 *
 * @param {string|object} message 确认消息或结构化对象
 * @param {object} [options]      旧版 options 字段（仍兼容）
 * @returns {Promise<boolean>}    用户选择确认返回 true，取消返回 false
 */
export function showConfirm(message, options = {}) {
  // 结构化入参：把对象字段合并到 options，message 取其 .message 字段
  let actualMessage = message
  let impactList = null
  if (message && typeof message === 'object') {
    actualMessage = message.message ?? ''
    impactList = Array.isArray(message.impact) ? message.impact.filter(Boolean) : null
    // 对象字段优先于 options 同名字段
    options = {
      title: message.title ?? options.title,
      confirmText: message.confirmText ?? options.confirmText,
      cancelText: message.cancelText ?? options.cancelText,
      variant: message.variant ?? options.variant,
    }
  }

  const title = options.title || t('common.confirmAction')
  const confirmText = options.confirmText || t('common.confirm')
  const cancelText = options.cancelText || t('common.cancel')
  const variant = options.variant === 'primary' ? 'btn-primary' : 'btn-danger'

  const impactHtml = impactList && impactList.length
    ? `<ul class="modal-impact-list">${impactList.map(i => `<li>${escapeAttr(i)}</li>`).join('')}</ul>`
    : ''

  return new Promise((resolve) => {
    pushFocus()
    lockBodyScroll()
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    const modalId = 'modal-' + Date.now()
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title" style="max-width:420px">
        <div class="modal-title" id="${modalId}-title">${escapeAttr(title)}</div>
        <div class="modal-body" style="font-size:var(--text-sm);color:var(--text-secondary);white-space:pre-wrap;line-height:1.6">${escapeAttr(actualMessage)}</div>
        ${impactHtml}
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" data-action="cancel">${escapeAttr(cancelText)}</button>
          <button class="btn ${variant} btn-sm" data-action="confirm">${escapeAttr(confirmText)}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const modalEl = overlay.querySelector('.modal')
    trapFocus(overlay, modalEl)

    const close = (result) => {
      overlay.remove()
      unlockBodyScroll()
      popFocus()
      resolve(result)
    }

    bindOverlayClose(overlay, () => close(false))
    overlay.querySelector('[data-action="cancel"]').onclick = () => close(false)
    overlay.querySelector('[data-action="confirm"]').onclick = () => close(true)
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(true) }
      else if (e.key === 'Escape') close(false)
    })
    // 聚焦取消按钮（致命操作默认不要默认聚焦确认）
    overlay.querySelector('[data-action="cancel"]').focus()
  })
}

export function showModal({ title, fields, onConfirm }) {
  pushFocus()
  lockBodyScroll()
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const modalId = 'modal-' + Date.now()

  const fieldHtml = fields.map(f => {
    if (f.type === 'checkbox') {
      return `
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer" for="modal-field-${f.name}">
            <input type="checkbox" id="modal-field-${f.name}" data-name="${f.name}" ${f.value ? 'checked' : ''}>
            <span class="form-label" style="margin:0">${f.label}</span>
          </label>
          ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
        </div>`
    }
    if (f.type === 'select') {
      return `
        <div class="form-group">
          <label class="form-label" for="modal-field-${f.name}">${f.label}</label>
          <select class="form-input" id="modal-field-${f.name}" data-name="${f.name}">
            ${f.options.map(o => `<option value="${o.value}" ${o.value === f.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
        </div>`
    }
    return `
      <div class="form-group">
        <label class="form-label" for="modal-field-${f.name}">${f.label}</label>
        <input class="form-input" id="modal-field-${f.name}" data-name="${f.name}" value="${escapeAttr(f.value)}" placeholder="${escapeAttr(f.placeholder)}"${f.readonly ? ' readonly style="opacity:0.6;cursor:not-allowed"' : ''}>
        ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
      </div>`
  }).join('')

  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
      <div class="modal-title" id="${modalId}-title">${title}</div>
      ${fieldHtml}
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">${t('common.cancel')}</button>
        <button class="btn btn-primary btn-sm" data-action="confirm">${t('common.confirm')}</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  const modalEl = overlay.querySelector('.modal')
  trapFocus(overlay, modalEl)

  // 点击遮罩关闭（带拖拽防误触）
  bindOverlayClose(overlay, () => {
    document.removeEventListener('keydown', _docEscHandler)
    overlay.remove()
    unlockBodyScroll()
    popFocus()
  })

  overlay.querySelector('[data-action="cancel"]').onclick = () => {
    overlay.remove()
    unlockBodyScroll()
    popFocus()
  }

  overlay.querySelector('[data-action="confirm"]').onclick = () => {
    const result = {}
    overlay.querySelectorAll('[data-name]').forEach(el => {
      if (el.type === 'checkbox') {
        result[el.dataset.name] = el.checked
      } else {
        result[el.dataset.name] = el.value
      }
    })
    // 先调用回调，再移除 overlay，避免嵌套对话框时序问题
    const callback = onConfirm
    setTimeout(() => {
      document.removeEventListener('keydown', _docEscHandler)
      overlay.remove()
      unlockBodyScroll()
      popFocus()
    }, 0)
    callback(result)
  }

  // 键盘事件：Enter 确认，Escape 关闭（文档级监听，确保 ESC 始终可用）
  const _docEscHandler = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      overlay.querySelector('[data-action="confirm"]')?.click()
    } else if (e.key === 'Escape') {
      document.removeEventListener('keydown', _docEscHandler)
      overlay.remove()
      unlockBodyScroll()
      popFocus()
    }
  }
  document.addEventListener('keydown', _docEscHandler)

  // 自动聚焦第一个输入框
  const firstInput = overlay.querySelector('input, select')
  if (firstInput) firstInput.focus()
}

/**
 * 通用内容弹窗 — 支持自定义 HTML 和按钮
 * @param {{ title, content, buttons, width }} opts
 *   buttons: [{ label, className, id }]
 * @returns {HTMLElement} overlay 元素（带 .close() 方法）
 */
export function showContentModal({ title, content, buttons = [], width = 480 }) {
  pushFocus()
  lockBodyScroll()
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const modalId = 'modal-' + Date.now()

  const btnsHtml = buttons.map(b =>
    `<button class="${b.className || 'btn btn-primary btn-sm'}" id="${b.id || ''}">${b.label}</button>`
  ).join('')

  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title" style="max-width:${width}px">
      <div class="modal-title" id="${modalId}-title">${title}</div>
      <div class="modal-content-body">${content}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">${t('common.cancel')}</button>
        ${btnsHtml}
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  const modalEl = overlay.querySelector('.modal')
  trapFocus(overlay, modalEl)

  overlay.close = () => {
    overlay.remove()
    unlockBodyScroll()
    popFocus()
  }

  bindOverlayClose(overlay)
  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.close()
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') overlay.close()
  })

  // 自动聚焦第一个输入框或按钮
  const firstInput = overlay.querySelector('input, textarea, select')
  if (firstInput) firstInput.focus()

  return overlay
}

/**
 * 升级进度弹窗 — 带进度条和实时日志
 * @returns {{ appendLog, setProgress, setDone, setError, destroy }}
 */
export function showUpgradeModal(title) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay upgrade-modal-overlay'
  const modalId = 'modal-' + Date.now()
  overlay.innerHTML = `
    <div class="modal upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title" style="max-width:520px">
      <div class="modal-title" id="${modalId}-title">${escapeAttr(title || t('common.upgradeOpenClaw'))}</div>
      <div class="upgrade-progress-wrap">
        <div class="upgrade-progress-bar" aria-hidden="true"><div class="upgrade-progress-fill" style="width:0%"></div></div>
        <div class="upgrade-progress-text" role="status" aria-live="polite">${t('common.preparing')}</div>
      </div>
      <div class="upgrade-log-box" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-action="close">${t('common.close')}</button>
      </div>
    </div>
  `

  const fill = overlay.querySelector('.upgrade-progress-fill')
  const text = overlay.querySelector('.upgrade-progress-text')
  const logBox = overlay.querySelector('.upgrade-log-box')
  const closeBtn = overlay.querySelector('[data-action="close"]')
  const modalEl = overlay.querySelector('.modal')
  const _logLines = []

  let _onClose = null
  let _finished = false
  let _taskBar = null
  let _progressLabels = null
  let _closed = false
  let _removing = false
  let _modalSessionActive = false

  function beginModalSession() {
    pushFocus()
    lockBodyScroll()
    _modalSessionActive = true
  }

  function endModalSession() {
    if (!_modalSessionActive) return
    unlockBodyScroll()
    popFocus()
    _modalSessionActive = false
  }

  beginModalSession()
  document.body.appendChild(overlay)
  trapFocus(overlay, modalEl)
  bindOverlayClose(overlay, () => closeModal())
  requestAnimationFrame(() => closeBtn?.focus())

  // 重新打开弹窗（从任务状态栏点击时）
  function reopenModal() {
    if (!_closed) return
    _closed = false
    _removing = false
    overlay.style.opacity = ''
    overlay.style.transform = ''
    overlay.style.transition = ''
    if (_taskBar) { _taskBar.remove(); _taskBar = null }
    beginModalSession()
    document.body.appendChild(overlay)
    requestAnimationFrame(() => closeBtn?.focus())
  }

  // 关闭弹窗：未完成时显示任务状态栏
  function closeModal() {
    if (_closed || _removing) return
    _removing = true
    overlay.style.opacity = '0'
    overlay.style.transform = 'translateY(8px)'
    overlay.style.transition = 'opacity 200ms ease, transform 250ms var(--ease-out)'

    const finishClose = () => {
      if (!_removing) return
      _removing = false
      _closed = true
      overlay.removeEventListener('transitionend', finishClose)
      overlay.remove()
      endModalSession()
      if (!_finished) {
        showTaskBar()
        _taskBar?.querySelector('.upgrade-task-bar-open')?.focus?.()
      } else {
        if (_taskBar) { _taskBar.remove(); _taskBar = null }
        setTimeout(() => _onClose?.(), 0)
      }
    }

    overlay.addEventListener('transitionend', finishClose, { once: true })
    // Fallback: force remove after 350ms if transitionend doesn't fire
    setTimeout(finishClose, 400)
  }

  // 全局任务状态栏：关闭弹窗后显示在页面顶部
  function showTaskBar() {
    if (_taskBar) return
    _taskBar = document.createElement('div')
    _taskBar.className = 'upgrade-task-bar'
    _taskBar.setAttribute('role', 'status')
    _taskBar.setAttribute('aria-live', 'polite')
    _taskBar.innerHTML = `
      <span class="upgrade-task-bar-text">${text.textContent}</span>
      <button class="btn btn-sm upgrade-task-bar-open" type="button">${t('common.viewDetails')}</button>
      <button class="btn btn-sm btn-ghost upgrade-task-bar-dismiss" type="button" aria-label="${t('common.close')}">×</button>
    `
    _taskBar.querySelector('.upgrade-task-bar-open').onclick = reopenModal
    _taskBar.querySelector('.upgrade-task-bar-dismiss').onclick = () => { _taskBar.remove(); _taskBar = null }
    document.body.appendChild(_taskBar)
  }

  function updateTaskBar(statusText) {
    if (_taskBar) {
      const span = _taskBar.querySelector('.upgrade-task-bar-text')
      if (span) span.textContent = statusText
    }
  }

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    closeModal()
  })
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal()
  })

  return {
    appendLog(line) {
      _logLines.push(line)
      const div = document.createElement('div')
      div.textContent = line
      logBox.appendChild(div)
      logBox.scrollTop = logBox.scrollHeight
    },
    appendHtmlLog(line) {
      _logLines.push(line)
      const div = document.createElement('div')
      div.innerHTML = line
      logBox.appendChild(div)
      logBox.scrollTop = logBox.scrollHeight
    },
    getLogText() { return _logLines.join('\n') },
    setProgressLabels(labels) { _progressLabels = labels },
    setProgress(pct) {
      fill.style.width = pct + '%'
      const labels = _progressLabels || {}
      let statusText
      if (pct >= 100) statusText = labels.done || t('common.completed')
      else if (pct >= 75) statusText = labels.installing || t('common.installingProgress')
      else if (pct >= 30) statusText = labels.downloading || t('common.downloadingDependencies')
      else statusText = labels.preparing || t('common.preparing')
      text.textContent = statusText
      updateTaskBar(statusText)
    },
    setDone(msg) {
      _finished = true
      text.textContent = msg || t('common.upgradeCompleted')
      fill.style.width = '100%'
      fill.classList.add('done')
      if (_taskBar) { _taskBar.remove(); _taskBar = null }
      closeBtn.focus()
    },
    setError(msg) {
      _finished = true
      text.textContent = msg || t('common.upgradeFailed')
      fill.classList.add('error')
      if (_taskBar) {
        const span = _taskBar.querySelector('.upgrade-task-bar-text')
        if (span) { span.textContent = msg || t('common.upgradeFailed'); span.style.color = 'var(--error)' }
      }
      closeBtn.focus()
    },
    setCloseText(label) {
      if (label) closeBtn.textContent = label
    },
    onClose(fn) { _onClose = fn },
    destroy() {
      _removing = false
      overlay.remove()
      if (_modalSessionActive) endModalSession()
      _closed = true
      if (_taskBar) { _taskBar.remove(); _taskBar = null }
      _onClose?.()
    },
  }
}
