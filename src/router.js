/**
 * 极简 hash 路由
 */
import { t } from './lib/i18n.js'
import { escapeHtml as escHtml } from './lib/utils.js'

const routes = {}
const _moduleCache = {}
let _contentEl = null
let _loadId = 0
let _currentCleanup = null
let _initialized = false

let _defaultRoute = '/dashboard'

// Route → section + label mapping (for context bar). Values may be full i18n keys.
const _routeContext = {
  '/engine-select': ['engine.choiceNav', 'engine.choiceNav'],
  '/dashboard':     ['sidebar.sectionMonitor',    'sidebar.dashboard'],
  '/assistant':     ['sidebar.sectionMonitor',    'sidebar.assistant'],
  '/chat':          ['sidebar.sectionMonitor',    'sidebar.chat'],
  '/route-map':     ['sidebar.sectionMonitor',    'sidebar.routeMap'],
  '/services':      ['sidebar.sectionMonitor',    'sidebar.services'],
  '/logs':          ['sidebar.sectionMonitor',    'sidebar.logs'],
  '/models':        ['sidebar.sectionConfig',     'sidebar.models'],
  '/agents':        ['sidebar.sectionConfig',     'sidebar.agents'],
  '/agent-detail':  ['sidebar.sectionConfig',     'sidebar.agents'],
  '/expert-teams':  ['sidebar.sectionConfig',     'sidebar.expertTeams'],
  '/gateway':       ['sidebar.sectionConfig',     'sidebar.gateway'],
  '/channels':      ['sidebar.sectionConfig',     'sidebar.channels'],
  '/communication': ['sidebar.sectionConfig',     'sidebar.communication'],
  '/notifications': ['sidebar.sectionConfig',     'sidebar.notifications'],
  '/security':      ['sidebar.sectionConfig',     'sidebar.security'],
  '/memory':        ['sidebar.sectionData',       'sidebar.memory'],
  '/dreaming':      ['sidebar.sectionData',       'sidebar.dreaming'],
  '/cron':          ['sidebar.sectionData',       'sidebar.cron'],
  '/usage':         ['sidebar.sectionData',       'sidebar.usage'],
  '/skills':        ['sidebar.sectionExtension',  'sidebar.skills'],
  '/connectors':    ['sidebar.sectionExtension',  'sidebar.connectors'],
  '/plugin-hub':    ['sidebar.sectionExtension',  'sidebar.pluginHub'],
  '/settings':      ['sidebar.sectionSystem',     'sidebar.settings'],
  '/chat-debug':    ['sidebar.sectionSystem',     'sidebar.checkRepair'],
  '/diagnose':      ['sidebar.sectionSystem',     'sidebar.checkRepair'],
  '/about':         ['sidebar.sectionSystem',     'sidebar.about'],
  '/setup':         ['',                          'sidebar.setup'],
  '/glossary':      ['',                          'sidebar.glossary'],

  '/h/setup':       ['',                          'sidebar.setup'],
  '/h/dashboard':   ['sidebar.sectionMonitor',    'sidebar.dashboard'],
  '/h/chat':        ['sidebar.sectionMonitor',    'sidebar.chat'],
  '/h/group-chat':  ['sidebar.sectionMonitor',    'engine.hermesGroupChatTitle'],
  '/h/sessions':    ['sidebar.sectionMonitor',    'sidebar.sessions'],
  '/h/logs':        ['sidebar.sectionMonitor',    'sidebar.logs'],
  '/h/usage':       ['sidebar.sectionMonitor',    'sidebar.usage'],
  '/h/skills':      ['sidebar.sectionManage',     'sidebar.skills'],
  '/h/memory':      ['sidebar.sectionManage',     'sidebar.memory'],
  '/h/cron':        ['sidebar.sectionManage',     'sidebar.cron'],
  '/h/profiles':    ['sidebar.sectionManage',     'engine.hermesProfilesTitle'],
  '/h/gateways':    ['sidebar.sectionManage',     'engine.hermesGatewaysTitle'],
  '/h/channels':    ['sidebar.sectionManage',     'engine.hermesChannelsTitle'],
  '/h/kanban':      ['sidebar.sectionManage',     'engine.hermesKanbanTitle'],
  '/h/oauth':       ['sidebar.sectionManage',     'engine.hermesOAuthTitle'],
  '/h/files':       ['sidebar.sectionManage',     'engine.hermesFilesTitle'],
  '/h/lazy-deps':   ['sidebar.sectionManage',     'hermesLazyDeps.title'],
  '/h/extensions':  ['sidebar.sectionManage',     'sidebar.extensions'],
  '/h/services':    ['sidebar.sectionManage',     'engine.hermesServicesTitle'],
  '/h/config':      ['sidebar.sectionManage',     'engine.hermesConfigTitle'],
  '/h/env':         ['sidebar.sectionManage',     'engine.servicesOpenEnv'],

  '/x/landing':     ['',                          'engine.xintianNavHome'],
}

function _contextLabel(key) {
  if (!key) return ''
  return t(key.includes('.') ? key : `sidebar.${key}`)
}

function updateContextBar(routePath) {
  const bar = document.getElementById('context-bar')
  if (!bar) return
  const ctx = _routeContext[routePath]
  if (!ctx) { bar.innerHTML = ''; return }
  const [sectionKey, labelKey] = ctx
  const sectionLabel = _contextLabel(sectionKey)
  const pageLabel = _contextLabel(labelKey)
  bar.innerHTML = sectionLabel
    ? `<span class="context-bar-path">${escHtml(sectionLabel)}</span><span class="context-bar-sep">/</span><span class="context-bar-title">${escHtml(pageLabel)}</span>`
    : `<span class="context-bar-title">${escHtml(pageLabel)}</span>`
}

export function registerRoute(path, loader) {
  routes[path] = loader
}

export function setDefaultRoute(path) {
  _defaultRoute = path
}

export function navigate(path) {
  const current = window.location.hash.slice(1)
  window.location.hash = path
  // 如果 hash 没有实际变化，手动触发加载（引擎切换等场景兜底）
  if (current === path) {
    reloadCurrentRoute()
  }
}

export function initRouter(contentEl) {
  _contentEl = contentEl
  if (!_initialized) {
    window.addEventListener('hashchange', () => loadRoute())
    _initialized = true
  }
  loadRoute()
}

async function loadRoute() {
  const hash = window.location.hash.slice(1) || _defaultRoute
  const routePath = hash.split('?')[0]
  const loader = routes[routePath]
  if (!loader || !_contentEl) {
    if (!loader && _contentEl && routePath) {
      showNotFound(_contentEl, routePath)
    }
    return
  }

  // 竞态防护：记录本次加载 ID
  const thisLoad = ++_loadId

  // 清理上一个页面
  if (_currentCleanup) {
    try { _currentCleanup() } catch (_) {}
    _currentCleanup = null
  }

  // 退出动画：给旧内容 120ms 淡出时间再替换
  if (_contentEl.children.length > 0 && !_contentEl.querySelector('.page-loader')) {
    const oldPage = _contentEl.firstElementChild
    if (oldPage && !oldPage.classList.contains('page-exit')) {
      oldPage.classList.add('page-exit')
      await new Promise(r => { oldPage.addEventListener('animationend', r, { once: true }); setTimeout(r, 150) })
    }
  }
  _contentEl.innerHTML = ''

  // 已缓存的模块：跳过 spinner，直接渲染
  let mod = _moduleCache[routePath]
  if (!mod) {
    _contentEl.innerHTML = ''
    // 仅首次加载显示 spinner
    const spinnerEl = document.createElement('div')
    spinnerEl.className = 'page-loader'
    spinnerEl.innerHTML = `
      <div class="page-loader-spinner"></div>
      <div class="page-loader-text">${escHtml(t('common.loading'))}</div>
    `
    _contentEl.appendChild(spinnerEl)

    try {
      mod = await retryLoad(loader, 3, 500)
    } catch (e) {
      console.error('[router] 模块加载失败:', routePath, e?.message ?? e)
      if (thisLoad === _loadId) showLoadError(_contentEl, routePath, e)
      return
    }
    _moduleCache[routePath] = mod
  } else {
    _contentEl.innerHTML = ''
  }

  // 如果加载期间路由又变了，丢弃本次结果
  if (thisLoad !== _loadId) return

  let page
  try {
    const renderFn = mod.render || mod.default
    page = renderFn ? await withTimeout(renderFn(), 15000, '页面渲染超时') : mod
  } catch (e) {
    console.error('[router] 页面渲染失败:', routePath, e?.message ?? e)
    // 渲染失败时清除缓存，下次重试时重新加载模块
    delete _moduleCache[routePath]
    if (thisLoad === _loadId) showLoadError(_contentEl, routePath, e)
    return
  }
  if (thisLoad !== _loadId) return

  // 插入页面内容（带进入动画）
  _contentEl.innerHTML = ''
  const wrapper = document.createElement('div')
  wrapper.style.animation = 'pageIn var(--ease-out) forwards'
  if (typeof page === 'string') {
    wrapper.innerHTML = page
  } else if (page instanceof HTMLElement) {
    wrapper.appendChild(page)
  }
  _contentEl.appendChild(wrapper)

  // 保存页面清理函数
  _currentCleanup = mod.cleanup || null

  // 更新侧边栏激活状态
  document.querySelectorAll('.nav-item').forEach(item => {
    const active = item.dataset.route === routePath
    item.classList.toggle('active', active)
    if (active) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  })

  // 更新上下文栏
  updateContextBar(routePath)
}

async function retryLoad(loader, maxRetries, delayMs) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await withTimeout(loader(), 15000, '模块加载超时')
    } catch (e) {
      const isNetworkError = /fetch|network|connection|ERR_/i.test(String(e?.message || e))
      if (i < maxRetries && isNetworkError) {
        console.warn(`[router] 模块加载失败，${delayMs}ms 后重试 (${i + 1}/${maxRetries})...`)
        await new Promise(r => setTimeout(r, delayMs))
        continue
      }
      throw e
    }
  }
}

function withTimeout(promise, ms, msg) {
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer)
  })
}

function showLoadError(container, hash, error) {
  container.innerHTML = `
    <div class="page-loader page-loader--state">
      <div class="state-card state-card--error" role="alert">
        <div class="state-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </div>
        <div class="state-card-title">${escHtml(t('common.pageLoadFailed'))}</div>
        <div class="state-card-desc">${escHtml(String(error?.message || error))}</div>
        <div class="state-card-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-router-action="reload">${escHtml(t('common.reloadRetry'))}</button>
        </div>
      </div>
    </div>
  `
  container.querySelector('[data-router-action="reload"]')?.addEventListener('click', () => {
    window.location.hash = hash
    window.location.reload()
  })
}

function showNotFound(container, routePath) {
  updateContextBar(routePath)
  container.innerHTML = `
    <div class="page-loader page-loader--state">
      <div class="state-card" role="status">
        <div class="state-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="56" height="56">
            <circle cx="12" cy="12" r="10"/>
            <path d="M16 16s-1.5-2-4-2-4 2-4 2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
        </div>
        <div class="state-card-title">${escHtml(t('common.pageNotFound'))}</div>
        <div class="state-card-desc">${escHtml(t('common.pageNotFoundDesc'))}: <code class="state-card-code">${escHtml(routePath)}</code></div>
        <div class="state-card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-router-action="home">${escHtml(t('common.backToHome'))}</button>
        </div>
      </div>
    </div>
  `
  container.querySelector('[data-router-action="home"]')?.addEventListener('click', () => {
    window.location.hash = _defaultRoute
  })
}


export function getCurrentRoute() {
  return window.location.hash.slice(1) || _defaultRoute
}

export function reloadCurrentRoute() {
  loadRoute()
}
