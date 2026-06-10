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

// Route → section + label mapping (for context bar)
const _routeContext = {
  '/dashboard':     ['sectionMonitor',    'dashboard'],
  '/assistant':     ['sectionMonitor',    'assistant'],
  '/chat':          ['sectionMonitor',    'chat'],
  '/route-map':     ['sectionMonitor',    'routeMap'],
  '/services':      ['sectionMonitor',    'services'],
  '/logs':          ['sectionMonitor',    'logs'],
  '/models':        ['sectionConfig',     'models'],
  '/agents':        ['sectionConfig',     'agents'],
  '/expert-teams':  ['sectionConfig',     'expertTeams'],
  '/gateway':       ['sectionConfig',     'gateway'],
  '/channels':      ['sectionConfig',     'channels'],
  '/communication': ['sectionConfig',     'communication'],
  '/security':      ['sectionConfig',     'security'],
  '/memory':        ['sectionData',       'memory'],
  '/dreaming':      ['sectionData',       'dreaming'],
  '/cron':          ['sectionData',       'cron'],
  '/usage':         ['sectionData',       'usage'],
  '/skills':        ['sectionExtension',  'skills'],
  '/connectors':    ['sectionExtension',  'connectors'],
  '/plugin-hub':    ['sectionExtension',  'pluginHub'],
  '/settings':      ['sectionSystem',     'settings'],
  '/chat-debug':    ['sectionSystem',     'checkRepair'],
  '/diagnose':      ['sectionSystem',     'checkRepair'],
  '/about':         ['sectionSystem',     'about'],
  '/setup':         ['',                  'setup'],
  '/glossary':      ['',                  'glossary'],
}

function updateContextBar(routePath) {
  const bar = document.getElementById('context-bar')
  if (!bar) return
  const ctx = _routeContext[routePath]
  if (!ctx) { bar.innerHTML = ''; return }
  const [sectionKey, labelKey] = ctx
  const sectionLabel = sectionKey ? t('sidebar.' + sectionKey) : ''
  const pageLabel = t('sidebar.' + labelKey)
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
      console.error('[router] 模块加载失败:', routePath, e)
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
    console.error('[router] 页面渲染失败:', routePath, e)
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
    item.classList.toggle('active', item.dataset.route === routePath)
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
  const name = hash.replace('/', '') || 'unknown'
  container.innerHTML = `
    <div class="page-loader">
      <div style="color:var(--error,#ef4444);margin-bottom:12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </div>
      <div class="page-loader-text" style="color:var(--text-primary)">${escHtml(t('common.pageLoadFailed'))}</div>
      <div style="color:var(--text-tertiary);font-size:12px;margin:8px 0 16px;max-width:400px;word-break:break-all">${escHtml(String(error?.message || error))}</div>
      <button onclick="location.hash='${hash}';location.reload()" style="padding:6px 20px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:13px">${escHtml(t('common.reloadRetry'))}</button>
    </div>
  `
}

function showNotFound(container, routePath) {
  container.innerHTML = `
    <div class="page-loader" style="text-align:center;padding:60px 20px">
      <div style="color:var(--text-3);margin-bottom:16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="56" height="56">
          <circle cx="12" cy="12" r="10"/>
          <path d="M16 16s-1.5-2-4-2-4 2-4 2"/>
          <line x1="9" y1="9" x2="9.01" y2="9"/>
          <line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
      </div>
      <div class="page-loader-text" style="color:var(--text-1);font-size:18px;margin-bottom:8px">${escHtml(t('common.pageNotFound') || '页面未找到')}</div>
      <div style="color:var(--text-3);font-size:13px;margin-bottom:24px">${escHtml(t('common.pageNotFoundDesc') || '该路由未注册')}: <code style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:12px">${escHtml(routePath)}</code></div>
      <button onclick="location.hash='${escHtml(_defaultRoute)}'" style="padding:8px 24px;border-radius:var(--radius-lg);border:1px solid var(--brand-muted);background:var(--brand-faint);color:var(--brand);cursor:pointer;font-size:14px;font-weight:500;transition:background var(--ease-fast)">${escHtml(t('common.backToHome') || '返回首页')}</button>
    </div>
  `
}


export function getCurrentRoute() {
  return window.location.hash.slice(1) || _defaultRoute
}

export function reloadCurrentRoute() {
  loadRoute()
}
