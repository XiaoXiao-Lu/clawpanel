/**
 * 日志查看页面
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { t } from '../lib/i18n.js'
import { escapeHtml } from '../lib/utils.js'

const LOG_TABS = [
  { key: 'gateway', label: () => t('logs.tabGateway') },
  { key: 'gateway-err', label: () => t('logs.tabGatewayErr') },
  { key: 'guardian', label: () => t('logs.tabGuardian') },
  { key: 'guardian-backup', label: () => t('logs.tabBackup') },
  { key: 'config-audit', label: () => t('logs.tabAudit') },
]

let _searchTimer = null

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('logs.title')}</h1>
      <p class="page-desc">${t('logs.desc')}</p>
    </div>
    <div class="tab-bar">
      ${LOG_TABS.map((item, i) => `<div class="tab${i === 0 ? ' active' : ''}" data-tab="${item.key}">${item.label()}</div>`).join('')}
    </div>
    <div class="log-toolbar">
      <input type="text" class="form-input" id="log-search" placeholder="${t('logs.searchPlaceholder')}" style="max-width:300px">
      <button class="btn btn-secondary btn-sm" id="btn-refresh">${t('logs.refresh')}</button>
      <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);color:var(--text-secondary)">
        <input type="checkbox" id="log-autoscroll" checked> ${t('logs.autoScroll')}
      </label>
    </div>
    <div class="log-viewer" id="log-content" style="height:calc(100vh - 280px)"><div class="stat-card loading-placeholder" style="height:16px;margin:8px 0"></div><div class="stat-card loading-placeholder" style="height:16px;margin:8px 0"></div><div class="stat-card loading-placeholder" style="height:16px;margin:8px 0"></div><div class="stat-card loading-placeholder" style="height:16px;margin:8px 0"></div></div>
  `

  let currentTab = 'gateway'

  // Tab 切换
  page.querySelectorAll('.tab').forEach(tab => {
    tab.setAttribute('role', 'tab')
    tab.setAttribute('tabindex', '0')
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.currentTarget.click()
      }
    })
    tab.onclick = () => {
      page.querySelectorAll('.tab').forEach(el => el.classList.remove('active'))
      tab.classList.add('active')
      currentTab = tab.dataset.tab
      page.querySelector('#log-search').value = ''
      loadLog(page, currentTab)
    }
  })

  // 搜索
  page.querySelector('#log-search').addEventListener('input', (e) => {
    clearTimeout(_searchTimer)
    _searchTimer = setTimeout(() => {
      if (e.target.value.trim()) {
        searchLog(page, currentTab, e.target.value.trim())
      } else {
        loadLog(page, currentTab)
      }
    }, 300)
  })

  // 刷新
  page.querySelector('#btn-refresh').onclick = () => {
    const query = page.querySelector('#log-search')?.value.trim()
    if (query) {
      searchLog(page, currentTab, query)
    } else {
      loadLog(page, currentTab)
    }
  }

  loadLog(page, currentTab)
  return page
}

export function cleanup() {
  clearTimeout(_searchTimer)
  _searchTimer = null
}

async function loadLog(page, logName) {
  const requestId = String(Date.now() + Math.random())
  page.dataset.logRequestId = requestId
  const el = page.querySelector('#log-content')
  const refreshBtn = page.querySelector('#btn-refresh')
  // 显示加载状态
  el.innerHTML = '<div class="log-loading"><div class="service-spinner"></div><span style="color:var(--text-tertiary);margin-left:8px">' + t('logs.loading') + '</span></div>'
  if (refreshBtn) { refreshBtn.classList.add('btn-loading'); refreshBtn.disabled = true }
  try {
    const content = await api.readLogTail(logName, 200)
    if (page.dataset.logRequestId !== requestId) return
    if (!content || !content.trim()) {
      el.innerHTML = '<div style="color:var(--text-tertiary)">' + t('logs.empty') + '</div>'
      return
    }
    const lines = content.trim().split('\n')
    el.innerHTML = lines.map(l => `<div class="log-line">${escapeHtml(l)}</div>`).join('')
    if (page.querySelector('#log-autoscroll')?.checked) {
      el.scrollTop = el.scrollHeight
    }
  } catch (e) {
    if (page.dataset.logRequestId !== requestId) return
    el.innerHTML = '<div style="color:var(--error);padding:12px">' + t('logs.loadFailed') + ': ' + e + '</div>'
    toast(humanizeError(e, t('logs.loadFailed')), 'error')
  } finally {
    if (page.dataset.logRequestId === requestId && refreshBtn) {
      refreshBtn.classList.remove('btn-loading')
      refreshBtn.disabled = false
    }
  }
}

async function searchLog(page, logName, query) {
  const requestId = String(Date.now() + Math.random())
  page.dataset.logRequestId = requestId
  const el = page.querySelector('#log-content')
  const refreshBtn = page.querySelector('#btn-refresh')
  if (refreshBtn) { refreshBtn.classList.add('btn-loading'); refreshBtn.disabled = true }
  try {
    const results = await api.searchLog(logName, query)
    if (page.dataset.logRequestId !== requestId) return
    if (!results || !results.length) {
      el.innerHTML = '<div style="color:var(--text-tertiary)">' + t('logs.noResults') + '</div>'
      return
    }
    el.innerHTML = results.map(l => `<div class="log-line">${highlightMatch(l, query)}</div>`).join('')
    if (page.querySelector('#log-autoscroll')?.checked) {
      el.scrollTop = el.scrollHeight
    }
  } catch (e) {
    if (page.dataset.logRequestId !== requestId) return
    el.innerHTML = '<div style="color:var(--error);padding:12px">' + t('logs.searchFailed') + ': ' + e + '</div>'
    toast(humanizeError(e, t('logs.searchFailed')), 'error')
  } finally {
    if (page.dataset.logRequestId === requestId && refreshBtn) {
      refreshBtn.classList.remove('btn-loading')
      refreshBtn.disabled = false
    }
  }
}

function highlightMatch(text, query) {
  const source = String(text)
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'gi')
  let html = ''
  let lastIndex = 0
  let match
  while ((match = re.exec(source)) !== null) {
    html += escapeHtml(source.slice(lastIndex, match.index))
    html += `<mark>${escapeHtml(match[0])}</mark>`
    lastIndex = match.index + match[0].length
    if (match[0].length === 0) re.lastIndex += 1
  }
  html += escapeHtml(source.slice(lastIndex))
  return html
}
