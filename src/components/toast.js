/**
 * Toast 通知组件
 *
 * 入参 message 支持两种：
 *   1) string                                          —— 原来的纯文本（向后兼容）
 *   2) { message, hint?, raw?, action? }               —— humanize-error.js 的友好错误对象：
 *        - message: 主行（用户视角）
 *        - hint:    副行小灰字（行动建议）
 *        - raw:     折叠在「技术详情」里的原始错误字符串
 *        - action:  { label, route?, handler? } 智能行动按钮，点击跳转或调 handler
 */
import { t } from '../lib/i18n.js'
import { navigate } from '../router.js'

let _container = null

function ensureContainer() {
  if (!_container) {
    _container = document.createElement('div')
    _container.className = 'toast-container'
    _container.setAttribute('aria-live', 'polite')
    _container.setAttribute('role', 'status')
    document.body.appendChild(_container)
  }
  return _container
}

function isStructuredError(v) {
  return v && typeof v === 'object' && typeof v.message === 'string'
}

export function toast(message, type = 'info', options = {}) {
  // 结构化错误对象需要展示「主行 + hint + 技术详情折叠」，duration 给长一些
  const structured = isStructuredError(message)
  const duration = options.duration || (structured && (message.hint || message.raw) ? 6000
    : (type === 'error' || type === 'warning') ? 8000 : 3000)
  const action = options.action // 可选的操作按钮（DOM 元素）

  const container = ensureContainer()
  const el = document.createElement('div')
  el.className = `toast ${type}${structured ? ' toast-structured' : ''}`
  // 错误/警告用 assertive 播报，其他用 polite
  el.setAttribute('role', (type === 'error' || type === 'warning') ? 'alert' : 'status')

  if (structured) {
    const body = document.createElement('div')
    body.className = 'toast-body'

    const mainRow = document.createElement('div')
    mainRow.className = 'toast-main'
    mainRow.textContent = message.message
    body.appendChild(mainRow)

    if (message.hint) {
      const hintRow = document.createElement('div')
      hintRow.className = 'toast-hint'
      hintRow.textContent = message.hint
      body.appendChild(hintRow)
    }

    if (message.action && message.action.label) {
      const actionBtn = document.createElement('button')
      actionBtn.type = 'button'
      actionBtn.className = 'btn btn-xs btn-primary toast-action-btn'
      actionBtn.textContent = `${message.action.label} →`
      actionBtn.addEventListener('click', () => {
        try {
          if (typeof message.action.handler === 'function') message.action.handler()
          else if (message.action.route) navigate(message.action.route)
        } finally {
          el.remove()
        }
      })
      body.appendChild(actionBtn)
    }

    if (message.raw) {
      const detail = document.createElement('details')
      detail.className = 'toast-raw'
      const summary = document.createElement('summary')
      summary.textContent = t('common.errorRawLabel')
      detail.appendChild(summary)
      const pre = document.createElement('pre')
      pre.textContent = message.raw
      detail.appendChild(pre)
      body.appendChild(detail)
    }

    el.appendChild(body)
  } else {
    const textSpan = document.createElement('span')
    // SECURITY: options.html=true bypasses XSS protection — caller MUST ensure message is trusted
    if (options.html) {
      textSpan.innerHTML = message
    } else {
      textSpan.textContent = message
    }
    el.appendChild(textSpan)
  }

  // 如果有操作按钮，添加到 toast 中
  if (action instanceof HTMLElement) {
    el.appendChild(action)
  }

  // 添加关闭按钮
  const closeBtn = document.createElement('button')
  closeBtn.className = 'toast-close'
  closeBtn.innerHTML = '<span aria-hidden="true">&times;</span>'
  closeBtn.setAttribute('aria-label', t('common.close'))
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    clearTimeout(autoRemoveTimer)
    el.style.opacity = '0'
    el.style.transform = 'translateX(20px)'
    el.style.transition = 'all 250ms ease'
    setTimeout(() => el.remove(), 250)
  })
  el.appendChild(closeBtn)

  container.appendChild(el)

  // 悬停暂停自动消失
  let _remaining = duration
  let _lastStart = Date.now()
  let _paused = false

  function startTimer() {
    _lastStart = Date.now()
    return setTimeout(() => {
      el.style.opacity = '0'
      el.style.transform = 'translateX(20px)'
      el.style.transition = 'all 250ms ease'
      setTimeout(() => el.remove(), 250)
    }, _remaining)
  }

  el.addEventListener('mouseenter', () => {
    if (!_paused) {
      _remaining -= (Date.now() - _lastStart)
      clearTimeout(autoRemoveTimer)
      _paused = true
    }
  })
  el.addEventListener('mouseleave', () => {
    if (_paused) {
      _paused = false
      autoRemoveTimer = startTimer()
    }
  })

  let autoRemoveTimer = startTimer()
}
