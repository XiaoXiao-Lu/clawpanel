/**
 * 侧边导航栏
 */
import { navigate, getCurrentRoute, reloadCurrentRoute } from '../router.js'
import { toggleTheme, getTheme } from '../lib/theme.js'
import { isOpenclawReady } from '../lib/app-state.js'
import { api } from '../lib/tauri-api.js'
import { toast } from './toast.js'
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
import { t, getLang, setLang, getAvailableLangs } from '../lib/i18n.js'
import { isFeatureAvailable } from '../lib/feature-gates.js'
import { getKernelSnapshot } from '../lib/kernel.js'
import { triggerKernelUpgrade } from '../lib/kernel-upgrade.js'
import { getActiveEngine, getActiveEngineId, listEngines, needsInitialEngineChoice, isEngineSetupDeferred, switchEngine, onEngineChange } from '../lib/engine-manager.js'
import { escapeHtml as _escSidebar } from '../lib/utils.js'
import { ICONS } from './sidebar-icons.js'
import { NAV_ITEMS_FULL, NAV_ITEMS_SETUP, NAV_ITEMS_ENGINE_SELECT, renderEngineSwitcher, renderKernelUpgradeHint, SS_DISMISSED_KERNEL_UPGRADE } from './sidebar-nav.js'
import { showConfirm } from './modal.js'

const SIDEBAR_CONNECTORS_I18N_KEY = 'sidebar.connectors'
const SIDEBAR_NAV_COMPAT_KEYS = { connectors: SIDEBAR_CONNECTORS_I18N_KEY }

// 当用户点 "暂时不升级" 时，本地会话内不再显示升级提示
const KERNEL_POLICY_TTL = 5 * 60 * 1000
let _kernelPolicyInfo = null
let _kernelPolicyFetchedAt = 0
let _kernelPolicyLoading = false





let _delegated = false
let _sidebarRendered = false  // 首次渲染标记
let _lastSidebarSignature = ''

function _getVisibleNavItems(engine) {
  const raw = needsInitialEngineChoice() || isEngineSetupDeferred()
    ? NAV_ITEMS_ENGINE_SELECT()
    : (engine ? engine.getNavItems() : (isOpenclawReady() ? NAV_ITEMS_FULL() : NAV_ITEMS_SETUP()))

  return raw.map(section => ({
    ...section,
    items: (section.items || []).filter(item => {
      if (item.gate && engine && !engine.isFeatureAvailable(item.gate)) return false
      if (item.gate && !engine && !isFeatureAvailable(item.gate)) return false
      return true
    }),
  })).filter(section => section.items.length > 0)
}

function _navSignature(navItems) {
  return JSON.stringify({
    lang: getLang(),
    engine: getActiveEngineId(),
    initialChoice: needsInitialEngineChoice(),
    setupDeferred: isEngineSetupDeferred(),
    items: navItems.map(section => ({
      section: section.section || '',
      items: section.items.map(item => ({ route: item.route, label: item.label, icon: item.icon || '' })),
    })),
  })
}


function _closeEngineDropdown() {
  const dd = document.getElementById('engine-dropdown')
  if (dd) dd.classList.remove('open')
  const btn = document.getElementById('btn-engine-toggle')
  if (btn) btn.setAttribute('aria-expanded', 'false')
}

function _toggleEngineDropdown() {
  const dd = document.getElementById('engine-dropdown')
  if (!dd) return
  const btn = document.getElementById('btn-engine-toggle')
  if (dd.classList.contains('open')) {
    dd.classList.remove('open')
    if (btn) btn.setAttribute('aria-expanded', 'false')
    return
  }
  dd.classList.add('open')
  if (btn) btn.setAttribute('aria-expanded', 'true')
}

const LS_SIDEBAR_COLLAPSED = 'clawpanel_sidebar_collapsed'

function _isDesktopSidebarCollapsed() {
  try { return localStorage.getItem(LS_SIDEBAR_COLLAPSED) === '1' } catch { return false }
}

function _setDesktopSidebarCollapsed(collapsed) {
  try { localStorage.setItem(LS_SIDEBAR_COLLAPSED, collapsed ? '1' : '0') } catch {}
  const sidebar = document.getElementById('sidebar')
  if (sidebar) {
    sidebar.classList.toggle('sidebar-collapsed', !!collapsed)
  }
  const btn = document.getElementById('btn-sidebar-collapse')
  if (btn) {
    btn.textContent = collapsed ? '»' : '«'
    btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false')
    btn.setAttribute('aria-label', t('sidebar.collapse'))
  }
}

export function renderSidebar(el) {
  const current = (getCurrentRoute() || '').split('?')[0]
  const engine = getActiveEngine()
  const navItems = _getVisibleNavItems(engine)
  const signature = _navSignature(navItems)

  // 增量更新路径：菜单结构未变化时只更新 active、徽章、主题等动态状态。
  if (_sidebarRendered && _lastSidebarSignature === signature && el.querySelector('.sidebar-nav')) {
    _updateSidebarIncremental(el, current)
    return
  }
  _sidebarRendered = true
  _lastSidebarSignature = signature

  const collapsed = _isDesktopSidebarCollapsed()
  let html = `
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <img src="/images/logo.png" alt="ClawPanel">
      </div>
      <span class="sidebar-title">ClawPanel</span>
      <button type="button" class="sidebar-collapse-btn" id="btn-sidebar-collapse" title="${t('sidebar.collapse')}" aria-label="${t('sidebar.collapse')}" aria-pressed="${collapsed ? 'true' : 'false'}">${collapsed ? '»' : '«'}</button>
      <button type="button" class="sidebar-close-btn" id="btn-sidebar-close" title="${t('sidebar.closeMenu')}" aria-label="${t('sidebar.closeMenu')}">&times;</button>
    </div>
    ${renderEngineSwitcher()}
    <div class="sidebar-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="sidebar-search-input" id="sidebar-search" type="search" placeholder="${t('sidebar.searchPlaceholder')}" autocomplete="off" aria-label="${t('sidebar.search')}">
    </div>
    <nav class="sidebar-nav" aria-label="${t('sidebar.navLabel')}">
  `

  let sectionIndex = 0
  for (const section of navItems) {
    const hasTitle = section.section && section.section.trim()
    const sectionId = `nav-section-${sectionIndex++}`
    html += `<div class="nav-section" data-section-id="${sectionId}">
      ${hasTitle ? `<button type="button" class="nav-section-title" data-toggle="${sectionId}" aria-expanded="true" aria-controls="${sectionId}">
        <span>${_escSidebar(section.section)}</span>
        <svg class="nav-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
      </button>` : ''}
      <div class="nav-section-items" id="${sectionId}">`

    for (const item of section.items) {
      const active = current === item.route ? ' active' : ''
      const ariaCurrent = current === item.route ? ' aria-current="page"' : ''
      const label = _escSidebar(item.label)
      const route = _escSidebar(item.route)
      const icon = _escSidebar(item.icon || '')
      const searchText = _escSidebar(`${item.label} ${item.route}`.toLowerCase())
      html += `<button type="button" class="nav-item${active}" data-route="${route}" data-nav-icon="${icon}" data-nav-label="${searchText}" aria-label="${label}" title="${label}"${ariaCurrent}>
        ${ICONS[item.icon] || ''}
        <span>${label}</span>
        <span class="nav-badge" aria-hidden="true"></span>
      </button>`
    }
    html += `</div></div>`
  }

  html += '</nav>'

  // 主题切换按钮
  const isDark = getTheme() === 'dark'
  const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
  const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'
  const bellIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'

  const langCode = getLang()
  const langs = getAvailableLangs()
  const currentLang = langs.find(l => l.code === langCode) || langs[0]
  const globeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>'
  const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>'

  const langOptions = langs.map(l => `
    <div class="lang-option${l.code === langCode ? ' active' : ''}" data-lang="${l.code}">
      <span class="lang-option-label">${l.label}</span>
      <span class="lang-option-code">${l.code}</span>
      ${l.code === langCode ? `<span class="lang-option-check">${checkIcon}</span>` : ''}
    </div>
  `).join('')

  // 内核可升级卡片（仅 openclaw 引擎、已连接、低于推荐版时显示）
  html += renderKernelUpgradeHint(_kernelPolicyInfo)

  html += `
    <footer class="sidebar-footer">
      <div class="sidebar-tools" role="toolbar" aria-label="${t('sidebar.tools') || 'Toolbar'}">
        <button class="sidebar-tool-btn site-message-trigger" type="button" title="${t('siteMessages.title')}" aria-label="${t('siteMessages.title')}">
          ${bellIcon}
          <span class="site-message-tool-badge" aria-hidden="true"></span>
        </button>
        <button class="sidebar-tool-btn" id="btn-theme-toggle" type="button" title="${isDark ? t('sidebar.themeLight') : t('sidebar.themeDark')}" aria-label="${isDark ? t('sidebar.themeLight') : t('sidebar.themeDark')}">
          ${isDark ? sunIcon : moonIcon}
        </button>
        <div class="lang-switcher" id="lang-switcher">
          <button class="sidebar-tool-btn lang-trigger" id="btn-lang-toggle" type="button" title="${currentLang.label}" aria-label="${currentLang.label}">
            ${globeIcon}
          </button>
          <div class="lang-dropdown" id="lang-dropdown">
            ${langs.length > 4 ? '<div class="lang-search-wrap"><input class="lang-search" id="lang-search" type="text" placeholder="Search..." autocomplete="off"></div>' : ''}
            <div class="lang-options" id="lang-options">${langOptions}</div>
          </div>
        </div>
      </div>
      <div class="sidebar-meta">
        <a href="https://claw.qt.cool" target="_blank" rel="noopener" class="sidebar-link">claw.qt.cool</a>
        <span class="sidebar-version">v${APP_VERSION}</span>
      </div>
      <div class="sidebar-shortcut-hint">
        <span class="sidebar-shortcut-key" tabindex="0" role="button" aria-label="${t('commandPalette.open')}" title="${t('commandPalette.open')} (Ctrl+K)" id="sidebar-cmdk-hint">Ctrl+K</span>
      </div>
    </div>
  `

  el.innerHTML = html
  window.dispatchEvent(new CustomEvent('clawpanel:site-message-launcher-mounted'))
  _ensureKernelPolicyInfo(el)

  // 应用折叠态（桌面端）
  _setDesktopSidebarCollapsed(collapsed)

  // 事件委托：只绑定一次，避免重复绑定
  if (!_delegated) {
    _delegated = true
    // ESC 键关闭移动端侧边栏
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const sidebar = document.getElementById('sidebar')
        if (sidebar && sidebar.classList.contains('sidebar-open')) {
          _closeMobileSidebar()
        }
      }
    })
    el.addEventListener('click', async (e) => {
      // 导航点击
      const navItem = e.target.closest('.nav-item[data-route]')
      if (navItem) {
        navigate(navItem.dataset.route)
        _closeMobileSidebar()
        return
      }
      // 分区折叠
      const sectionToggle = e.target.closest('[data-toggle]')
      if (sectionToggle) {
        const id = sectionToggle.dataset.toggle
        const items = el.querySelector(`#${id}`)
        const section = sectionToggle.closest('.nav-section')
        if (items) items.classList.toggle('collapsed')
        if (section) section.classList.toggle('section-collapsed')
        sectionToggle.setAttribute('aria-expanded', items && !items.classList.contains('collapsed'))
        return
      }
      // 移动端关闭按钮
      if (e.target.closest('#btn-sidebar-close')) {
        _closeMobileSidebar()
        return
      }
      // 侧边栏折叠
      const collapseBtn = e.target.closest('#btn-sidebar-collapse')
      if (collapseBtn) {
        _setDesktopSidebarCollapsed(!_isDesktopSidebarCollapsed())
        // 不需要整体重渲染
        return
      }
      // 主题切换
      const themeBtn = e.target.closest('#btn-theme-toggle')
      if (themeBtn) {
        toggleTheme(() => renderSidebar(el))
        return
      }
      // 快捷键提示：打开命令面板
      if (e.target.closest('#sidebar-cmdk-hint')) {
        const { openPalette } = await import('./command-palette.js')
        openPalette()
        return
      }
      // 内核升级提示卡：dismiss 按钮 → 仅当前会话不再显示
      const dismissBtn = e.target.closest('#btn-kernel-upgrade-dismiss')
      if (dismissBtn) {
        e.preventDefault()
        e.stopPropagation()
        try { sessionStorage.setItem(SS_DISMISSED_KERNEL_UPGRADE, '1') } catch {}
        const card = el.querySelector('#kernel-upgrade-hint')
        if (card) card.remove()
        return
      }
      // 内核升级提示卡：主体点击 → 触发一键升级流程
      const hintCard = e.target.closest('#kernel-upgrade-hint')
      if (hintCard) {
        triggerKernelUpgrade({
          onDone: () => {
            // 升级完成后清除会话内的 dismiss 标记并刷新 sidebar
            try { sessionStorage.removeItem(SS_DISMISSED_KERNEL_UPGRADE) } catch {}
            renderSidebar(el)
          },
        }).catch(err => {
          console.error('[sidebar] 内核升级触发失败:', err?.message ?? err)
        })
        return
      }
      // 语言切换器：打开/关闭下拉
      const langBtn = e.target.closest('#btn-lang-toggle')
      if (langBtn) {
        _toggleLangDropdown(el)
        return
      }
      // 语言选项点击
      const langOpt = e.target.closest('.lang-option[data-lang]')
      if (langOpt) {
        const code = langOpt.dataset.lang
        if (code !== getLang()) {
          setLang(code)
          renderSidebar(el)
          reloadCurrentRoute()
        } else {
          _closeLangDropdown()
        }
        return
      }
      // 引擎切换器：打开/关闭下拉
      const engineBtn = e.target.closest('#btn-engine-toggle')
      if (engineBtn) {
        _toggleEngineDropdown()
        return
      }
      // 引擎选项点击
      const engineOpt = e.target.closest('.engine-option[data-engine]')
      if (engineOpt) {
        const eid = engineOpt.dataset.engine
        _closeEngineDropdown()
        if (eid !== getActiveEngineId()) {
          // 确认弹窗
          const engines = listEngines()
          const targetEngine = engines.find(e => e.id === eid)
          const targetName = targetEngine?.name || eid
          const confirmed = await showConfirm({
            message: t('engine.switchConfirmMessage', { name: targetName }),
            title: t('engine.switchConfirmTitle'),
            confirmText: t('engine.switchConfirmAction'),
            cancelText: t('common.cancel'),
            variant: 'primary',
          })
          if (!confirmed) return
          engineOpt.style.opacity = '0.5'
          // 立即在内容区显示加载骨架，避免切换期间空白
          const contentEl = document.getElementById('content')
          if (contentEl) {
            contentEl.innerHTML = `<div class="page" style="padding:32px">
              <div class="skeleton-line" style="width:200px;height:28px;margin-bottom:24px"></div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px">
                ${[1,2,3].map(() => '<div class="card"><div class="card-body" style="padding:16px"><div class="skeleton-line" style="width:60%;height:12px;margin-bottom:10px"></div><div class="skeleton-line" style="width:80%;height:20px"></div></div></div>').join('')}
              </div>
              <div class="card"><div class="card-body" style="padding:20px"><div class="skeleton-line" style="width:40%;height:16px;margin-bottom:16px"></div><div class="skeleton-line" style="height:36px"></div></div></div>
            </div>`
          }
          switchEngine(eid).then(() => {
            toast(t('engine.switchedTo', { name: getActiveEngine()?.name || eid }), 'success')
            renderSidebar(el)
            // 跳转到新引擎的默认或 setup 页
            const eng = getActiveEngine()
            if (eng) {
              navigate(eng.isReady() ? eng.getDefaultRoute() : eng.getSetupRoute())
            }
          }).catch(err => {
            console.error('[sidebar] 切换引擎失败:', err?.message ?? err)
            toast(t('engine.switchFailed') || '引擎切换失败，请稍后重试', 'error')
            renderSidebar(el)
            // 恢复内容区：重新加载当前路由或显示错误占位
            const contentEl = document.getElementById('content')
            if (contentEl) {
              const hash = window.location.hash.slice(1) || '/'
              if (hash) {
                reloadCurrentRoute()
              } else {
                contentEl.innerHTML = `<div class="page"><div class="state-card state-card--error state-card--compact">${_escSidebar(t('common.pageLoadFailed'))}</div></div>`
              }
            }
          })
        }
        return
      }
      // 点击其他区域关闭下拉
      if (!e.target.closest('.engine-switcher')) {
        _closeEngineDropdown()
      }
      if (!e.target.closest('.lang-switcher')) {
        _closeLangDropdown()
      }
    })

    // 搜索功能（事件委托，侧边栏重渲染后仍然生效）
    el.addEventListener('input', (e) => {
      if (!e.target.closest('#sidebar-search')) return
      _applySidebarSearch(el, e.target.value || '')
    })

    // 分区折叠键盘支持 (Enter/Space)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const sectionToggle = e.target.closest('[data-toggle]')
        if (sectionToggle) {
          e.preventDefault()
          sectionToggle.click()
        }
      }
    })

  }
}

function _setSectionCollapsed(section, collapsed) {
  const items = section?.querySelector('.nav-section-items')
  const toggle = section?.querySelector('[data-toggle]')
  if (!section || !items) return
  items.classList.toggle('collapsed', !!collapsed)
  section.classList.toggle('section-collapsed', !!collapsed)
  if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
}

function _applySidebarSearch(el, query) {
  const q = String(query || '').trim().toLowerCase()
  el.querySelectorAll('.nav-section').forEach(section => {
    const items = [...section.querySelectorAll('.nav-item[data-nav-label]')]
    if (!q) {
      section.hidden = false
      items.forEach(item => { item.hidden = false })
      const wasCollapsed = section.dataset.preSearchCollapsed === '1'
      if (section.dataset.preSearchCollapsed != null) {
        _setSectionCollapsed(section, wasCollapsed)
        delete section.dataset.preSearchCollapsed
      }
      return
    }

    if (section.dataset.preSearchCollapsed == null) {
      section.dataset.preSearchCollapsed = section.classList.contains('section-collapsed') ? '1' : '0'
    }

    let visible = 0
    items.forEach(item => {
      const match = (item.dataset.navLabel || '').includes(q)
      item.hidden = !match
      if (match) visible++
    })
    section.hidden = visible === 0
    if (visible > 0) _setSectionCollapsed(section, false)
  })
}


// === 移动端侧边栏 ===

function _ensureKernelPolicyInfo(el) {
  const snap = getKernelSnapshot()
  if (getActiveEngineId() !== 'openclaw' || !snap?.version) return
  const now = Date.now()
  if (_kernelPolicyLoading) return
  if (_kernelPolicyInfo && now - _kernelPolicyFetchedAt < KERNEL_POLICY_TTL) return

  _kernelPolicyLoading = true
  api.getVersionInfo()
    .then(info => {
      _kernelPolicyInfo = info || null
      _kernelPolicyFetchedAt = Date.now()
      if (el?.isConnected) renderSidebar(el)
    })
    .catch(() => {})
    .finally(() => { _kernelPolicyLoading = false })
}

/**
 * 增量更新侧边栏：只更新变化的部分，避免全量 innerHTML 重绘
 */
function _updateSidebarIncremental(el, current) {
  // 1. 更新导航激活状态
  const navItems = el.querySelectorAll('.nav-item[data-route]')
  navItems.forEach(item => {
    const active = item.dataset.route === current
    item.classList.toggle('active', active)
    if (active) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  })

  // 1b. 恢复导航徽章状态（增量渲染后需重新挂载 DOM）
  for (const [route, count] of Object.entries(_navBadges)) {
    if (count === null || count === 0) continue
    const item = el.querySelector(`.nav-item[data-route="${route}"]`)
    if (item) {
      const badge = item.querySelector('.nav-badge')
      if (badge) {
        badge.textContent = count > 99 ? '99+' : String(count)
        badge.classList.add('visible')
      }
    }
  }

  // 2. 更新主题按钮
  const themeBtn = el.querySelector('#btn-theme-toggle')
  if (themeBtn) {
    const isDark = getTheme() === 'dark'
    const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
    const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'
    themeBtn.innerHTML = `${isDark ? sunIcon : moonIcon}<span>${isDark ? t('sidebar.themeLight') : t('sidebar.themeDark')}</span>`
  }

  // 3. 更新语言切换器文字
  const langTrigger = el.querySelector('#btn-lang-toggle span')
  if (langTrigger) {
    const langCode = getLang()
    const langs = getAvailableLangs()
    const currentLang = langs.find(l => l.code === langCode) || langs[0]
    langTrigger.textContent = currentLang.label
  }

  // 4. 更新引擎切换器
  const engineSwitcher = el.querySelector('.engine-switcher')
  if (engineSwitcher) {
    const newSwitcher = renderEngineSwitcher()
    const temp = document.createElement('div')
    temp.innerHTML = newSwitcher
    const newEl = temp.firstElementChild
    if (newEl) engineSwitcher.replaceWith(newEl)
  }

  // 5. 更新内核升级提示
  const existingHint = el.querySelector('#kernel-upgrade-hint')
  const newHintHtml = renderKernelUpgradeHint(_kernelPolicyInfo)
  const tempHint = document.createElement('div')
  tempHint.innerHTML = newHintHtml
  const newHint = tempHint.firstElementChild
  if (newHint && !existingHint) {
    // 新增提示卡：插到 sidebar-footer 之前
    const footer = el.querySelector('.sidebar-footer')
    if (footer) footer.before(newHint)
  } else if (!newHint && existingHint) {
    existingHint.remove()
  } else if (newHint && existingHint) {
    existingHint.replaceWith(newHint)
  }

  // 6. 应用折叠态
  _setDesktopSidebarCollapsed(_isDesktopSidebarCollapsed())
}

// === 移动端侧边栏 ===
function _closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (sidebar) sidebar.classList.remove('sidebar-open')
  if (overlay) {
    overlay.classList.remove('visible')
    overlay.remove()
  }
}

export function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar')
  if (!sidebar) return
  sidebar.classList.add('sidebar-open')
  let overlay = document.getElementById('sidebar-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'sidebar-overlay'
    overlay.className = 'sidebar-overlay'
    overlay.addEventListener('click', _closeMobileSidebar)
    document.getElementById('app').appendChild(overlay)
  }
  requestAnimationFrame(() => overlay.classList.add('visible'))
}

function _closeLangDropdown() {
  const sw = document.getElementById('lang-switcher')
  const dd = document.getElementById('lang-dropdown')
  if (dd) dd.classList.remove('open')
  if (sw) sw.classList.remove('open')
}

function _toggleLangDropdown(sidebarEl) {
  const sw = document.getElementById('lang-switcher')
  const dd = document.getElementById('lang-dropdown')
  if (!dd) return
  if (dd.classList.contains('open')) { dd.classList.remove('open'); if (sw) sw.classList.remove('open'); return }
  dd.classList.add('open')
  if (sw) sw.classList.add('open')
  const searchInput = dd.querySelector('#lang-search')
  if (searchInput) {
    searchInput.value = ''
    _filterLangOptions('')
    requestAnimationFrame(() => searchInput.focus())
    searchInput.oninput = () => _filterLangOptions(searchInput.value)
  }
}

function _filterLangOptions(query) {
  const opts = document.querySelectorAll('#lang-options .lang-option')
  const q = query.toLowerCase().trim()
  opts.forEach(opt => {
    if (!q) { opt.style.display = ''; return }
    const label = (opt.querySelector('.lang-option-label')?.textContent || '').toLowerCase()
    const code = (opt.querySelector('.lang-option-code')?.textContent || '').toLowerCase()
    opt.style.display = (label.includes(q) || code.includes(q)) ? '' : 'none'
  })
}

// ─── Nav Badge ───
const _navBadges = {}

/**
 * 更新导航项右上角徽章
 * @param {string} route - 路由路径（如 '/chat'）
 * @param {number|null} count - 数字（显示为徽章），null 隐藏
 */
export function updateNavBadge(route, count) {
  _navBadges[route] = count
  const item = document.querySelector(`.nav-item[data-route="${route}"]`)
  if (!item) return
  const badge = item.querySelector('.nav-badge')
  if (!badge) return
  if (count === null || count === 0) {
    badge.textContent = ''
    badge.classList.remove('visible')
  } else {
    badge.textContent = count > 99 ? '99+' : String(count)
    badge.classList.add('visible')
  }
}

export function clearNavBadges() {
  Object.keys(_navBadges).forEach(k => delete _navBadges[k])
  document.querySelectorAll('.nav-badge').forEach(b => {
    b.textContent = ''
    b.classList.remove('visible')
  })
}
