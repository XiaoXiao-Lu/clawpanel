/**
 * Sidebar navigation items and renderers
 */
import { t } from '../lib/i18n.js'
import { listEngines, getActiveEngine, getActiveEngineId } from '../lib/engine-manager.js'
import { getKernelSnapshot, recommendedIsNewer } from '../lib/kernel.js'
import { escapeHtml as _escSidebar } from '../lib/utils.js'
import { ICONS } from './sidebar-icons.js'

// 当用户点 "暂时不升级" 时，本地会话内不再显示升级提示
export const SS_DISMISSED_KERNEL_UPGRADE = 'clawpanel_kernel_upgrade_dismissed'

export function NAV_ITEMS_FULL() { return [
  {
    section: t('sidebar.sectionMonitor'),
    items: [
      { route: '/dashboard', label: t('sidebar.dashboard'), icon: 'dashboard' },
      { route: '/assistant', label: t('sidebar.assistant'), icon: 'assistant' },
      { route: '/chat', label: t('sidebar.chat'), icon: 'chat' },
      { route: '/route-map', label: t('sidebar.routeMap'), icon: 'route-map' },
      { route: '/services', label: t('sidebar.services'), icon: 'services' },
      { route: '/logs', label: t('sidebar.logs'), icon: 'logs' },
    ]
  },
  {
    section: t('sidebar.sectionConfig'),
    items: [
      { route: '/models', label: t('sidebar.models'), icon: 'models' },
      { route: '/agents', label: t('sidebar.agents'), icon: 'agents' },
      { route: '/gateway', label: t('sidebar.gateway'), icon: 'gateway' },
      { route: '/channels', label: t('sidebar.channels'), icon: 'channels' },
      { route: '/communication', label: t('sidebar.communication'), icon: 'settings' },
      { route: '/security', label: t('sidebar.security'), icon: 'security' },
    ]
  },
  {
    section: t('sidebar.sectionData'),
    items: [
      { route: '/memory', label: t('sidebar.memory'), icon: 'memory', gate: 'memory' },
      { route: '/memory-auto-capture', label: t('sidebar.memoryAutoCapture'), icon: 'inbox', gate: 'memory' },
      { route: '/dreaming', label: t('sidebar.dreaming'), icon: 'dreaming', gate: 'dreaming' },
      { route: '/cron', label: t('sidebar.cron'), icon: 'clock', gate: 'cron' },
      { route: '/usage', label: t('sidebar.usage'), icon: 'bar-chart' },
    ]
  },
  {
    section: t('sidebar.sectionExtension'),
    items: [
      { route: '/skills', label: t('sidebar.skills'), icon: 'skills', gate: 'skills' },
      { route: '/connectors', label: t('sidebar.connectors'), icon: 'connectors' },
      { route: '/plugin-hub', label: t('sidebar.pluginHub'), icon: 'extensions' },
    ]
  },
  {
    section: t('sidebar.sectionSystem'),
    items: [
      { route: '/settings', label: t('sidebar.settings'), icon: 'settings' },
      { route: '/chat-debug', label: t('sidebar.checkRepair'), icon: 'diagnose' },
      { route: '/about', label: t('sidebar.about'), icon: 'about' },
    ]
  }
] }

export function NAV_ITEMS_SETUP() { return [
  {
    section: '',
    items: [
      { route: '/setup', label: t('sidebar.setup'), icon: 'setup' },
      { route: '/assistant', label: t('sidebar.assistant'), icon: 'assistant' },
    ]
  },
  {
    section: '',
    items: [
      { route: '/settings', label: t('sidebar.settings'), icon: 'settings' },
      { route: '/chat-debug', label: t('sidebar.chatDebug'), icon: 'debug' },
      { route: '/about', label: t('sidebar.about'), icon: 'about' },
    ]
  }
] }

export function NAV_ITEMS_ENGINE_SELECT() { return [
  {
    section: '',
    items: [
      { route: '/engine-select', label: t('engine.choiceNav'), icon: 'setup' },
      { route: '/assistant', label: t('sidebar.assistant'), icon: 'assistant' },
    ]
  },
  {
    section: '',
    items: [
      { route: '/settings', label: t('sidebar.settings'), icon: 'settings' },
      { route: '/about', label: t('sidebar.about'), icon: 'about' },
    ]
  }
] }

// === 引擎切换器 ===
export function renderEngineSwitcher() {
  const engines = listEngines()
  if (engines.length < 2) return '' // 只有一个引擎时不显示
  const active = getActiveEngine()
  if (!active) return ''
  return `<div class="engine-switcher" id="engine-switcher">
    <div class="engine-switcher-label">${_escSidebar(t('engine.switcherSectionLabel'))}</div>
    <button class="engine-current" id="btn-engine-toggle" title="${_escSidebar(t('engine.switcherTooltip'))}" aria-haspopup="listbox" aria-expanded="false">
      <span class="engine-icon">${active.icon || ''}</span>
      <span class="engine-label">${_escSidebar(active.name)}</span>
      <svg class="engine-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="engine-dropdown" id="engine-dropdown">
      ${engines.map(e => `<div class="engine-option${e.id === active.id ? ' active' : ''}" data-engine="${e.id}">
        <span class="engine-opt-icon">${e.icon || ''}</span>
        <span class="engine-opt-name">${_escSidebar(e.name)}</span>
        ${e.id === active.id ? '<span class="engine-active-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
      </div>`).join('')}
    </div>
  </div>`
}

/**
 * 渲染"内核可升级"卡片。
 *
 * 显示条件（同时满足）：
 * - 当前引擎是 openclaw
 * - 已成功握手 Gateway（snapshot 有 version）
 * - 高于硬地板（< floor 由 floor-blocker 接管）
 * - 低于推荐目标（!isLatest）
 * - 用户未在本会话中点击过 "暂不升级"
 *
 * 不满足任何一条返回空串。
 */
function kernelPolicyTarget(snap, policyInfo = null) {
  return policyInfo?.recommended || snap?.target || ''
}

function isRunningGatewayBelowTarget(snap, policyInfo = null) {
  if (!snap?.version) return false
  const target = kernelPolicyTarget(snap, policyInfo)
  return target ? recommendedIsNewer(target, snap.version) : !snap.isLatest
}

export function renderKernelUpgradeHint(policyInfo = null) {
  if (getActiveEngineId() !== 'openclaw') return ''
  if (sessionStorage.getItem(SS_DISMISSED_KERNEL_UPGRADE) === '1') return ''

  const snap = getKernelSnapshot()
  if (!snap || !snap.version) return ''
  if (!snap.aboveFloor) return ''   // floor-blocker 处理
  if (!isRunningGatewayBelowTarget(snap, policyInfo)) return '' // 已经是推荐目标

  const arrowIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
  const sparkIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L13.5 8.5 20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/></svg>'

  const fromLabel = snap.versionLabel || snap.version
  const toLabel = kernelPolicyTarget(snap, policyInfo)

  return `
    <button type="button" class="kernel-upgrade-hint" id="kernel-upgrade-hint">
      <div class="kernel-upgrade-hint-icon">${sparkIcon}</div>
      <div class="kernel-upgrade-hint-body">
        <div class="kernel-upgrade-hint-title">${_escSidebar(t('kernel.upgradeHint.title'))}</div>
        <div class="kernel-upgrade-hint-meta">${_escSidebar(t('kernel.upgradeHint.subtitle', { from: fromLabel, to: toLabel }))}</div>
      </div>
      <div class="kernel-upgrade-hint-arrow">${arrowIcon}</div>
      <span class="kernel-upgrade-hint-dismiss" id="btn-kernel-upgrade-dismiss" title="${_escSidebar(t('kernel.upgradeHint.dismissTooltip'))}" aria-label="${_escSidebar(t('kernel.upgradeHint.dismissTooltip'))}">×</span>
    </button>
  `
}
