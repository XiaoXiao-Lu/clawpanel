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






let _delegated = false


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
  if (btn) btn.textContent = collapsed ? '»' : '«'
}

export function renderSidebar(el) {
  const current = getCurrentRoute()

  const collapsed = _isDesktopSidebarCollapsed()
  let html = `
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <img src="/images/logo.png" alt="ClawPanel">
      </div>
      <span class="sidebar-title">ClawPanel</span>
      <button class="sidebar-collapse-btn" id="btn-sidebar-collapse" title="${t('sidebar.collapse')}">${collapsed ? '»' : '«'}</button>
      <button class="sidebar-close-btn" id="btn-sidebar-close" title="${t('sidebar.closeMenu')}">&times;</button>
    </div>
    ${renderEngineSwitcher()}
    <nav class="sidebar-nav">
  `

  // 从当前引擎获取菜单（回退到原有逻辑）
  const engine = getActiveEngine()
  const navItems = needsInitialEngineChoice() || isEngineSetupDeferred()
    ? NAV_ITEMS_ENGINE_SELECT()
    : (engine ? engine.getNavItems() : (isOpenclawReady() ? NAV_ITEMS_FULL() : NAV_ITEMS_SETUP()))

  for (const section of navItems) {
    html += `<div class="nav-section">
      <div class="nav-section-title">${section.section}</div>`

    for (const item of section.items) {
      if (item.gate && engine && !engine.isFeatureAvailable(item.gate)) continue
      if (item.gate && !engine && !isFeatureAvailable(item.gate)) continue
      const active = current === item.route ? ' active' : ''
      html += `<div class="nav-item${active}" data-route="${item.route}">
        ${ICONS[item.icon] || ''}
        <span>${item.label}</span>
      </div>`
    }
    html += '</div>'
  }

  html += '</nav>'

  // 主题切换按钮
  const isDark = getTheme() === 'dark'
  const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
  const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'

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
  html += renderKernelUpgradeHint()

  html += `
    <div class="sidebar-footer">
      <div class="nav-item" id="btn-theme-toggle">
        ${isDark ? sunIcon : moonIcon}
        <span>${isDark ? t('sidebar.themeLight') : t('sidebar.themeDark')}</span>
      </div>
      <div class="lang-switcher" id="lang-switcher">
        <button class="nav-item lang-trigger" id="btn-lang-toggle">
          ${globeIcon}
          <span>${currentLang.label}</span>
          <svg class="lang-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
        <div class="lang-dropdown" id="lang-dropdown">
          ${langs.length > 4 ? '<div class="lang-search-wrap"><input class="lang-search" id="lang-search" type="text" placeholder="Search..." autocomplete="off"></div>' : ''}
          <div class="lang-options" id="lang-options">${langOptions}</div>
        </div>
      </div>
      <div class="sidebar-meta">
        <a href="https://claw.qt.cool" target="_blank" rel="noopener" class="sidebar-link">claw.qt.cool</a>
        <span class="sidebar-version">v${APP_VERSION}</span>
      </div>
    </div>
  `

  el.innerHTML = html

  // 应用折叠态（桌面端）
  _setDesktopSidebarCollapsed(collapsed)

  // 事件委托：只绑定一次，避免重复绑定
  if (!_delegated) {
    _delegated = true
    el.addEventListener('click', async (e) => {
      // 导航点击
      const navItem = e.target.closest('.nav-item[data-route]')
      if (navItem) {
        navigate(navItem.dataset.route)
        _closeMobileSidebar()
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
          console.error('[sidebar] 内核升级触发失败:', err)
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
          const confirmed = await showConfirm({
            message: `确定切换到 ${targetEngine?.name || eid} 引擎吗？`,
            title: '切换引擎',
            confirmText: '确定',
            cancelText: '取消',
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
            console.error('[sidebar] 切换引擎失败:', err)
            toast(t('engine.switchFailed') || '引擎切换失败，请稍后重试', 'error')
            renderSidebar(el)
            // 恢复内容区：重新加载当前路由或显示错误占位
            const contentEl = document.getElementById('content')
            if (contentEl) {
              const hash = window.location.hash.slice(1) || '/'
              if (hash) {
                reloadCurrentRoute()
              } else {
                contentEl.innerHTML = `<div class="page" style="padding:32px;color:var(--error)">加载失败，请刷新页面重试</div>`
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

  }
}



// === 移动端侧边栏 ===
function _closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (sidebar) sidebar.classList.remove('sidebar-open')
  if (overlay) overlay.classList.remove('visible')
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
