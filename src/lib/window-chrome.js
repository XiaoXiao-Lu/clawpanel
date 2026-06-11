import { icon } from './icons.js'
import { isTauriRuntime } from './tauri-api.js'
import { t } from './i18n.js'
import { devLog } from './logger.js'

let _windowChromeReady = false

async function getAppWindow() {
  if (!isTauriRuntime()) return null
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return getCurrentWindow()
  } catch (_) {
    return null
  }
}

export function initDesktopWindowChrome() {
  if (_windowChromeReady || !isTauriRuntime()) return
  _windowChromeReady = true

  document.body.classList.add('has-desktop-chrome')

  const titlebar = document.createElement('div')
  titlebar.className = 'desktop-titlebar'
  titlebar.setAttribute('data-tauri-drag-region', '')
  titlebar.innerHTML = `
    <div class="desktop-titlebar-brand" data-tauri-drag-region>
      <span class="desktop-titlebar-mark">${icon('zap', 13)}</span>
      <span data-tauri-drag-region>ClawPanel</span>
    </div>
    <div class="desktop-titlebar-drag" data-tauri-drag-region></div>
    <div class="desktop-titlebar-actions">
      <button class="desktop-window-btn" type="button" data-window-action="minimize" aria-label="${t('common.minimize')}" title="${t('common.minimize')}">
        <span></span>
      </button>
      <button class="desktop-window-btn" type="button" data-window-action="toggle-maximize" aria-label="${t('common.maximize')}" title="${t('common.maximize')}">
        <i></i>
      </button>
      <button class="desktop-window-btn desktop-window-btn-close" type="button" data-window-action="close" aria-label="${t('common.close')}" title="${t('common.close')}">
        ${icon('x', 13)}
      </button>
    </div>
  `
  document.body.prepend(titlebar)

  const runWindowAction = async (action) => {
    const win = await getAppWindow()
    if (!win) return
    if (action === 'minimize') await win.minimize()
    else if (action === 'toggle-maximize') await win.toggleMaximize()
    else if (action === 'close') await win.close()
  }

  titlebar.querySelectorAll('[data-window-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      runWindowAction(btn.dataset.windowAction).catch(err => {
        console.warn('[window-chrome] action failed:', err)
      })
    })
  })

  titlebar.querySelector('.desktop-titlebar-drag')?.addEventListener('dblclick', () => {
    runWindowAction('toggle-maximize').catch(() => {})
  })

  // 确保标题栏按钮在 Tauri 加载完成后可用
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
    devLog('[window-chrome] Tauri detected, window controls active')
  }
}
