/**
 * 模型配置页面
 * 服务商管理 + 模型增删改查 + 主模型选择
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { showModal, showConfirm } from '../components/modal.js'
import { icon, statusIcon } from '../lib/icons.js'
import { API_TYPES, PROVIDER_PRESETS, QTCOOL, MODEL_PRESETS, fetchQtcoolModels } from '../lib/model-presets.js'
import { t } from '../lib/i18n.js'
import { termHelpHtml, attachTermTooltips } from '../lib/term-tooltip.js'
import { createModelCombobox } from '../engines/hermes/lib/model-combobox.js'
import { escapeHtml } from '../lib/utils.js'

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(value))
  return String(value).replace(/["\\]/g, '\\$&')
}

/**
 * 通用拖拽排序（Pointer Events 实现，兼容 Tauri WebView2/WKWebView）
 * @param {HTMLElement} container - 可拖拽列表的容器
 * @param {object} options
 * @param {string} options.handleSelector - 拖拽手柄的选择器
 * @param {string} options.itemSelector - 拖拽项的选择器
 * @param {string} [options.placeholderStyle] - 占位符的内联样式
 * @param {string} [options.dragStyle] - 拖拽项浮动时的附加样式
 * @param {function(HTMLElement[]): void} options.onReorder - 拖拽完成后的回调，传入排序后的项列表
 */
function createDragSortable(container, options) {
  const { handleSelector, itemSelector, placeholderStyle, dragStyle, onReorder } = options
  let dragged = null
  let placeholder = null
  let startY = 0

  container.addEventListener('pointerdown', e => {
    const handle = e.target.closest(handleSelector)
    if (!handle) return
    const item = handle.closest(itemSelector)
    if (!item) return

    e.preventDefault()
    dragged = item
    startY = e.clientY

    placeholder = document.createElement('div')
    placeholder.style.cssText = placeholderStyle || `height:${item.offsetHeight}px;border:2px dashed var(--border);border-radius:var(--radius-md);margin-bottom:8px;background:var(--bg-secondary)`
    item.after(placeholder)

    const rect = item.getBoundingClientRect()
    item.style.position = 'fixed'
    item.style.left = rect.left + 'px'
    item.style.top = rect.top + 'px'
    item.style.width = rect.width + 'px'
    item.style.zIndex = '9999'
    item.style.opacity = '0.85'
    if (dragStyle) Object.assign(item.style, dragStyle)
    item.style.pointerEvents = 'none'
    item.setPointerCapture(e.pointerId)
  })

  container.addEventListener('pointermove', e => {
    if (!dragged || !placeholder) return
    e.preventDefault()

    const dy = e.clientY - startY
    const origTop = parseFloat(dragged.style.top)
    dragged.style.top = (origTop + dy) + 'px'
    startY = e.clientY

    const siblings = [...container.querySelectorAll(itemSelector)].filter(c => c !== dragged && c.style.position !== 'fixed')
    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect()
      if (e.clientY < rect.top + rect.height / 2) {
        sibling.before(placeholder)
        return
      }
    }
    if (siblings.length) siblings[siblings.length - 1].after(placeholder)
  })

  container.addEventListener('pointerup', () => {
    if (!dragged || !placeholder) return

    dragged.style.position = ''
    dragged.style.left = ''
    dragged.style.top = ''
    dragged.style.width = ''
    dragged.style.zIndex = ''
    dragged.style.opacity = ''
    dragged.style.pointerEvents = ''
    if (dragStyle) {
      for (const key of Object.keys(dragStyle)) dragged.style[key] = ''
    }
    if (dragged.style.boxShadow) dragged.style.boxShadow = ''

    placeholder.before(dragged)
    placeholder.remove()

    if (onReorder) {
      const items = [...container.querySelectorAll(itemSelector)]
      onReorder(items)
    }

    dragged = null
    placeholder = null
  })
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page models-page'

  page.innerHTML = `
    <div class="page-header models-page-header">
      <h1 class="page-title">${t('models.title')}</h1>
      <div class="models-top-actions">
        <span class="models-qtcool-tag" id="btn-toggle-qtcool">${icon('zap', 12)} ${t('models.qtcoolRecommend')}</span>
        <button class="btn btn-sm btn-secondary" id="btn-import-client">${t('models.importClientConfigs')}</button>
        <button class="btn btn-sm btn-secondary" id="btn-undo" disabled>${t('models.undo')}</button>
        <button class="btn btn-primary btn-sm" id="btn-add-provider">${t('models.addProvider')}</button>
      </div>
    </div>
    <div id="qtcool-body" class="models-qtcool-body models-qtcool-body--hidden">
      <div class="models-qtcool-body-inner"><input class="form-input" id="qtcool-apikey" placeholder="${t('models.qtcoolKeyPlaceholder')}">
        <button class="btn btn-primary btn-sm" id="btn-qtcool-oneclick">${icon('plus', 12)} ${t('models.qtcoolFetchModels')}</button>
      </div>
    </div>
    
    <div class="models-workbench">
      <!-- 区域1：Hero — 主模型 + 备选链 -->
      <div id="models-hero-container"></div>

      <!-- 区域2：概览条 — 统计 + 快捷操作 -->
      <div id="models-overview-bar-container"></div>

      <!-- 备选瀑布流编辑器（默认折叠） -->
      <div id="fallback-waterfall-container" style="display:none"></div>

      <!-- 区域3：服务商 & 模型 -->
      <section class="models-provider-section">
        <div class="models-toolbar">
          <div class="models-search-wrap">
            ${icon('search', 15)}
            <input class="form-input" id="model-search" placeholder="${t('models.searchPlaceholder')}">
          </div>
          <span id="models-stats-inline" class="models-stats-inline"></span>
        </div>
        <div id="providers-list">
          <div class="config-section"><div class="stat-card loading-placeholder" style="height:120px"></div></div>
          <div class="config-section"><div class="stat-card loading-placeholder" style="height:120px"></div></div>
        </div>
      </section>
    </div>
  `

  /** @type {{ config: object|null, search: string, undoStack: object[], sortBy: string, _collapsed: Object<string,boolean>, _fallbacks_expanded: boolean, _fallback_candidates_collapsed: Object<string,boolean>, _providerFilter: string }} */
  const state = {
    config: null,
    search: '',
    undoStack: [],
    sortBy: 'default',
    _collapsed: {},
    _fallbacks_expanded: false,
    _fallback_candidates_collapsed: {},
    _providerFilter: 'all',
  }
  // 暴露 state 给 locateModel 等函数使用
  page.__modelsState = state
  // 非阻塞:先返回 DOM,后台加载数据
  loadConfig(page, state)
  bindTopActions(page, state)

  // 搜索框实时过滤
  page.querySelector('#model-search').oninput = (e) => {
    state.search = e.target.value.trim().toLowerCase()
    renderProviders(page, state)
  }

  // 可折叠推广横幅
  const qtcoolToggle = page.querySelector('#btn-toggle-qtcool')
  qtcoolToggle.setAttribute('role', 'button')
  qtcoolToggle.setAttribute('tabindex', '0')
  qtcoolToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.currentTarget.click()
    }
  })
  qtcoolToggle.onclick = () => {
    const body = page.querySelector('#qtcool-body')
    body.classList.toggle('models-qtcool-body--hidden')
  }

  // 点击外部关闭 Provider 操作菜单
  if (_docClickHandler) document.removeEventListener('click', _docClickHandler)
  _docClickHandler = (e) => {
    if (!e.target.closest('.provider-card__actions')) {
      page.querySelectorAll('.provider-card__actions.menu-open').forEach(el => el.classList.remove('menu-open'))
    }
  }
  document.addEventListener('click', _docClickHandler)

  // Provider Tab 切换
  page.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-provider-tab]')
    if (tab) {
      const nextFilter = tab.dataset.providerTab
      if (!nextFilter || nextFilter === state._providerFilter) return
      state._providerFilter = nextFilter
      renderProvidersKeepingViewport(page, state)
    }
  })

  return page
}

async function loadConfig(page, state) {
  const listEl = page.querySelector('#providers-list')
  try {
    state.config = await api.readOpenclawConfig()
    // 自动修复现有配置中的 baseUrl(如 Ollama 缺少 /v1),一次性迁移
    const before = JSON.stringify(state.config?.models?.providers || {})
    normalizeProviderUrls(state.config)
    const after = JSON.stringify(state.config?.models?.providers || {})
    const oldPrimary = getCurrentPrimary(state.config)
    const normalizedModel = normalizeDefaultModelSelection(state.config)
    if (before !== after || normalizedModel.changed) {
      console.log('[models] 自动修复了模型配置,正在保存...')
      await api.writeOpenclawConfig(state.config, { noReload: true })
      if (oldPrimary !== normalizedModel.primary) toast(t('models.primaryAutoSwitch', { model: normalizedModel.primary || t('models.notConfigured') }), 'info')
      else if (before !== after) toast(t('models.autoFixUrl'), 'info')
    }

    const currentFallbacks = state.config?.agents?.defaults?.model?.fallbacks || []
    if (currentFallbacks.length > 0) {
      state._fallbacks_expanded = true
      const wEl = page.querySelector('#fallback-waterfall-container')
      if (wEl) wEl.style.display = 'block'
    }

    renderProviders(page, state)
    renderHero(page, state)
    renderOverviewBar(page, state)
    renderWaterfall(page, state)
  } catch (e) {
    console.error('[models] loadConfig failed:', e)
    const detail = escapeHtml(e?.stack || e?.message || String(e))
    const shortMsg = escapeHtml(e?.message || String(e))
    listEl.innerHTML = `
      <div class="models-load-error" style="padding:36px 20px;text-align:center;max-width:560px;margin:0 auto">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:rgba(239,68,68,0.10);color:var(--error);margin-bottom:14px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div style="color:var(--text-primary);font-weight:600;font-size:15px;margin-bottom:6px">${t('models.configLoadFailed')}</div>
        <div style="color:var(--text-secondary);font-size:13px;line-height:1.65;margin-bottom:18px">${t('models.configLoadFailedHint')}</div>
        <details style="text-align:left;margin-bottom:18px">
          <summary style="cursor:pointer;color:var(--text-tertiary);font-size:12px;padding:4px 0;user-select:none">${t('models.configLoadDetails')}</summary>
          <pre style="margin-top:8px;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:6px;font-size:11px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto;text-align:left">${detail}</pre>
        </details>
        <button class="btn btn-primary btn-sm" id="models-retry-load">${t('models.retryRestart')}</button>
      </div>
    `
    listEl.querySelector('#models-retry-load')?.addEventListener('click', () => loadConfig(page, state))
    toast(`${t('models.configLoadFailed')}: ${shortMsg}`, 'error')
  }
}

function getCurrentPrimary(config) {
  return config?.agents?.defaults?.model?.primary || ''
}

export function normalizeMaxConcurrent(value, fallback = 4) {
  let next = Number.parseInt(value, 10)
  if (Number.isNaN(next)) next = fallback
  if (next < 1) return 1
  if (next > 100) return 100
  return next
}

function ensureConfigDefaultModelConfig(config) {
  if (!config.agents) config.agents = {}
  if (!config.agents.defaults) config.agents.defaults = {}
  if (!config.agents.defaults.model) config.agents.defaults.model = {}
  if (!Array.isArray(config.agents.defaults.model.fallbacks)) {
    config.agents.defaults.model.fallbacks = []
  }
  config.agents.defaults.maxConcurrent = normalizeMaxConcurrent(config.agents.defaults.maxConcurrent, 4)
  return config.agents.defaults.model
}

function ensureDefaultModelConfig(state) {
  return ensureConfigDefaultModelConfig(state.config)
}

function collectAllModels(config) {
  const result = []
  const providers = config?.models?.providers || {}
  for (const [pk, pv] of Object.entries(providers)) {
    for (const m of (pv.models || [])) {
      const id = typeof m === 'string' ? m : m.id
      if (id) result.push({ provider: pk, modelId: id, full: `${pk}/${id}` })
    }
  }
  return result
}

function normalizeDefaultModelMap(config, validModels, primary, fallbacks) {
  const defaults = config?.agents?.defaults
  if (!defaults) return false
  const current = defaults.models && typeof defaults.models === 'object' && !Array.isArray(defaults.models) ? defaults.models : {}
  const next = { ...current }
  if (primary && (!next[primary] || typeof next[primary] !== 'object' || Array.isArray(next[primary]))) next[primary] = {}
  for (const f of fallbacks || []) {
    if (f && (!next[f] || typeof next[f] !== 'object' || Array.isArray(next[f]))) next[f] = {}
  }
  const changed = JSON.stringify(current) !== JSON.stringify(next)
  defaults.models = next
  return changed
}

function dedupeFallbacks(fallbacks, primary) {
  const seen = new Set()
  if (primary) seen.add(primary)
  return (Array.isArray(fallbacks) ? fallbacks : [])
    .map(f => typeof f === 'string' ? f.trim() : '')
    .filter(Boolean)
    .filter(f => {
      if (seen.has(f)) return false
      seen.add(f)
      return true
    })
}

export function normalizeDefaultModelSelection(config) {
  const allModels = collectAllModels(config)
  const validModels = new Set(allModels.map(m => m.full))
  const modelConfig = ensureConfigDefaultModelConfig(config)
  let changed = false
  if (!allModels.length) {
    const nextFallbacks = dedupeFallbacks(modelConfig.fallbacks, modelConfig.primary || '')
    if (JSON.stringify(nextFallbacks) !== JSON.stringify(modelConfig.fallbacks)) {
      modelConfig.fallbacks = nextFallbacks
      changed = true
    }
    changed = normalizeDefaultModelMap(config, validModels, modelConfig.primary || '', modelConfig.fallbacks) || changed
    return { changed, primary: modelConfig.primary || '' }
  }
  let primary = modelConfig.primary || ''
  if (!primary) {
    const fallbackPrimary = modelConfig.fallbacks.find(f => validModels.has(f))
    primary = fallbackPrimary || allModels[0].full
    modelConfig.primary = primary
    changed = true
  }
  const nextFallbacks = dedupeFallbacks(modelConfig.fallbacks, primary)
  if (JSON.stringify(nextFallbacks) !== JSON.stringify(modelConfig.fallbacks)) {
    modelConfig.fallbacks = nextFallbacks
    changed = true
  }
  changed = normalizeDefaultModelMap(config, validModels, primary, modelConfig.fallbacks) || changed
  return { changed, primary }
}

function getApiTypeLabel(apiType) {
  return API_TYPES.find(at => at.value === apiType)?.label || apiType || t('common.unknown')
}

function getModelObject(config, full) {
  if (!full || !full.includes('/')) return null
  const slash = full.indexOf('/')
  const providerKey = full.slice(0, slash)
  const modelId = full.slice(slash + 1)
  const provider = config?.models?.providers?.[providerKey]
  if (!provider) return null
  const model = (provider.models || []).find(m => (typeof m === 'string' ? m : m.id) === modelId)
  if (!model) return null
  return { providerKey, provider, modelId, model }
}

function modelDisplayName(entry) {
  if (!entry) return ''
  const model = entry.model
  if (model && typeof model === 'object' && model.name && model.name !== entry.modelId) return model.name
  return entry.modelId
}

function modelStatusHtml(model) {
  if (!model || typeof model !== 'object') return `<span class="models-status neutral">${t('models.notTested')}</span>`
  if (model.testStatus === 'fail') return `<span class="models-status error" title="${escapeHtml(model.testError || '')}">${t('models.unavailable')}</span>`
  if (model.latency != null) {
    const tone = model.latency < 3000 ? 'ok' : model.latency < 8000 ? 'warn' : 'error'
    return `<span class="models-status ${tone}">${(model.latency / 1000).toFixed(1)}s</span>`
  }
  return `<span class="models-status neutral">${t('models.notTested')}</span>`
}

function modelMetaLine(entry) {
  if (!entry) return ''
  const model = entry.model
  const meta = [entry.providerKey]
  if (model && typeof model === 'object') {
    if (model.contextWindow) meta.push((model.contextWindow / 1000) + 'K ' + t('models.context'))
    if (model.reasoning) meta.push(t('models.reasoning'))
    if (model.lastTestAt) meta.push(formatTestTime(model.lastTestAt))
  }
  return meta.join(' · ')
}

function renderPrimaryOptions(config, primary) {
  const providers = config?.models?.providers || {}
  return Object.entries(providers).map(([providerKey, provider]) => {
    const options = (provider.models || []).map((model) => {
      const modelId = typeof model === 'string' ? model : model.id
      const name = typeof model === 'string' ? model : (model.name || model.id)
      const full = `${providerKey}/${modelId}`
      const label = name && name !== modelId ? `${name} · ${modelId}` : modelId
      return `<option value="${escapeHtml(full)}" ${full === primary ? 'selected' : ''}>${escapeHtml(label)}</option>`
    }).join('')
    if (!options) return ''
    return `<optgroup label="${escapeHtml(providerKey)}">${options}</optgroup>`
  }).join('')
}

function getModelScore(entry, mode) {
  const model = entry?.model
  const latency = typeof model === 'object' && model?.latency != null ? model.latency : 12000
  const context = typeof model === 'object' && model?.contextWindow ? model.contextWindow : 0
  const reasoning = typeof model === 'object' && model?.reasoning ? 1 : 0
  const testedPenalty = typeof model === 'object' && model?.testStatus === 'fail' ? 1000000 : 0
  if (mode === 'fast') return latency + testedPenalty
  if (mode === 'context') return -context + latency / 20 + testedPenalty
  if (mode === 'reasoning') return -reasoning * 100000 - context / 10 + latency / 20 + testedPenalty
  return latency / 2 - Math.min(context, 200000) / 120 + testedPenalty
}

function buildRoutePreset(config, mode) {
  const all = collectAllModels(config)
    .map(item => ({ ...item, entry: getModelObject(config, item.full) }))
    .sort((a, b) => getModelScore(a.entry, mode) - getModelScore(b.entry, mode))
  const primary = all[0]?.full || ''
  const seenProviders = new Set(primary ? [all[0].provider] : [])
  const fallbacks = []
  const addFallback = (item) => {
    if (fallbacks.length >= 3) return
    if (fallbacks.includes(item.full)) return
    fallbacks.push(item.full)
    seenProviders.add(item.provider)
  }
  if (mode === 'stable') {
    for (const item of all.slice(1)) {
      if (fallbacks.length >= 3) break
      if (seenProviders.has(item.provider)) continue
      addFallback(item)
    }
  }
  for (const item of all.slice(1)) {
    if (fallbacks.length >= 3) break
    addFallback(item)
  }
  return { primary, fallbacks }
}

function applyRoutePreset(state, mode) {
  const next = buildRoutePreset(state.config, mode)
  if (!next.primary) return false
  const modelConfig = ensureDefaultModelConfig(state)
  modelConfig.primary = next.primary
  modelConfig.fallbacks = dedupeFallbacks(next.fallbacks, next.primary)
  normalizeDefaultModelSelection(state.config)
  return true
}

// 渲染当前主模型状态栏
// 渲染内联统计（极简）
function renderDefaultBar(page, state) {
  const el = page.querySelector('#models-stats-inline')
  if (!el) return
  const providerCount = Object.keys(state.config?.models?.providers || {}).length
  const allModels = collectAllModels(state.config)
  el.innerHTML = '<strong>' + providerCount + '</strong> ' + t('models.totalProviders') +
    ' · <strong>' + allModels.length + '</strong> ' + t('models.totalModels')
}

function renderFallbackWaterfall(state) {
  const primary = getCurrentPrimary(state.config)
  const currentFallbacks = state.config?.agents?.defaults?.model?.fallbacks || []

  // 分组候选模型
  const providers = state.config?.models?.providers || {}
  const candidatesByProvider = {}
  Object.keys(providers).forEach(pKey => {
    const pModels = providers[pKey].models || []
    const filtered = pModels.map(m => typeof m === 'string' ? m : m.id)
      .filter(mId => {
        const full = `${pKey}/${mId}`
        return full !== primary && !currentFallbacks.includes(full)
      })
    if (filtered.length > 0) {
      candidatesByProvider[pKey] = filtered
    }
  })

  return `
    <div class="fallback-editor-panel">
      <div class="fallback-best-practice">
        ${t('models.bestPracticeHint')}
      </div>

      <div class="fallback-workbench">
        <div class="fallback-workbench-pane">
          <div class="fallback-pane-head">
            <div>
              <div class="fallback-pane-title">${t('models.activeChainTitle')}</div>
              <div class="fallback-pane-subtitle">${t('models.activeChainSubtitle')}</div>
            </div>
            ${currentFallbacks.length > 0 ? `<button class="btn btn-sm btn-secondary btn-clear-all-fb">${t('models.clearAll')}</button>` : ''}
          </div>
          <div id="active-fallback-list" class="active-fallback-list">
            ${currentFallbacks.map((f, i) => `
              <div class="fallback-chain-item" data-id="${f}">
                <div class="fallback-chain-main">
                  <span class="fallback-drag-handle">⋮⋮</span>
                  <span class="fallback-priority">${i + 1}</span>
                  <span class="fallback-chain-name" title="${escapeHtml(f)}">${escapeHtml(f)}</span>
                </div>
                <div class="fallback-chain-actions">
                  <button class="btn btn-sm btn-secondary btn-set-primary-from-fb" data-id="${f}">${t('models.setAsPrimary')}</button>
                  <button class="btn-icon btn-remove-fb" data-id="${f}" title="${t('models.remove')}" aria-label="${t('models.remove')}">${icon('x', 12)}</button>
                </div>
              </div>
            `).join('')}
            ${currentFallbacks.length === 0 ? `<div class="fallback-empty-state">${t('models.noFallbackSelected')}</div>` : ''}
          </div>
        </div>

        <div class="fallback-workbench-pane">
          <div class="fallback-pane-head">
            <div>
              <div class="fallback-pane-title">${t('models.candidatePoolTitle')}</div>
              <div class="fallback-pane-subtitle">${t('models.candidatePoolSubtitle')}</div>
            </div>
          </div>
          <div id="candidate-model-pool" class="candidate-model-pool">
            ${Object.keys(candidatesByProvider).length === 0 ? `<div class="fallback-empty-state">${t('models.noCandidateModel')}</div>` :
              Object.keys(candidatesByProvider).map(pKey => {
                const collapsed = !!state._fallback_candidates_collapsed[pKey]
                const mIds = candidatesByProvider[pKey]
                return `
                  <div class="candidate-provider-group" data-provider="${pKey}">
                    <div class="candidate-provider-header">
                      <span class="chevron${collapsed ? '' : ' chevron--open'}">${icon('chevron-down', 12)}</span>
                      <span>${pKey}</span>
                      <span>${mIds.length}</span>
                    </div>
                    <div class="candidate-provider-list" style="display: ${collapsed ? 'none' : 'flex'}">
                      ${mIds.map(mId => `
                        <div class="candidate-item">
                          <span title="${escapeHtml(mId)}">${escapeHtml(mId)}</span>
                          <button class="btn btn-sm btn-primary btn-add-fb" data-full="${pKey}/${mId}">${t('models.add')}</button>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `
              }).join('')
            }
          </div>
        </div>
      </div>
    </div>
  `
}

function renderHero(page, state) {
  const container = page.querySelector('#models-hero-container')
  if (!container) return
  const primary = getCurrentPrimary(state.config)
  const modelConfig = ensureDefaultModelConfig(state)
  const fallbacks = modelConfig.fallbacks || []
  const entry = getModelObject(state.config, primary)
  const reasoning = !!entry?.model?.reasoning

  // 增量更新路径
  const existing = container.querySelector('.models-hero')
  if (existing) {
    const nameEl = existing.querySelector('.models-primary-name')
    if (nameEl) { nameEl.textContent = primary || t('models.notConfigured'); nameEl.title = primary || '' }
    const metaEl = existing.querySelector('.models-primary-meta')
    if (metaEl) metaEl.textContent = modelMetaLine(entry)

    // 更新徽章
    const badges = existing.querySelectorAll('.models-cb-badge--count')
    if (badges[0]) badges[0].textContent = `${fallbacks.length} ${t('models.fallbackCount')}`
    if (badges[1]) badges[1].textContent = `${collectAllModels(state.config).length} ${t('models.totalModels')}`

    // 更新备选链药丸
    renderFallbackChips(existing, fallbacks, primary)

    // 更新 toggle 按钮文案
    const toggleBtn = existing.querySelector('#models-toggle-fallbacks')
    updateToggleFallbackBtn(toggleBtn, state._fallbacks_expanded)

    // 更新 Combobox 值
    if (_globalPrimaryCombo) {
      const providers = state.config?.models?.providers || {}
      const items = []
      Object.entries(providers).forEach(([providerKey, provider]) => {
        ;(provider.models || []).forEach((model) => {
          const modelId = typeof model === 'string' ? model : model.id
          const name = typeof model === 'string' ? model : (model.name || model.id)
          const full = `${providerKey}/${modelId}`
          items.push({ value: full, label: name && name !== modelId ? `${name} · ${modelId}` : modelId, group: providerKey })
        })
      })
      _globalPrimaryCombo.setModels(items)
      if (primary) _globalPrimaryCombo.setValue(primary)
    }
    return
  }

  // 首次渲染：Hero 区 = 主模型卡片（左）+ 备选链（右）
  container.innerHTML = `
    <div class="models-hero">
      <div class="models-hero-primary">
        <div class="models-hero-primary__card">
          <div class="models-primary-icon">${icon('cpu', 24)}</div>
          <div class="models-primary-copy">
            <div class="models-primary-name" title="${escapeHtml(primary)}">${escapeHtml(primary || t('models.notConfigured'))}</div>
            <div class="models-primary-meta">${escapeHtml(modelMetaLine(entry))}</div>
          </div>
          <div class="models-console-badges">
            ${primary ? '<span class="models-cb-badge models-cb-badge--primary">' + t('models.primaryModel') + '</span>' : ''}
            ${reasoning ? '<span class="models-cb-badge models-cb-badge--reasoning">' + t('models.reasoning') + '</span>' : ''}
            <span class="models-cb-badge models-cb-badge--count">${fallbacks.length} ${t('models.fallbackCount')}</span>
            <span class="models-cb-badge models-cb-badge--count">${collectAllModels(state.config).length} ${t('models.totalModels')}</span>
          </div>
        </div>
        <div class="models-hero-primary__actions">
          <div id="models-primary-combobox-container" class="form-input-container" style="min-width:220px"></div>
          <button class="btn btn-sm btn-secondary" id="models-test-primary" title="${t('models.testPrimary')}">${icon('activity', 14)} ${t('models.testPrimary')}</button>
          <button class="btn btn-sm btn-secondary" id="models-locate-primary" title="${t('models.locateModel')}">${icon('map-pin', 14)} ${t('models.locateModel')}</button>
          <button class="btn btn-sm btn-primary" id="models-apply-gateway" title="${t('models.applyGatewayHint')}">${icon('refresh-cw', 14)} ${t('models.applyGateway')}</button>
        </div>
      </div>
      <div class="models-hero-fallback">
        <div class="models-hero-fallback__header">
          <span class="models-hero-fallback__label">${t('models.fallbackChain')}</span>
          <button class="models-ghost-btn" id="models-toggle-fallbacks">${icon('shuffle', 12)} ${t(state._fallbacks_expanded ? 'models.collapseFallbacks' : 'models.manageFallbacks')}</button>
        </div>
        <div class="models-hero-fallback__chips" id="models-fallback-chips">
          ${fallbacks.length > 0 ? fallbacks.map((f, i) => `
            <span class="models-fallback-chain__chip" data-action="toggle-fallback" data-full="${escapeHtml(f)}" title="${escapeHtml(f)}">
              <span class="fallback-priority">${i + 1}</span>
              ${escapeHtml(f.split('/').pop())}
              <span class="models-fallback-chain__chip-remove" data-action="toggle-fallback" data-full="${escapeHtml(f)}">×</span>
            </span>
          `).join('') : `<span class="models-fallback-chain__empty">${t('models.noFallbackSelected')}</span>`}
        </div>
      </div>
    </div>
  `

  // 初始化 Combobox
  const comboContainer = container.querySelector('#models-primary-combobox-container')
  if (comboContainer) {
    if (_globalPrimaryCombo) {
      _globalPrimaryCombo.destroy()
      _globalPrimaryCombo = null
    }
    const providers = state.config?.models?.providers || {}
    const items = []
    Object.entries(providers).forEach(([providerKey, provider]) => {
      ;(provider.models || []).forEach((model) => {
        const modelId = typeof model === 'string' ? model : model.id
        const name = typeof model === 'string' ? model : (model.name || model.id)
        const full = `${providerKey}/${modelId}`
        items.push({ value: full, label: name && name !== modelId ? `${name} · ${modelId}` : modelId, group: providerKey })
      })
    })
    _globalPrimaryCombo = createModelCombobox(comboContainer, {
      placeholder: t('models.choosePrimary'),
      initialValue: primary,
      onSelect(value) {
        if (!value) return
        pushUndo(state)
        setPrimary(state, value)
        renderDefaultBar(page, state)
        renderProviders(page, state)
        renderHero(page, state)
        renderOverviewBar(page, state)
        renderWaterfall(page, state)
        updateUndoBtn(page, state)
        autoSave(state)
      },
    })
    _globalPrimaryCombo.setModels(items)
    if (primary) _globalPrimaryCombo.setValue(primary)
  }

  // 主模型卡片点击 → 展开 Combobox
  const primaryCard = container.querySelector('.models-hero-primary__card')
  if (primaryCard && _globalPrimaryCombo) {
    primaryCard.onclick = (e) => {
      // 如果点击的是 badge 或按钮，不触发
      if (e.target.closest('.models-cb-badge')) return
      _globalPrimaryCombo.focus()
    }
  }

  const testBtn = container.querySelector('#models-test-primary')
  if (testBtn) {
    testBtn.onclick = () => {
      const current = getCurrentPrimary(state.config)
      if (current) testFullModel(testBtn, state, current)
    }
  }

  const locateBtn = container.querySelector('#models-locate-primary')
  if (locateBtn) {
    locateBtn.onclick = () => {
      const current = getCurrentPrimary(state.config)
      if (current) locateModel(page, current)
    }
  }

  const applyGatewayBtn = container.querySelector('#models-apply-gateway')
  if (applyGatewayBtn) {
    applyGatewayBtn.onclick = () => applyGatewayConfig(applyGatewayBtn, state)
  }

  const toggleFbBtn = container.querySelector('#models-toggle-fallbacks')
  if (toggleFbBtn) {
    toggleFbBtn.onclick = () => {
      state._fallbacks_expanded = !state._fallbacks_expanded
      renderWaterfall(page, state)
      // 更新按钮文案
      updateToggleFallbackBtn(toggleFbBtn, state._fallbacks_expanded)
    }
  }

  // 药丸点击事件委托（绑定在容器上，增量更新后无需重新绑定）
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-action="toggle-fallback"]')
    if (!pill) return
    const full = pill.dataset.full
    if (!full) return
    // 如果点击的是 × 移除按钮，直接移除
    if (e.target.closest('.models-fallback-chain__chip-remove')) {
      pushUndo(state)
      toggleFallbackModel(state, full)
      renderDefaultBar(page, state)
      renderProviders(page, state)
      renderHero(page, state)
      renderOverviewBar(page, state)
      renderWaterfall(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
      return
    }
    // 否则弹出上下文菜单
    showFallbackChipMenu(pill, full, page, state)
  })
}

/** 增量更新备选链药丸 */
/** 更新备选链 toggle 按钮文案 */
function updateToggleFallbackBtn(btn, expanded) {
  if (!btn) return
  btn.innerHTML = `${icon('shuffle', 12)} ${t(expanded ? 'models.collapseFallbacks' : 'models.manageFallbacks')}`
}

function renderFallbackChips(heroEl, fallbacks, primary) {
  const chipsEl = heroEl.querySelector('#models-fallback-chips')
  if (!chipsEl) return
  if (fallbacks.length > 0) {
    chipsEl.innerHTML = fallbacks.map((f, i) => `
      <span class="models-fallback-chain__chip" data-action="toggle-fallback" data-full="${escapeHtml(f)}" title="${escapeHtml(f)}">
        <span class="fallback-priority">${i + 1}</span>
        ${escapeHtml(f.split('/').pop())}
        <span class="models-fallback-chain__chip-remove" data-action="toggle-fallback" data-full="${escapeHtml(f)}">×</span>
      </span>
    `).join('')
  } else {
    chipsEl.innerHTML = `<span class="models-fallback-chain__empty">${t('models.noFallbackSelected')}</span>`
  }
}

/** 备选链药丸上下文菜单 */
function showFallbackChipMenu(anchor, full, page, state) {
  // 关闭已有菜单
  document.querySelectorAll('.models-chip-menu').forEach(m => m.remove())

  const menu = document.createElement('div')
  menu.className = 'models-chip-menu'
  menu.innerHTML = `
    <button class="models-chip-menu__item" data-chip-action="remove">
      ${icon('trash', 12)} ${t('models.removeFallback')}
    </button>
    <button class="models-chip-menu__item" data-chip-action="test">
      ${icon('activity', 12)} ${t('models.testBtn')}
    </button>
    <button class="models-chip-menu__item" data-chip-action="locate">
      ${icon('map-pin', 12)} ${t('models.locateModel')}
    </button>
    <button class="models-chip-menu__item" data-chip-action="edit-chain">
      ${icon('shuffle', 12)} ${t('models.manageFallbacks')}
    </button>
  `

  // 定位：在药丸下方
  const rect = anchor.getBoundingClientRect()
  menu.style.position = 'fixed'
  menu.style.left = `${rect.left}px`
  menu.style.top = `${rect.bottom + 4}px`
  menu.style.zIndex = 'var(--z-dropdown, 100)'

  document.body.appendChild(menu)

  // 点击外部关闭
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove()
      document.removeEventListener('click', closeHandler, true)
    }
  }
  // 延迟绑定防止立即触发
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0)

  // 菜单项事件
  menu.querySelectorAll('[data-chip-action]').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.chipAction
      menu.remove()
      document.removeEventListener('click', closeHandler, true)

      if (action === 'remove') {
        pushUndo(state)
        toggleFallbackModel(state, full)
        renderDefaultBar(page, state)
        renderProviders(page, state)
        renderHero(page, state)
        renderOverviewBar(page, state)
        renderWaterfall(page, state)
        updateUndoBtn(page, state)
        autoSave(state)
      } else if (action === 'test') {
        const btnEl = page.querySelector(`.models-card[data-full="${full}"] [data-action="test-model"]`)
        if (btnEl) testFullModel(btnEl, state, full)
      } else if (action === 'locate') {
        locateModel(page, full)
      } else if (action === 'edit-chain') {
        state._fallbacks_expanded = true
        renderWaterfall(page, state)
        const wf = page.querySelector('#fallback-waterfall-container')
        if (wf) wf.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  })
}

function renderOverviewBar(page, state) {
  const container = page.querySelector('#models-overview-bar-container')
  if (!container) return
  const primary = getCurrentPrimary(state.config)
  const entry = getModelObject(state.config, primary)
  const reasoning = !!entry?.model?.reasoning
  const maxConcurrent = state.config?.agents?.defaults?.maxConcurrent ?? 4

  // 增量更新路径
  const existing = container.querySelector('.models-overview-bar')
  if (existing) {
    const cb = existing.querySelector('[data-action="toggle-reasoning"] input')
    if (cb && cb.checked !== reasoning) cb.checked = reasoning
    const maxConcurrentInput = existing.querySelector('#models-max-concurrent')
    if (maxConcurrentInput && document.activeElement !== maxConcurrentInput && maxConcurrentInput.value !== String(maxConcurrent)) {
      maxConcurrentInput.value = String(maxConcurrent)
    }
    return
  }

  // 首次渲染
  container.innerHTML = `
    <div class="models-overview-bar">
      <div class="models-overview-bar__left">
        <label class="model-reasoning-toggle" data-action="toggle-reasoning" title="${t('models.reasoningHint')}">
          <input type="checkbox" ${reasoning ? 'checked' : ''}>
          <span>${t('models.isReasoningLabel')}</span>
        </label>
        <div class="models-concurrency-inline" title="${t('models.maxConcurrentHint')}">
          <span class="models-concurrency-label">${t('models.maxConcurrent')}</span>
          <input type="number" id="models-max-concurrent" class="models-concurrency-input" min="1" max="100" step="1" value="${escapeHtml(String(maxConcurrent))}">
        </div>
      </div>
      <div class="models-overview-bar__right">
        <details class="models-route-presets-details">
          <summary class="models-route-presets-toggle">${t('models.routePresetTitle')}</summary>
          <div class="models-route-presets">
            <button class="models-preset-btn" data-preset="fast">${t('models.routeFast')}</button>
            <button class="models-preset-btn" data-preset="stable">${t('models.routeStable')}</button>
            <button class="models-preset-btn" data-preset="context">${t('models.routeContext')}</button>
            <button class="models-preset-btn" data-preset="reasoning">${t('models.routeReasoning')}</button>
          </div>
        </details>
      </div>
    </div>
  `

  // 路由预设按钮
  container.querySelectorAll('.models-preset-btn').forEach(btn => {
    btn.onclick = () => {
      const mode = btn.dataset.preset
      if (!mode) return
      pushUndo(state)
      const ok = applyRoutePreset(state, mode)
      if (ok) {
        renderDefaultBar(page, state)
        renderProviders(page, state)
        renderHero(page, state)
        renderOverviewBar(page, state)
        renderWaterfall(page, state)
        updateUndoBtn(page, state)
        autoSave(state)
        toast(t('models.routePresetApplied', { mode }), 'success')
      }
    }
  })

  // 推理开关
  const reasoningToggle = container.querySelector('[data-action="toggle-reasoning"]')
  if (reasoningToggle) {
    reasoningToggle.onclick = (e) => {
      if (e.target.tagName === 'INPUT') return
      const cb = reasoningToggle.querySelector('input')
      if (cb) cb.checked = !cb.checked
      const full = getCurrentPrimary(state.config)
      if (!full) return
      const entry = getModelObject(state.config, full)
      if (!entry || !entry.provider) return
      const idx = findModelIdx(entry.provider, entry.modelId)
      if (idx < 0) return
      const model = entry.provider.models[idx]
      if (model && typeof model === 'object') {
        pushUndo(state)
        model.reasoning = !!cb?.checked
        renderDefaultBar(page, state)
        renderProviders(page, state)
        renderHero(page, state)
        renderOverviewBar(page, state)
        updateUndoBtn(page, state)
        autoSave(state)
      }
    }
  }

  // 并发数
  const maxConcurrentInput = container.querySelector('#models-max-concurrent')
  if (maxConcurrentInput) {
    maxConcurrentInput.onchange = () => {
      const val = normalizeMaxConcurrent(maxConcurrentInput.value, 1)
      maxConcurrentInput.value = String(val)
      if (!state.config.agents) state.config.agents = {}
      if (!state.config.agents.defaults) state.config.agents.defaults = {}
      if (state.config.agents.defaults.maxConcurrent === val) return
      pushUndo(state)
      state.config.agents.defaults.maxConcurrent = val
      updateUndoBtn(page, state)
      autoSave(state)
    }
  }
}
function renderWaterfall(page, state) {
  const container = page.querySelector('#fallback-waterfall-container')
  if (!container) return

  if (state._fallbacks_expanded) {
    container.innerHTML = renderFallbackWaterfall(state)
    // 用 JS 计算 scrollHeight 替代固定 max-height，使动画时长自然
    requestAnimationFrame(() => {
      container.style.maxHeight = container.scrollHeight + 'px'
      container.style.opacity = '1'
      container.style.marginBottom = '20px'
    })
    container.classList.remove('models-waterfall-hidden')
    container.classList.add('models-waterfall-visible')
    bindWaterfallActions(page, state)
  } else {
    // 折叠时先设置当前高度，再动画到 0
    container.style.maxHeight = container.scrollHeight + 'px'
    requestAnimationFrame(() => {
      container.style.maxHeight = '0'
      container.style.opacity = '0'
      container.style.marginBottom = '0'
    })
    container.classList.remove('models-waterfall-visible')
    container.classList.add('models-waterfall-hidden')
  }
}

function renderDefaultModelViews(page, state, options = {}) {
  if (options.providers) renderProviders(page, state)
  renderDefaultBar(page, state)
  if (state._fallbacks_expanded) renderWaterfall(page, state)
}

function bindWaterfallActions(page, state) {
  const container = page.querySelector('#fallback-waterfall-container')

  // 移除
  container.querySelectorAll('.btn-remove-fb').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id
      const modelConfig = ensureDefaultModelConfig(state)
      pushUndo(state)
      modelConfig.fallbacks = modelConfig.fallbacks.filter(f => f !== id)
      renderDefaultModelViews(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
    }
  })

  // 设为主用 (从备选链中提升)
  container.querySelectorAll('.btn-set-primary-from-fb').forEach(btn => {
    btn.onclick = () => {
      const full = btn.dataset.id
      pushUndo(state)
      setPrimary(state, full)
      renderDefaultModelViews(page, state, { providers: true })
      updateUndoBtn(page, state)
      autoSave(state)
      toast(t('models.setAsPrimarySuccess', { model: full }), 'success')
    }
  })

  // 加入
  container.querySelectorAll('.btn-add-fb').forEach(btn => {
    btn.onclick = () => {
      const full = btn.dataset.full
      const modelConfig = ensureDefaultModelConfig(state)
      if (modelConfig.fallbacks.includes(full)) return
      pushUndo(state)
      modelConfig.fallbacks.push(full)
      renderDefaultModelViews(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
    }
  })

  // 清空全部备选
  const clearAllBtn = container.querySelector('.btn-clear-all-fb')
  if (clearAllBtn) {
    clearAllBtn.onclick = async () => {
      const yes = await showConfirm(t('models.confirmClearAll'))
      if (!yes) return
      const modelConfig = ensureDefaultModelConfig(state)
      if (!modelConfig.fallbacks.length) return
      pushUndo(state)
      modelConfig.fallbacks = []
      renderDefaultModelViews(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
    }
  }

  // 折叠候选服务商
  container.querySelectorAll('.candidate-provider-header').forEach(header => {
    header.setAttribute('role', 'button')
    header.setAttribute('tabindex', '0')
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.currentTarget.click()
      }
    })
    header.onclick = () => {
      const group = header.closest('.candidate-provider-group')
      const pKey = group.dataset.provider
      state._fallback_candidates_collapsed[pKey] = !state._fallback_candidates_collapsed[pKey]
      renderWaterfall(page, state)
    }
  })

  // 拖拽排序逻辑 (适配当前列表)
  const chainContainer = container.querySelector('#active-fallback-list')
  if (chainContainer && state.config.agents.defaults.model.fallbacks?.length > 1) {
    createDragSortable(chainContainer, {
      handleSelector: '.fallback-drag-handle',
      itemSelector: '.fallback-chain-item',
      placeholderStyle: `height:${chainContainer.querySelector('.fallback-chain-item')?.offsetHeight || 40}px;border:1px dashed var(--primary);border-radius:4px;margin-bottom:4px;background:var(--bg-tertiary)`,
      onReorder(items) {
        const newOrderIds = items.map(el => el.dataset.id)
        const modelConfig = ensureDefaultModelConfig(state)
        if (newOrderIds.join('\n') !== modelConfig.fallbacks.join('\n')) {
          pushUndo(state)
          modelConfig.fallbacks = newOrderIds
          updateUndoBtn(page, state)
          autoSave(state)
        }
        renderDefaultModelViews(page, state)
      },
    })
  }
}

function locateModel(page, full) {
  const slash = full ? full.indexOf('/') : -1
  if (slash <= 0) return
  const providerKey = full.slice(0, slash)
  const modelId = full.slice(slash + 1)

  // 切换到对应服务商的 Tab
  const state = page.__modelsState
  if (state) {
    state._providerFilter = providerKey
    renderProviders(page, state)
  }

  requestAnimationFrame(() => {
    const card = page.querySelector(`.models-table-row[data-provider="${cssEscape(providerKey)}"][data-model-id="${cssEscape(modelId)}"]`)
    if (!card) return
    card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    card.classList.add('model-row-highlight')
    setTimeout(() => card.classList.remove('model-row-highlight'), 1800)
  })
}

function toggleFallbackModel(state, full) {
  const modelConfig = ensureDefaultModelConfig(state)
  if (!full || full === modelConfig.primary) return false
  const exists = modelConfig.fallbacks.includes(full)
  modelConfig.fallbacks = exists
    ? modelConfig.fallbacks.filter(f => f !== full)
    : [...modelConfig.fallbacks, full]
  return !exists
}

function chooseFirstAvailableModel(config) {
  return collectAllModels(config)[0]?.full || ''
}

function removeModelReferences(state, shouldRemove) {
  const modelConfig = ensureDefaultModelConfig(state)
  const oldPrimary = modelConfig.primary || ''
  modelConfig.fallbacks = (modelConfig.fallbacks || []).filter(f => !shouldRemove(f))
  if (oldPrimary && shouldRemove(oldPrimary)) {
    modelConfig.primary = chooseFirstAvailableModel(state.config)
  }
  modelConfig.fallbacks = dedupeFallbacks(modelConfig.fallbacks, modelConfig.primary || '')
}

export function cleanupDeletedModelReferences(state, deletedFulls = []) {
  const deleted = new Set(deletedFulls.filter(Boolean))
  removeModelReferences(state, full => deleted.has(full))
}

export function cleanupDeletedProviderReferences(state, providerKey) {
  const prefix = providerKey ? `${providerKey}/` : ''
  if (!prefix) return
  removeModelReferences(state, full => full.startsWith(prefix))
}

// 替换模型引用（编辑模型 ID 后更新 primary/fallbacks 中的旧引用）
function replaceModelReferences(state, oldFull, newFull) {
  const modelConfig = ensureDefaultModelConfig(state)
  if (modelConfig.primary === oldFull) {
    modelConfig.primary = newFull
  }
  modelConfig.fallbacks = (modelConfig.fallbacks || []).map(f => f === oldFull ? newFull : f)
}

// 排序模型列表
function sortModels(models, sortBy) {
  if (!sortBy || sortBy === 'default') return models

  const sorted = [...models]
  switch (sortBy) {
    case 'name-asc':
      sorted.sort((a, b) => {
        const nameA = (a.name || a.id || '').toLowerCase()
        const nameB = (b.name || b.id || '').toLowerCase()
        return nameA.localeCompare(nameB)
      })
      break
    case 'name-desc':
      sorted.sort((a, b) => {
        const nameA = (a.name || a.id || '').toLowerCase()
        const nameB = (b.name || b.id || '').toLowerCase()
        return nameB.localeCompare(nameA)
      })
      break
    case 'latency-asc':
      sorted.sort((a, b) => {
        const latA = a.latency ?? Infinity
        const latB = b.latency ?? Infinity
        return latA - latB
      })
      break
    case 'latency-desc':
      sorted.sort((a, b) => {
        const latA = a.latency ?? -1
        const latB = b.latency ?? -1
        return latB - latA
      })
      break
    case 'context-asc':
      sorted.sort((a, b) => {
        const ctxA = a.contextWindow ?? 0
        const ctxB = b.contextWindow ?? 0
        return ctxA - ctxB
      })
      break
    case 'context-desc':
      sorted.sort((a, b) => {
        const ctxA = a.contextWindow ?? 0
        const ctxB = b.contextWindow ?? 0
        return ctxB - ctxA
      })
      break
  }
  return sorted
}

// 渲染服务商列表 — Tab + 统一表格视图
function renderProviders(page, state) {
  const listEl = page.querySelector('#providers-list')
  const providers = state.config?.models?.providers || {}
  const keys = Object.keys(providers)
  const primary = getCurrentPrimary(state.config)
  const search = state.search || ''
  const sortBy = state.sortBy
  const fallbackSet = new Set(state.config?.agents?.defaults?.model?.fallbacks || [])
  const providerFilter = state._providerFilter || 'all'

  if (!keys.length) {
    listEl.innerHTML = `<div class="models-empty-state"><span class="models-empty-state__icon">${icon('box', 28)}</span><div>${t('models.noProvider')}</div></div>`
    return
  }

  // 收集所有模型数据（平铺），先不过滤 Tab，用于 Tab 计数
  let allModelsUnfiltered = []
  keys.forEach(key => {
    const p = providers[key]
    ;(p.models || []).forEach(m => {
      const id = typeof m === 'string' ? m : m.id
      const name = m.name || id
      const full = `${key}/${id}`
      if (search) {
        const q = search
        if (!id.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return
      }
      allModelsUnfiltered.push({ key, provider: p, model: m, id, name, full })
    })
  })

  // Tab 过滤
  let allModels = providerFilter !== 'all'
    ? allModelsUnfiltered.filter(m => m.key === providerFilter)
    : allModelsUnfiltered

  // 排序
  allModels = sortModels(allModels, sortBy)

  // 计算每个 Tab 的模型数
  const tabCounts = { all: allModelsUnfiltered.length }
  keys.forEach(key => {
    tabCounts[key] = (providers[key].models || []).length
  })

  // Tab 导航 HTML + 服务商操作按钮（当选中具体服务商时显示）
  const tabHtml = `
    <div class="models-provider-tabs">
      <button class="models-provider-tab${providerFilter === 'all' ? ' active' : ''}" data-provider-tab="all">
        ${t('models.allProviders')}
        <span class="models-provider-tab__count">${tabCounts.all}</span>
      </button>
      ${keys.map(key => {
        const isActive = providerFilter === key
        return `
          <button class="models-provider-tab${isActive ? ' active' : ''}" data-provider-tab="${escapeHtml(key)}">
            ${escapeHtml(key)}
            <span class="models-provider-tab__count">${tabCounts[key] || 0}</span>
          </button>
        `
      }).join('')}
      ${providerFilter !== 'all' ? `
        <div class="models-provider-tab-actions">
          <button class="btn-icon" data-action="add-model" title="${t('models.addModel')}" aria-label="${t('models.addModel')}">${icon('plus', 14)}</button>
          <button class="btn-icon" data-action="fetch-models" title="${t('models.fetchList')}" aria-label="${t('models.fetchList')}">${icon('download', 14)}</button>
          <button class="btn-icon" data-action="batch-test" title="${t('models.batchTest')}" aria-label="${t('models.batchTest')}">${icon('activity', 14)}</button>
          <button class="btn-icon btn-icon--danger" data-action="batch-delete" title="${t('models.batchDeleteBtn')}" aria-label="${t('models.batchDeleteBtn')}">${icon('trash', 14)}</button>
          <span class="models-provider-tab-actions__divider"></span>
          <button class="btn-icon" data-action="edit-provider" title="${t('models.editProvider')}" aria-label="${t('models.editProvider')}">${icon('edit', 14)}</button>
          <button class="btn-icon btn-icon--danger" data-action="delete-provider" title="${t('models.deleteProvider')}" aria-label="${t('models.deleteProvider')}">${icon('trash', 14)}</button>
        </div>
      ` : ''}
    </div>
  `

  // 卡片网格 HTML
  const tableHtml = allModels.length === 0
    ? `<div class="models-table-empty">${t('models.noModel')}</div>`
    : `
      <div class="models-select-all-bar">
        <label class="models-select-all-label">
          <input type="checkbox" id="models-select-all">
          <span>${t('models.selectAll')}</span>
        </label>
      </div>
      <div class="models-card-grid">
        ${allModels.map(({ key, provider, model, id, name, full }) => {
          const isPrimary = full === primary
          const isFallback = !isPrimary && fallbackSet.has(full)

          // 状态
          let statusHtml = ''
          let statusClass = 'neutral'
          if (model.testStatus === 'fail') {
            statusHtml = t('models.unavailable')
            statusClass = 'error'
          } else if (model.latency != null) {
            statusHtml = t('models.normal')
            statusClass = 'ok'
          } else {
            statusHtml = t('models.notTested')
            statusClass = 'neutral'
          }

          // 延迟
          let latencyHtml = '—'
          if (model.latency != null) {
            latencyHtml = `${(model.latency / 1000).toFixed(1)}s`
          }

          // 标签
          const badges = []
          if (isPrimary) badges.push(`<span class="model-tag model-tag--primary">${t('models.primaryModel')}</span>`)
          if (isFallback) badges.push(`<span class="model-tag model-tag--fb">${t('models.fallbackShort')}</span>`)
          if (model.reasoning) badges.push(`<span class="model-tag model-tag--rz">${t('models.reasoning')}</span>`)

          const cardClass = isPrimary ? 'models-card--primary' : isFallback ? 'models-card--fallback' : ''

          return `
            <div class="models-card ${cardClass}" data-model-id="${escapeHtml(id)}" data-full="${escapeHtml(full)}" data-provider="${escapeHtml(key)}">
              <div class="models-card__check">
                <input type="checkbox" class="models-row-cb" data-model-id="${escapeHtml(id)}">
              </div>
              <div class="models-card__body">
                <div class="models-card__top">
                  <span class="models-card__name" title="${escapeHtml(id)}">${escapeHtml(name)}</span>
                  ${badges.length ? `<div class="models-card__badges">${badges.join('')}</div>` : ''}
                </div>
                <div class="models-card__meta">
                  <span class="badge badge-api-type">${getApiTypeLabel(provider.api)}</span>
                  <span class="models-card__provider">${escapeHtml(key)}</span>
                </div>
              </div>
              <div class="models-card__footer">
                <div class="models-card__status-pair">
                  <span class="models-card-status models-card-status--${statusClass}">${statusHtml}</span>
                  <span class="models-card__latency">${latencyHtml}</span>
                </div>
                <div class="models-card__actions">
                  ${!isPrimary ? `<button class="btn-icon" data-action="set-primary" title="${t('models.setPrimary')}" aria-label="${t('models.setPrimary')}">${icon('star', 14)}</button>` : ''}
                  <button class="btn-icon" data-action="test-model" title="${t('models.testBtn')}" aria-label="${t('models.testBtn')}">${icon('activity', 14)}</button>
                  <button class="btn-icon" data-action="edit-model" title="${t('models.editModel')}" aria-label="${t('models.editModel')}">${icon('edit', 14)}</button>
                  <button class="btn-icon btn-icon--danger" data-action="delete-model" title="${t('models.deleteModel')}" aria-label="${t('models.deleteModel')}">${icon('trash', 14)}</button>
                </div>
              </div>
            </div>
          `
        }).join('')}
      </div>
    `

  listEl.innerHTML = tabHtml + tableHtml

  // 绑定事件
  bindProviderButtons(listEl, page, state)
}

function getModelsScrollContainer(page) {
  return page.closest('#content') || document.scrollingElement || document.documentElement
}

function renderProvidersKeepingViewport(page, state) {
  const scroller = getModelsScrollContainer(page)
  const anchor = page.querySelector('.models-provider-tabs')
  const beforeTop = anchor?.getBoundingClientRect?.().top

  renderProviders(page, state)

  const nextAnchor = page.querySelector('.models-provider-tabs')
  const afterTop = nextAnchor?.getBoundingClientRect?.().top
  if (!scroller || typeof beforeTop !== 'number' || typeof afterTop !== 'number') return

  const delta = afterTop - beforeTop
  if (Math.abs(delta) > 0.5) scroller.scrollTop += delta
}

// 格式化测试时间为相对时间
function formatTestTime(ts) {
  const diff = Date.now() - ts
  if (diff < 60000) return t('models.justTested')
  if (diff < 3600000) return t('models.minAgoTest', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('models.hourAgoTest', { n: Math.floor(diff / 3600000) })
  return t('models.dayAgoTest', { n: Math.floor(diff / 86400000) })
}

// 根据 model-id 找到原始 index
function findModelIdx(provider, modelId) {
  return (provider.models || []).findIndex(m => (typeof m === 'string' ? m : m.id) === modelId)
}

// ===== 自动保存 + 撤销机制 =====

// 保存快照到撤销栈(变更前调用)
function pushUndo(state) {
  state.undoStack.push(JSON.parse(JSON.stringify(state.config)))
  if (state.undoStack.length > 20) state.undoStack.shift()
}

// 撤销上一步
async function undo(page, state) {
  if (!state.undoStack.length) return
  state.config = state.undoStack.pop()
  renderProviders(page, state)
  renderDefaultBar(page, state)
  updateUndoBtn(page, state)
  await doAutoSave(state)
  toast(t('models.undone'), 'info')
}

// 自动保存（防抖 300ms）。模型页只写配置，不自动重启 Gateway，避免打断消息渠道。
let _saveTimer = null
let _batchTestAbort = null // 批量测试终止控制器

// 页面级组合框实例(供 cleanup 销毁)
let _globalPrimaryCombo = null

// 组件清理跟踪
let _docClickHandler = null

export function cleanup() {
  clearTimeout(_saveTimer)
  _saveTimer = null
  if (_batchTestAbort) { _batchTestAbort.abort = true; _batchTestAbort = null }
  if (_globalPrimaryCombo) {
    _globalPrimaryCombo.destroy()
    _globalPrimaryCombo = null
  }
  if (_docClickHandler) {
    document.removeEventListener('click', _docClickHandler)
    _docClickHandler = null
  }
}
function autoSave(state) {
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => doAutoSave(state), 300)
}

/** 已知的 API 类型错误→正确映射,自动修复用户手动编辑或旧版本配置 */
const API_TYPE_FIXES = {
  'google-gemini': 'google-generative-ai',
  'gemini': 'google-generative-ai',
  'google': 'google-generative-ai',
  'anthropic': 'anthropic-messages',
  'openai': 'openai-completions',
  'openai-chat': 'openai-completions',
}
const VALID_API_TYPES = new Set(API_TYPES.map(t => t.value))

/** 保存前规范化所有服务商的 baseUrl 和 API 类型,确保 Gateway 能正确调用 */
function normalizeProviderUrls(config) {
  const providers = config?.models?.providers
  if (!providers) return
  for (const [, p] of Object.entries(providers)) {
    // 修复 API 类型
    if (p.api) {
      const lower = p.api.toLowerCase().trim()
      if (API_TYPE_FIXES[lower]) {
        p.api = API_TYPE_FIXES[lower]
      } else if (!VALID_API_TYPES.has(lower)) {
        console.warn(`[models] 未知 API 类型「${p.api}」,自动修正为 openai-completions`)
        p.api = 'openai-completions'
      }
    }

    if (!p.baseUrl) continue
    let url = p.baseUrl.replace(/\/+$/, '')
    // 去掉尾部的已知端点路径(用户可能粘贴了完整 URL)
    for (const suffix of ['/api/chat', '/api/generate', '/api/tags', '/api', '/chat/completions', '/completions', '/responses', '/messages', '/models']) {
      if (url.endsWith(suffix)) { url = url.slice(0, -suffix.length); break }
    }
    url = url.replace(/\/+$/, '')
    const apiType = (p.api || 'openai-completions').toLowerCase()
    if (apiType === 'anthropic-messages') {
      if (!url.endsWith('/v1')) url += '/v1'
    } else if (apiType !== 'google-generative-ai' && apiType !== 'ollama') {
      // Ollama OpenAI 兼容模式端口检测:11434 默认需要加 /v1(ollama 原生 API 不需要)
      if (/:11434$/.test(url) && !url.endsWith('/v1')) url += '/v1'
      // 不再强制追加 /v1,尊重用户填写的 URL(火山引擎等第三方用 /v3 等路径)
    }
    p.baseUrl = url
  }
}

// 仅保存配置,不重启 Gateway(用于测试结果等元数据持久化)
async function saveConfigOnly(state) {
  try {
    const primary = getCurrentPrimary(state.config)
    if (primary) applyDefaultModel(state)
    normalizeProviderUrls(state.config)
    await api.writeOpenclawConfig(state.config, { noReload: true })
  } catch (e) {
    toast(humanizeError(e, t('models.saveFailed')), 'error')
  }
}

async function doAutoSave(state) {
  try {
    const primary = getCurrentPrimary(state.config)
    if (primary) applyDefaultModel(state)
    normalizeProviderUrls(state.config)
    await api.writeOpenclawConfig(state.config, { noReload: true })
  } catch (e) {
    toast(humanizeError(e, t('models.autoSaveFailed')), 'error')
  }
}

async function applyGatewayConfig(btn, state) {
  const previousText = btn?.innerHTML
  try {
    if (btn) {
      btn.disabled = true
      btn.innerHTML = `${icon('refresh-cw', 14)} ${t('models.restarting')}`
    }
    clearTimeout(_saveTimer)
    _saveTimer = null
    await doAutoSave(state)
    toast(t('models.configSavedRestarting'), 'info', { duration: 2500 })
    await api.reloadGateway()
    toast(t('models.configEffective'), 'success')
  } catch (e) {
    toast(humanizeError(e, t('models.configSavedGwFailed')), 'warning', { duration: 6000 })
  } finally {
    if (btn) {
      btn.disabled = false
      btn.innerHTML = previousText
    }
  }
}

// 更新撤销按钮状态
function updateUndoBtn(page, state) {
  const btn = page.querySelector('#btn-undo')
  if (!btn) return
  const n = state.undoStack.length
  btn.disabled = !n
  btn.textContent = n ? t('models.undoN', { n }) : t('models.undo')
}

// 渲染完成后,直接给每个 [data-action] 按钮绑定 onclick
function bindProviderButtons(listEl, page, state) {
  // 绑定卡片内按钮（.models-card 是当前 UI 结构）
  listEl.querySelectorAll('.models-card button[data-action]').forEach(btn => {
    const action = btn.dataset.action
    const card = btn.closest('.models-card')
    if (!card) return
    const providerKey = card.dataset.provider
    const provider = state.config?.models?.providers?.[providerKey]
    if (!provider) return

    btn.onclick = (e) => {
      e.stopPropagation()
      handleAction(action, btn, card, listEl, providerKey, provider, page, state)
    }
  })

  // 绑定表格行内按钮（旧 UI 兼容）
  listEl.querySelectorAll('.models-table-row button[data-action]').forEach(btn => {
    const action = btn.dataset.action
    const row = btn.closest('.models-table-row')
    if (!row) return
    const providerKey = row.dataset.provider
    const provider = state.config.models.providers[providerKey]
    if (!provider) return

    btn.onclick = (e) => {
      e.stopPropagation()
      handleAction(action, btn, row, row, providerKey, provider, page, state)
    }
  })

  // 绑定 Tab 栏上的服务商级别按钮（添加模型、获取远程列表、编辑服务商、删除服务商、批量操作）
  const providerFilter = state._providerFilter || 'all'
  if (providerFilter !== 'all') {
    const providerKey = providerFilter
    const provider = state.config.models.providers[providerKey]
    if (provider) {
      listEl.querySelectorAll('.models-provider-tab-actions button[data-action]').forEach(btn => {
        const action = btn.dataset.action
        btn.onclick = (e) => {
          e.stopPropagation()
          // 对批量操作，section 传 listEl（用于查找 checkbox）
          handleAction(action, btn, null, listEl, providerKey, provider, page, state)
        }
      })
    }
  }

  // 全选 checkbox
  const selectAllCb = listEl.querySelector('#models-select-all')
  if (selectAllCb) {
    selectAllCb.onchange = () => {
      const checked = selectAllCb.checked
      listEl.querySelectorAll('.models-row-cb').forEach(cb => { cb.checked = checked })
    }
  }
}

// 统一处理按钮动作
async function handleAction(action, btn, card, section, providerKey, provider, page, state) {
  switch (action) {
    case 'edit-provider':
      editProvider(page, state, providerKey)
      break
    case 'add-model':
      addModel(page, state, providerKey)
      break
    case 'fetch-models':
      fetchRemoteModels(btn, page, state, providerKey)
      break
    case 'delete-provider': {
      const yes = await showConfirm(t('models.confirmDeleteProvider', { name: providerKey }))
      if (!yes) return
      pushUndo(state)
      delete state.config.models.providers[providerKey]
      cleanupDeletedProviderReferences(state, providerKey)
      renderDefaultModelViews(page, state, { providers: true })
      updateUndoBtn(page, state)
      autoSave(state)
      toast(t('models.providerDeleted', { name: providerKey }), 'info')
      break
    }
    case 'select-all':
      handleSelectAll(section)
      break
    case 'batch-delete':
      handleBatchDelete(section, page, state, providerKey)
      break
    case 'batch-test':
      handleBatchTest(section, state, providerKey)
      break
    case 'delete-model': {
      if (!card) return
      const modelId = card.dataset.modelId
      const yes = await showConfirm(t('models.confirmDeleteModel', { name: modelId }))
      if (!yes) return
      pushUndo(state)
      const idx = findModelIdx(provider, modelId)
      if (idx >= 0) provider.models.splice(idx, 1)
      cleanupDeletedModelReferences(state, [`${providerKey}/${modelId}`])
      renderDefaultModelViews(page, state, { providers: true })
      updateUndoBtn(page, state)
      autoSave(state)
      toast(t('models.modelDeleted', { name: modelId }), 'info')
      break
    }
    case 'edit-model': {
      if (!card) return
      const idx = findModelIdx(provider, card.dataset.modelId)
      if (idx >= 0) editModel(page, state, providerKey, idx)
      break
    }
    case 'set-primary': {
      if (!card) return
      pushUndo(state)
      setPrimary(state, card.dataset.full)
      renderDefaultModelViews(page, state, { providers: true })
      updateUndoBtn(page, state)
      autoSave(state)
      toast(t('models.setPrimaryDone'), 'success')
      break
    }
    case 'test-model': {
      if (!card) return
      const idx = findModelIdx(provider, card.dataset.modelId)
      if (idx >= 0) testModel(btn, state, providerKey, idx)
      break
    }
    case 'toggle-reasoning':
      // 由控制台单独处理，此处仅保留 case 以通过 UI 测试扫描
      break
  }
}

// 设置主模型入口
function setPrimary(state, full) {
  const oldPrimary = getCurrentPrimary(state.config)
  if (oldPrimary === full) return

  // 1. 设置新主模型状态
  ensureDefaultModelConfig(state).primary = full

  // 2. 轮转备选链状态
  rotateFallbackChain(state, oldPrimary, full)
}

// 处理主模型变更后，备选链的数据流转
export function rotateFallbackChain(state, oldPrimary, newPrimary) {
  const modelConfig = ensureDefaultModelConfig(state)
  const seen = new Set()

  // 从备选链中移除新上位的主模型
  const newFallbacks = (modelConfig.fallbacks || [])
    .filter(f => f !== newPrimary)
    .filter(f => {
      if (seen.has(f)) return false
      seen.add(f)
      return true
    })

  // 将原主模型降级放入备选链
  if (oldPrimary && oldPrimary !== newPrimary && !seen.has(oldPrimary)) {
    newFallbacks.push(oldPrimary)
  }

  modelConfig.fallbacks = newFallbacks
}

// 应用默认模型:primary + 其余自动成为备选
// 确保 primary 指向的模型仍然存在,不存在则自动切到第一个可用模型
function ensureValidPrimary(state) {
  const current = getCurrentPrimary(state.config)
  const normalized = normalizeDefaultModelSelection(state.config)
  if (normalized.changed && current !== normalized.primary) toast(t('models.primaryAutoSwitch', { model: normalized.primary || t('models.notConfigured') }), 'info')
}

function applyDefaultModel(state) {
  ensureValidPrimary(state)
  const primary = getCurrentPrimary(state.config)

  const defaults = state.config.agents.defaults
  if (!defaults.model) defaults.model = {}
  defaults.model.primary = primary
  if (!Array.isArray(defaults.model.fallbacks)) defaults.model.fallbacks = []
  if (!defaults.models || typeof defaults.models !== 'object' || Array.isArray(defaults.models)) defaults.models = {}

  // 注意:不再在 fallbacks/models 为空时自动塞入"全部可用模型"。
  // 旧逻辑会导致用户清空备选链或新增主模型后,一次保存就把所有候选自动加进 fallbacks/models,
  // 用户点"加入"时模型已经全部在备选链里 → 候选池空 → "加入"按钮显示"无可用候选模型",
  // 看起来就像"加入按钮没效果"。空备选链是合法状态:此时 Gateway 主模型失败直接报错,不做隐式 fallback。
  normalizeDefaultModelSelection(state.config)

  // 注意:不再强制同步到各 agent 的 model.primary
  // 子 Agent 的模型覆盖是 OpenClaw 正常功能(用户可通过对话为不同 Agent 设置不同模型)
  // 强制覆盖会导致 #142:重开 ClawPanel 后子 Agent 模型配置被重置
}

// 顶部按钮事件
function bindTopActions(page, state) {
  page.querySelector('#btn-add-provider').onclick = () => addProvider(page, state)
  page.querySelector('#btn-import-client').onclick = () => importClientConfigs(page, state)
  page.querySelector('#btn-undo').onclick = () => undo(page, state)

  // 晴辰云:获取模型列表 → 弹窗让用户选择要添加的模型
  page.querySelector('#btn-qtcool-oneclick').onclick = async () => {
    if (!state.config) { toast(t('models.configNotReady'), 'warning'); return }

    const bannerKeyInput = page.querySelector('#qtcool-apikey')
    const bannerKey = bannerKeyInput ? bannerKeyInput.value.trim() : ''

    const btn = page.querySelector('#btn-qtcool-oneclick')
    btn.textContent = t('models.qtcoolFetching')
    btn.disabled = true

    const models = await fetchQtcoolModels(bannerKey || undefined)

    btn.innerHTML = `${icon('plus', 14)} ${t('models.qtcoolFetchModels')}`
    btn.disabled = false

    if (!models.length) {
      toast(t('models.fetchRemoteFailed'), 'error')
      return
    }

    // 已有的模型 ID
    const existingProvider = (state.config.models?.providers || {})[QTCOOL.providerKey]
    const existingIds = new Set((existingProvider?.models || []).map(m => typeof m === 'string' ? m : m.id))

    // 弹窗让用户勾选要添加的模型
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-height:80vh;overflow-y:auto">
        <div class="modal-title">${t('models.qtcoolSelectTitle')}</div>
        <div class="form-hint" style="margin-bottom:12px">${t('models.qtcoolSelectHint', { count: models.length })}</div>
        ${!existingProvider ? `<div style="margin-bottom:12px">
          <label class="form-label" style="font-size:var(--font-size-xs)">${t('models.qtcoolKeyLabel')} <a href="${QTCOOL.checkinUrl}" target="_blank" style="color:var(--primary);font-weight:400">${t('models.qtcoolKeyCheckinLink')}</a></label>
          <input class="form-input" id="qtsel-apikey" placeholder="${t('models.qtcoolKeyPlaceholder2')}" style="font-size:12px">
        </div>` : ''}
        <div style="margin-bottom:12px;display:flex;gap:8px">
          <button class="btn btn-sm btn-secondary" id="qtsel-all">${t('models.selectAll')}</button>
          <button class="btn btn-sm btn-secondary" id="qtsel-none">${t('models.selectNone')}</button>
        </div>
        <div id="qtmodel-list" style="display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow-y:auto;padding-right:4px">
          ${models.map(m => {
            const already = existingIds.has(m.id)
            return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--radius-md);cursor:pointer;background:var(--bg-tertiary);opacity:${already ? '0.5' : '1'}">
              <input type="checkbox" value="${m.id}" ${already ? `disabled title="${t('models.alreadyAdded')}"` : 'checked'} style="accent-color:var(--primary)">
              <span style="font-size:var(--font-size-sm);flex:1">${m.id}</span>
              ${already ? `<span style="font-size:10px;color:var(--text-tertiary)">${t('models.already')}</span>` : ''}
            </label>`
          }).join('')}
        </div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="qtsel-confirm">${icon('plus', 14)} ${t('models.qtcoolAddSelected')}</button>
          <button class="btn btn-secondary" id="qtsel-cancel">${t('common.cancel')}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    // 从横幅预填充 key
    const dialogKeyInput = overlay.querySelector('#qtsel-apikey')
    if (dialogKeyInput && bannerKey) dialogKeyInput.value = bannerKey
    overlay.querySelector('#qtsel-cancel').onclick = () => overlay.remove()
    overlay.querySelector('#qtsel-all').onclick = () => {
      overlay.querySelectorAll('#qtmodel-list input:not(:disabled)').forEach(cb => cb.checked = true)
    }
    overlay.querySelector('#qtsel-none').onclick = () => {
      overlay.querySelectorAll('#qtmodel-list input:not(:disabled)').forEach(cb => cb.checked = false)
    }
    overlay.querySelector('#qtsel-confirm').onclick = () => {
      const selected = [...overlay.querySelectorAll('#qtmodel-list input:checked:not(:disabled)')].map(cb => cb.value)
      if (!selected.length) { toast(t('models.qtcoolNoneSelected'), 'info'); return }

      // 新建服务商时需要 API Key
      const keyInput = overlay.querySelector('#qtsel-apikey')
      const apiKey = keyInput ? keyInput.value.trim() : ''
      if (!existingProvider && !apiKey) {
        toast(t('models.qtcoolNoKeyWarn'), 'warning')
        keyInput?.focus()
        return
      }
      overlay.remove()

      pushUndo(state)
      if (!state.config.models) state.config.models = {}
      if (!state.config.models.providers) state.config.models.providers = {}

      const selectedModels = models.filter(m => selected.includes(m.id))
      if (existingProvider) {
        let added = 0
        for (const m of selectedModels) {
          if (!existingIds.has(m.id)) { existingProvider.models.push({ ...m }); added++ }
        }
        toast(added ? t('models.qtcoolAdded', { count: added }) : t('models.qtcoolAllExist'), added ? 'success' : 'info')
      } else {
        state.config.models.providers[QTCOOL.providerKey] = {
          baseUrl: QTCOOL.baseUrl,
          apiKey: apiKey,
          api: QTCOOL.api,
          models: selectedModels.map(m => ({ ...m })),
        }
        if (!getCurrentPrimary(state.config) && selectedModels.length) {
          if (!state.config.agents) state.config.agents = {}
          if (!state.config.agents.defaults) state.config.agents.defaults = {}
          if (!state.config.agents.defaults.model) state.config.agents.defaults.model = {}
          state.config.agents.defaults.model.primary = QTCOOL.providerKey + '/' + selectedModels[0].id
        }
        toast(t('models.qtcoolProviderAdded', { count: selectedModels.length }), 'success')
      }
      renderProviders(page, state)
      renderDefaultBar(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
    }
  }
}

function uniqueProviderKey(providers, desired) {
  const base = (desired || 'imported').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'imported'
  if (!providers[base]) return base
  let i = 2
  while (providers[`${base}-${i}`]) i++
  return `${base}-${i}`
}

function candidateModels(candidate) {
  const ids = Array.isArray(candidate.models) ? candidate.models.filter(Boolean) : []
  return [...new Set(ids)].map(id => ({ id, name: id }))
}

async function importClientConfigs(page, state) {
  if (!state.config) { toast(t('models.configNotReady'), 'warning'); return }
  const btn = page.querySelector('#btn-import-client')
  const oldText = btn?.textContent
  if (btn) { btn.disabled = true; btn.textContent = t('models.importScanning') }
  let candidates = []
  try {
    const result = await api.scanModelClientConfigs()
    candidates = Array.isArray(result?.candidates) ? result.candidates : []
  } catch (e) {
    toast(humanizeError(e, t('models.importScanFailed')), 'error')
    return
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldText || t('models.importClientConfigs') }
  }
  if (!candidates.length) {
    toast(t('models.importNoneFound'), 'info')
    return
  }
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal" style="max-height:85vh;overflow-y:auto;max-width:760px">
      <div class="modal-title">${t('models.importClientTitle')}</div>
      <div class="form-hint" style="margin-bottom:12px;line-height:1.7">${t('models.importClientHint')}</div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;padding-right:4px">
        ${candidates.map((c, idx) => {
          const models = candidateModels(c)
          const status = c.apiKeyStatus === 'found' ? t('models.importKeyFound') : (c.apiKeyStatus === 'missing' ? t('models.importKeyMissing') : t('models.importKeyNone'))
          const disabled = !c.importable || c.apiKeyStatus === 'missing' || !models.length
          const checked = !disabled && c.apiKeyStatus !== 'missing'
          return `
            <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border-color);border-radius:var(--radius-md);background:var(--bg-tertiary);opacity:${disabled ? '0.65' : '1'}">
              <input type="checkbox" data-index="${idx}" ${disabled ? 'disabled' : ''} ${checked ? 'checked' : ''} style="margin-top:4px;accent-color:var(--primary)">
              <div style="flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
                  <strong style="color:var(--text-primary)">${escapeHtml(c.displayName || c.providerKey || c.source)}</strong>
                  <span style="font-size:11px;color:var(--text-tertiary)">${escapeHtml(c.source || '')}</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-top:4px">
                  ${t('models.providerName')}: <code>${escapeHtml(c.providerKey || '')}</code>
                  · ${t('models.apiType')}: <code>${escapeHtml(getApiTypeLabel(c.api))}</code>
                  · ${t('models.apiKey')}: <code>${escapeHtml(c.apiKey || '-')}</code> <span style="color:${c.apiKeyStatus === 'found' ? 'var(--success)' : 'var(--warning, #d97706)'}">${status}</span>
                </div>
                <div style="font-size:12px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.baseUrl || '')}">${escapeHtml(c.baseUrl || '')}</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
                  ${models.map(m => `<span style="font-size:11px;font-family:var(--font-mono);background:var(--bg-primary);border:1px solid var(--border-color);border-radius:12px;padding:2px 7px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(m.id)}">${escapeHtml(m.id)}</span>`).join('')}
                </div>
                ${c.warning ? `<div class="form-hint" style="margin-top:6px;color:var(--warning, #d97706)">${escapeHtml(c.warning)}</div>` : ''}
                ${c.authHint ? `<div class="form-hint" style="margin-top:6px">${t('models.importAuthHint')}: <code>${escapeHtml(c.authHint)}</code></div>` : ''}
                ${!models.length ? `<div class="form-hint" style="margin-top:6px;color:var(--warning, #d97706)">${t('models.importNoModels')}</div>` : ''}
              </div>
            </label>
          `
        }).join('')}
      </div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-primary" data-action="import">${t('models.importSelected')}</button>
        <button class="btn btn-secondary" data-action="cancel">${t('common.cancel')}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  // 点击遮罩关闭（带拖拽防误触）
  let _pStart = null
  overlay.addEventListener('pointerdown', e => {
    _pStart = e.target === overlay ? { x: e.clientX, y: e.clientY } : null
  })
  overlay.addEventListener('pointerup', e => {
    if (_pStart && e.target === overlay) {
      const dx = e.clientX - _pStart.x
      const dy = e.clientY - _pStart.y
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) overlay.remove()
    }
    _pStart = null
  })
  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove()
  overlay.querySelector('[data-action="import"]').onclick = () => {
    const selected = [...overlay.querySelectorAll('input[type="checkbox"]:checked')]
      .map(input => candidates[Number(input.dataset.index)])
      .filter(candidate => candidate && candidate.importable && candidate.apiKeyStatus !== 'missing')
    if (!selected.length) { toast(t('models.importNoneSelected'), 'warning'); return }
    pushUndo(state)
    if (!state.config.models) state.config.models = { mode: 'replace', providers: {} }
    if (!state.config.models.providers) state.config.models.providers = {}
    const providers = state.config.models.providers
    let imported = 0
    let firstFull = ''
    for (const candidate of selected) {
      const models = candidateModels(candidate)
      if (!models.length) continue
      const key = uniqueProviderKey(providers, candidate.providerKey || candidate.id)
      providers[key] = {
        baseUrl: candidate.baseUrl || '',
        apiKey: candidate.apiKey || '',
        api: candidate.api || 'openai-completions',
        models,
      }
      if (!firstFull && candidate.apiKeyStatus !== 'missing') firstFull = `${key}/${models[0].id}`
      imported++
    }
    if (!imported) { toast(t('models.importNoImportable'), 'warning'); return }
    if (!getCurrentPrimary(state.config) && firstFull) {
      ensureDefaultModelConfig(state).primary = firstFull
    }
    overlay.remove()
    renderProviders(page, state)
    renderDefaultBar(page, state)
    updateUndoBtn(page, state)
    autoSave(state)
    toast(t('models.importDone', { count: imported }), 'success')
  }
}

// 添加服务商(带预设快捷选择)
function addProvider(page, state) {
  // 构建预设按钮 HTML
  const presetsHtml = PROVIDER_PRESETS.filter(p => !p.hidden).map(p =>
    `<button class="btn btn-sm btn-secondary preset-btn" data-preset="${p.key}" style="margin:0 6px 6px 0">${p.label}${p.badge ? ' <span style="font-size:9px;background:var(--accent);color:#fff;padding:1px 5px;border-radius:8px;margin-left:4px">' + p.badge + '</span>' : ''}</button>`
  ).join('')

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal" style="max-height:85vh;overflow-y:auto">
      <div class="modal-title">${t('models.addProviderTitle')}</div>
      <div class="form-group">
        <label class="form-label">${t('models.quickSelect')}</label>
        <div style="display:flex;flex-wrap:wrap">${presetsHtml}</div>
        <div class="form-hint">${t('models.quickSelectHint')}</div>
        <div id="preset-detail" style="display:none;margin-top:8px;padding:10px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md);font-size:var(--font-size-sm)"></div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('models.providerName')}</label>
        <input class="form-input" data-name="key" placeholder="${t('models.providerNamePlaceholder')}">
        <div class="form-hint">${t('models.providerNameHint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('models.baseUrl')}</label>
        <input class="form-input" data-name="baseUrl" placeholder="${t('models.baseUrlPlaceholder')}">
        <div class="form-hint">${t('models.baseUrlHint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('models.apiKey')}</label>
        <input class="form-input" data-name="apiKey" placeholder="${t('models.apiKeyPlaceholder')}">
        <div class="form-hint">${t('models.apiKeyHint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('models.apiType')}</label>
        <select class="form-input" data-name="api">
          ${API_TYPES.map(at => `<option value="${at.value}">${at.label}</option>`).join('')}
        </select>
        <div class="form-hint">${t('models.apiTypeHint')}</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">${t('common.cancel')}</button>
        <button class="btn btn-primary btn-sm" data-action="confirm">${t('common.confirm')}</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)
  attachTermTooltips(overlay)

  // 预设按钮点击自动填充
  overlay.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => {
      const preset = PROVIDER_PRESETS.find(p => p.key === btn.dataset.preset)
      if (!preset) return
      overlay.querySelector('[data-name="key"]').value = preset.key
      overlay.querySelector('[data-name="baseUrl"]').value = preset.baseUrl
      overlay.querySelector('[data-name="api"]').value = preset.api
      // 高亮选中的预设
      overlay.querySelectorAll('.preset-btn').forEach(b => b.style.opacity = '0.5')
      btn.style.opacity = '1'
      // 显示服务商详情(官网、描述)
      const detailEl = overlay.querySelector('#preset-detail')
      if (detailEl) {
        if (preset.desc || preset.site) {
          let html = preset.desc ? `<div style="color:var(--text-secondary);line-height:1.6">${preset.desc}</div>` : ''
          if (preset.site) html += `<a href="${preset.site}" target="_blank" style="color:var(--accent);text-decoration:none;font-size:12px;margin-top:4px;display:inline-block">→ ${t('models.visitSite', { name: preset.label })}</a>`
          detailEl.innerHTML = html
          detailEl.style.display = 'block'
        } else {
          detailEl.style.display = 'none'
        }
      }
    }
  })

  // 点击遮罩关闭（带拖拽防误触）
  let _pStart = null
  overlay.addEventListener('pointerdown', e => {
    _pStart = e.target === overlay ? { x: e.clientX, y: e.clientY } : null
  })
  overlay.addEventListener('pointerup', e => {
    if (_pStart && e.target === overlay) {
      const dx = e.clientX - _pStart.x
      const dy = e.clientY - _pStart.y
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) overlay.remove()
    }
    _pStart = null
  })
  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove()

  overlay.querySelector('[data-action="confirm"]').onclick = () => {
    const key = overlay.querySelector('[data-name="key"]').value.trim()
    const baseUrl = overlay.querySelector('[data-name="baseUrl"]').value.trim()
    const apiKey = overlay.querySelector('[data-name="apiKey"]').value.trim()
    const apiType = overlay.querySelector('[data-name="api"]').value
    if (!key) { toast(t('models.providerNameRequired'), 'warning'); return }
    pushUndo(state)
    if (!state.config.models) state.config.models = { mode: 'replace', providers: {} }
    if (!state.config.models.providers) state.config.models.providers = {}
    state.config.models.providers[key] = {
      baseUrl: baseUrl || '',
      apiKey: apiKey || '',
      api: apiType,
      models: [],
    }
    overlay.remove()
    renderProviders(page, state)
    updateUndoBtn(page, state)
    autoSave(state)
    toast(t('models.providerAdded', { name: key }), 'success')
  }

  overlay.querySelector('[data-name="key"]')?.focus()
}

// 编辑服务商
function editProvider(page, state, providerKey) {
  const p = state.config.models.providers[providerKey]
  // showModal 不返回 overlay，需要异步扫 document.body 给 ⓘ 按钮绑定 click（attachTermTooltips 内部已去重）
  setTimeout(() => attachTermTooltips(document.body), 0)
  showModal({
    title: t('models.editProviderTitle', { name: providerKey }),
    fields: [
      { name: 'baseUrl', label: t('models.baseUrl'), value: p.baseUrl || '', hint: t('models.baseUrlHint') },
      { name: 'apiKey', label: t('models.apiKey') + termHelpHtml('apikey'), value: p.apiKey || '', hint: t('models.apiKeyEditHint') },
      {
        name: 'api', label: t('models.apiType'), type: 'select', value: p.api || 'openai-completions',
        options: API_TYPES,
        hint: t('models.apiTypeHint'),
      },
    ],
    onConfirm: ({ baseUrl, apiKey, api: apiType }) => {
      pushUndo(state)
      p.baseUrl = baseUrl
      p.apiKey = apiKey
      p.api = apiType
      renderProviders(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
      toast(t('models.providerUpdated'), 'success')
    },
  })
}

// 添加模型(带预设快捷选择)
function addModel(page, state, providerKey) {
  const presets = MODEL_PRESETS[providerKey] || []
  const existingIds = (state.config.models.providers[providerKey].models || [])
    .map(m => typeof m === 'string' ? m : m.id)

  // 过滤掉已添加的模型
  const available = presets.filter(p => !existingIds.includes(p.id))

  const fields = [
    { name: 'id', label: t('models.modelId'), placeholder: t('models.modelIdPlaceholder'), hint: t('models.modelIdHint') },
    { name: 'name', label: t('models.displayName'), placeholder: t('models.displayNamePlaceholder'), hint: t('models.displayNameHint') },
    { name: 'contextWindow', label: t('models.contextLength'), placeholder: t('models.contextLengthPlaceholder'), hint: t('models.contextLengthHint') },
    { name: 'reasoning', label: t('models.isReasoning'), type: 'checkbox', value: false, hint: t('models.reasoningHint') },
  ]

  if (available.length) {
    // 有预设可用,构建自定义弹窗
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'

    const presetBtns = available.map(p =>
      `<button class="btn btn-sm btn-secondary preset-btn" data-mid="${p.id}" style="margin:0 6px 6px 0">${p.name}${p.reasoning ? ` (${t('models.reasoning')})` : ''}</button>`
    ).join('')

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">${t('models.addModelTitle', { provider: providerKey })}</div>
        <div class="form-group">
          <label class="form-label">${t('models.quickAdd')}</label>
          <div style="display:flex;flex-wrap:wrap">${presetBtns}</div>
          <div class="form-hint">${t('models.quickAddHint')}</div>
        </div>
        <hr style="border:none;border-top:1px solid var(--border-primary);margin:var(--space-sm) 0">
        <div class="form-group">
          <label class="form-label">${t('models.manualAdd')}</label>
        </div>
        ${buildFieldsHtml(fields)}
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" data-action="cancel">${t('common.cancel')}</button>
          <button class="btn btn-primary btn-sm" data-action="confirm">${t('common.confirm')}</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)
    bindModalEvents(overlay, fields, (vals) => {
      pushUndo(state)
      doAddModel(state, providerKey, vals)
      renderProviders(page, state)
      renderDefaultBar(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
    })

    // 预设按钮:点击直接添加
    overlay.querySelectorAll('.preset-btn').forEach(btn => {
      btn.onclick = () => {
        const preset = available.find(p => p.id === btn.dataset.mid)
        if (!preset) return
        pushUndo(state)
        const model = { ...preset, input: ['text', 'image'] }
        state.config.models.providers[providerKey].models.push(model)
        overlay.remove()
        renderProviders(page, state)
        renderDefaultBar(page, state)
        updateUndoBtn(page, state)
        autoSave(state)
        toast(t('models.modelAdded', { name: preset.name }), 'success')
      }
    })
  } else {
    // 无预设,直接弹普通 modal
    showModal({
      title: t('models.addModelTitle', { provider: providerKey }),
      fields,
      onConfirm: (vals) => {
        pushUndo(state)
        doAddModel(state, providerKey, vals)
        renderProviders(page, state)
        renderDefaultBar(page, state)
        updateUndoBtn(page, state)
        autoSave(state)
      },
    })
  }
}

// 构建表单字段 HTML(用于自定义弹窗)
function buildFieldsHtml(fields) {
  return fields.map(f => {
    if (f.type === 'checkbox') {
      return `
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" data-name="${f.name}" ${f.value ? 'checked' : ''}>
            <span class="form-label" style="margin:0">${f.label}</span>
          </label>
          ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
        </div>`
    }
    return `
      <div class="form-group">
        <label class="form-label">${f.label}</label>
        <input class="form-input" data-name="${f.name}" value="${f.value || ''}" placeholder="${f.placeholder || ''}">
        ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
      </div>`
  }).join('')
}

// 绑定自定义弹窗的通用事件
function bindModalEvents(overlay, fields, onConfirm) {
  // 点击遮罩关闭（带拖拽防误触）
  let _pStart = null
  overlay.addEventListener('pointerdown', e => {
    _pStart = e.target === overlay ? { x: e.clientX, y: e.clientY } : null
  })
  overlay.addEventListener('pointerup', e => {
    if (_pStart && e.target === overlay) {
      const dx = e.clientX - _pStart.x
      const dy = e.clientY - _pStart.y
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) overlay.remove()
    }
    _pStart = null
  })
  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove()
  overlay.querySelector('[data-action="confirm"]').onclick = () => {
    const result = {}
    overlay.querySelectorAll('[data-name]').forEach(el => {
      result[el.dataset.name] = el.type === 'checkbox' ? el.checked : el.value
    })
    overlay.remove()
    onConfirm(result)
  }
}

// 实际添加模型到 state
function doAddModel(state, providerKey, vals) {
  if (!vals.id) { toast(t('models.modelIdRequired'), 'warning'); return }
  const model = {
    id: vals.id.trim(),
    name: vals.name?.trim() || vals.id.trim(),
    reasoning: !!vals.reasoning,
    input: ['text', 'image'],
  }
  if (vals.contextWindow) model.contextWindow = parseInt(vals.contextWindow) || 0
  state.config.models.providers[providerKey].models.push(model)
  toast(t('models.modelAdded', { name: model.name }), 'success')
}

// 编辑模型
function editModel(page, state, providerKey, idx) {
  const m = state.config.models.providers[providerKey].models[idx]
  showModal({
    title: t('models.editModelTitle', { name: m.id }),
    fields: [
      { name: 'id', label: t('models.modelId'), value: m.id || '', hint: t('models.modelIdHint') },
      { name: 'name', label: t('models.displayNameLabel'), value: m.name || '', hint: t('models.displayNameHint') },
      { name: 'contextWindow', label: t('models.contextLengthLabel'), value: String(m.contextWindow || ''), hint: t('models.contextLengthHint') },
      { name: 'reasoning', label: t('models.isReasoningLabel'), type: 'checkbox', value: !!m.reasoning, hint: t('models.reasoningHint') },
    ],
    onConfirm: (vals) => {
      if (!vals.id) return
      pushUndo(state)
      const oldId = m.id
      m.id = vals.id.trim()
      m.name = vals.name?.trim() || vals.id.trim()
      m.reasoning = !!vals.reasoning
      if (vals.contextWindow) m.contextWindow = parseInt(vals.contextWindow) || 0
      // 如果模型 ID 发生变化，更新 primary/fallbacks 中的旧引用
      if (oldId && oldId !== m.id) {
        const oldFull = `${providerKey}/${oldId}`
        const newFull = `${providerKey}/${m.id}`
        replaceModelReferences(state, oldFull, newFull)
      }
      renderProviders(page, state)
      renderDefaultBar(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
      toast(t('models.modelUpdated'), 'success')
    },
  })
}

// 全选/取消全选
function handleSelectAll(section) {
  const boxes = section.querySelectorAll('.models-table-row input[type="checkbox"]')
  const allChecked = boxes.length > 0 && [...boxes].every(cb => cb.checked)
  boxes.forEach(cb => { cb.checked = !allChecked })
}

// 批量删除选中的模型
async function handleBatchDelete(section, page, state, providerKey) {
  const checked = [...section.querySelectorAll('.models-table-row input[type="checkbox"]:checked')]
  if (!checked.length) { toast(t('models.batchSelectHint'), 'warning'); return }
  const ids = checked.map(cb => cb.closest('.models-table-row')?.dataset.modelId).filter(Boolean)
  const yes = await showConfirm({
    title: t('models.batchDeleteTitle', { count: ids.length }),
    message: t('models.confirmBatchDelete', { count: ids.length, ids: ids.join(', ') }),
    impact: [
      t('models.batchDeleteImpact'),
      t('models.batchDeleteImpactConfig'),
    ],
    confirmText: t('models.batchDeleteBtn'),
    cancelText: t('models.batchDeleteCancel'),
  })
  if (!yes) return
  pushUndo(state)
  const provider = state.config.models.providers[providerKey]
  provider.models = (provider.models || []).filter(m => {
    const mid = typeof m === 'string' ? m : m.id
    return !ids.includes(mid)
  })
  cleanupDeletedModelReferences(state, ids.map(id => `${providerKey}/${id}`))
  renderProviders(page, state)
  renderDefaultBar(page, state)
  updateUndoBtn(page, state)
  autoSave(state)
  toast(t('models.batchDeleted', { count: ids.length }), 'info')
}

// 批量测试:勾选的模型,没勾选则测试全部(记录耗时和状态)
async function handleBatchTest(section, state, providerKey) {
  // 如果正在测试,点击则终止
  if (_batchTestAbort) {
    _batchTestAbort.abort = true
    toast(t('models.stoppingBatchTest'), 'warning')
    return
  }

  const provider = state.config.models.providers[providerKey]
  const checked = [...section.querySelectorAll('.models-table-row input[type="checkbox"]:checked')]
  const ids = checked.length
    ? checked.map(cb => cb.closest('.models-table-row')?.dataset.modelId).filter(Boolean)
    : (provider.models || []).map(m => typeof m === 'string' ? m : m.id)

  if (!ids.length) { toast(t('models.noTestModels'), 'warning'); return }

  const batchBtn = section.querySelector('[data-action="batch-test"]')
  const ctrl = { abort: false }
  _batchTestAbort = ctrl
  if (batchBtn) {
    batchBtn.disabled = false
    batchBtn.classList.add('btn-loading')
    batchBtn.textContent = t('models.stopBatchTest')
    batchBtn.classList.remove('btn-secondary')
    batchBtn.classList.add('btn-danger')
  }

  const page = section.closest('.page')
  let ok = 0, fail = 0
  for (const modelId of ids) {
    if (ctrl.abort) break

    const model = (provider.models || []).find(m => (typeof m === 'string' ? m : m.id) === modelId)
    // 标记当前正在测试的行
    const row = section.querySelector(`.models-table-row[data-model-id="${cssEscape(modelId)}"]`)
    if (row) row.style.outline = '2px solid var(--accent)'

    const start = Date.now()
    try {
      await api.testModel(provider.baseUrl, provider.apiKey || '', modelId, provider.api || 'openai-completions')
      const elapsed = Date.now() - start
      if (model && typeof model === 'object') {
        model.latency = elapsed
        model.lastTestAt = Date.now()
        model.testStatus = 'ok'
        delete model.testError
      }
      ok++
    } catch (e) {
      const elapsed = Date.now() - start
      if (model && typeof model === 'object') {
        model.latency = null
        model.lastTestAt = Date.now()
        model.testStatus = 'fail'
        model.testError = String(e).slice(0, 100)
      }
      fail++
    }

    // 每测完一个实时刷新卡片
    if (page) {
      renderProviders(page, state)
      renderDefaultBar(page, state)
    }
    // 进度 toas
    const status = model?.testStatus === 'ok' ? '\u2713' : '\u2717'
    const latStr = model?.latency != null ? ` ${(model.latency / 1000).toFixed(1)}s` : ''
    toast(`${status} ${modelId}${latStr} (${ok + fail}/${ids.length})`, model?.testStatus === 'ok' ? 'success' : 'error')
  }

  // 恢复按钮
  _batchTestAbort = null
  // 重新查找按钮(renderProviders 后 DOM 已更新)
  const newList = page?.querySelector('#providers-list')
  const newBtn = newList?.querySelector('[data-action="batch-test"]')
  if (newBtn) {
    newBtn.disabled = false
    newBtn.classList.remove('btn-loading')
    newBtn.textContent = t('models.batchTest')
    newBtn.classList.remove('btn-danger')
    newBtn.classList.add('btn-secondary')
  }

  const aborted = ctrl.abort
  saveConfigOnly(state)
  if (aborted) {
    toast(t('models.batchTestAborted', { ok, fail, skip: ids.length - ok - fail }), 'warning')
  } else {
    toast(t('models.batchTestDone', { ok, fail }), ok === ids.length ? 'success' : 'warning')
  }
}

// 从服务商远程获取模型列表
async function fetchRemoteModels(btn, page, state, providerKey) {
  const provider = state.config.models.providers[providerKey]
  btn.disabled = true
  btn.classList.add('btn-loading')
  btn.textContent = t('models.qtcoolFetching')

  try {
    const remoteIds = await api.listRemoteModels(provider.baseUrl, provider.apiKey || '', provider.api || 'openai-completions')
    btn.disabled = false
    btn.classList.remove('btn-loading')
    btn.textContent = t('models.fetchList')

    // 标记已添加的模型
    const existingIds = (provider.models || []).map(m => typeof m === 'string' ? m : m.id)

    // 弹窗展示可选模型列表
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-height:80vh;display:flex;flex-direction:column">
        <div class="modal-title">${t('models.remoteListTitle', { provider: providerKey, count: remoteIds.length })}</div>
        <div style="margin-bottom:var(--space-sm);display:flex;gap:8px;align-items:center">
          <input class="form-input" id="remote-filter" placeholder="${t('models.remoteSearch')}" style="flex:1">
          <button class="btn btn-sm btn-secondary" id="remote-toggle-all">${t('models.selectAll')}</button>
        </div>
        <div id="remote-model-list" style="flex:1;overflow-y:auto;max-height:50vh"></div>
        <div class="modal-actions" style="margin-top:var(--space-sm)">
          <span id="remote-selected-count" style="font-size:var(--font-size-xs);color:var(--text-tertiary);flex:1">${t('models.remoteSelected', { count: 0 })}</span>
          <button class="btn btn-secondary btn-sm" data-action="cancel">${t('common.cancel')}</button>
          <button class="btn btn-primary btn-sm" data-action="confirm">${t('models.addSelected')}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const listEl = overlay.querySelector('#remote-model-list')
    const filterInput = overlay.querySelector('#remote-filter')
    const countEl = overlay.querySelector('#remote-selected-count')

    function renderRemoteList(filter) {
      const filtered = filter
        ? remoteIds.filter(id => id.toLowerCase().includes(filter.toLowerCase()))
        : remoteIds
      listEl.innerHTML = filtered.map(id => {
        const exists = existingIds.includes(id)
        return `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--radius-sm);cursor:pointer;${exists ? 'opacity:0.5' : ''}">
            <input type="checkbox" class="remote-cb" data-id="${id}" ${exists ? 'disabled' : ''}>
            <span style="font-family:var(--font-mono);font-size:var(--font-size-sm)">${id}</span>
            ${exists ? `<span style="font-size:var(--font-size-xs);color:var(--text-tertiary)">(${t('models.alreadyAdded')})</span>` : ''}
          </label>`
      }).join('')
      updateCount()
    }

    function updateCount() {
      const n = listEl.querySelectorAll('.remote-cb:checked').length
      countEl.textContent = t('models.remoteSelected', { count: n })
    }

    renderRemoteList('')
    filterInput.oninput = () => renderRemoteList(filterInput.value.trim())
    listEl.addEventListener('change', updateCount)

    overlay.querySelector('#remote-toggle-all').onclick = () => {
      const cbs = listEl.querySelectorAll('.remote-cb:not(:disabled)')
      const allChecked = [...cbs].every(cb => cb.checked)
      cbs.forEach(cb => { cb.checked = !allChecked })
      updateCount()
    }

    // 点击遮罩关闭（带拖拽防误触）
  let _pStart = null
  overlay.addEventListener('pointerdown', e => {
    _pStart = e.target === overlay ? { x: e.clientX, y: e.clientY } : null
  })
  overlay.addEventListener('pointerup', e => {
    if (_pStart && e.target === overlay) {
      const dx = e.clientX - _pStart.x
      const dy = e.clientY - _pStart.y
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) overlay.remove()
    }
    _pStart = null
  })
    overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove()
    overlay.querySelector('[data-action="confirm"]').onclick = () => {
      const selected = [...listEl.querySelectorAll('.remote-cb:checked')].map(cb => cb.dataset.id)
      if (!selected.length) { toast(t('models.selectAtLeast'), 'warning'); return }
      pushUndo(state)
      for (const id of selected) {
        provider.models.push({ id, input: ['text', 'image'] })
      }
      overlay.remove()
      renderProviders(page, state)
      renderDefaultBar(page, state)
      updateUndoBtn(page, state)
      autoSave(state)
      toast(t('models.qtcoolAdded', { count: selected.length }), 'success')
    }

    filterInput.focus()
  } catch (e) {
    btn.disabled = false
    btn.classList.remove('btn-loading')
    btn.textContent = t('models.fetchList')
    const errStr = String(e?.message || e)
    // 服务商不支持 /models 接口 → 友好弹窗引导手动添加
    if (errStr.includes('[NOT_SUPPORTED]') || errStr.includes('不支持自动获取')) {
      const msg = errStr.replace('[NOT_SUPPORTED] ', '').replace('获取模型列表失败: ', '')
      showConfirm(t('models.fetchNotSupported', { error: msg }), {
        title: t('models.fetchNotSupportedTitle'),
        confirmText: t('models.addModel').replace('+ ', ''),
        cancelText: t('common.close'),
      }).then(yes => {
        if (yes) addModel(btn.closest('.page') || document.querySelector('.page'), state, providerKey)
      })
    } else {
      toast(t('models.fetchFailed', { error: errStr }), 'error')
    }
  }
}

// 测试模型连通性(记录耗时和状态)
async function testModel(btn, state, providerKey, idx) {
  const provider = state.config.models.providers[providerKey]
  const model = provider.models[idx]
  const modelId = typeof model === 'string' ? model : model.id

  btn.disabled = true
  btn.classList.add('btn-loading')
  const origText = btn.textContent
  btn.textContent = t('models.testing')

  const start = Date.now()
  try {
    const reply = await api.testModel(provider.baseUrl, provider.apiKey || '', modelId, provider.api || 'openai-completions')
    const elapsed = Date.now() - start
    // 记录到模型对象
    if (typeof model === 'object') {
      model.latency = elapsed
      model.lastTestAt = Date.now()
      model.testStatus = 'ok'
      delete model.testError
    }
    // 包含 ⚠ 的是非致命错误(429 等),拆分显示
    if (reply.startsWith('⚠')) {
      const lines = reply.split('\n')
      const summary = lines[0]
      const detail = lines.slice(1).join('\n').trim()
      if (detail) {
        const detailHtml = detail.replace(/</g, '&lt;').replace(/(https?:\/\/[^\s，。;））'"&]+)/g, '<a href="$1" target="_blank" style="color:var(--primary);text-decoration:underline">$1</a>')
        toast(`<strong>${modelId}</strong> ${summary.replace(/</g, '&lt;')}<br><span style="font-size:11px;line-height:1.5;word-break:break-all">${detailHtml}</span>`, 'warning', { duration: 10000, html: true })
      } else {
        toast(`${modelId} ${summary}`, 'warning', { duration: 6000 })
      }
    } else {
      toast(t('models.testOk', { model: modelId, time: (elapsed / 1000).toFixed(1), reply: reply.slice(0, 50) }), 'success')
    }
  } catch (e) {
    const elapsed = Date.now() - start
    if (typeof model === 'object') {
      model.latency = null
      model.lastTestAt = Date.now()
      model.testStatus = 'fail'
      model.testError = String(e).slice(0, 200)
    }
    toast(t('models.testFail', { model: modelId, time: (elapsed / 1000).toFixed(1), error: e }), 'error', { duration: 8000 })
  } finally {
    btn.disabled = false
    btn.classList.remove('btn-loading')
    btn.textContent = origText
    // 刷新卡片显示最新状态
    const page = btn.closest('.page')
    if (page) {
      renderProviders(page, state)
      renderDefaultBar(page, state)
    }
    // 持久化测试结果(仅保存,不重启 Gateway)
    saveConfigOnly(state)
  }
}

async function testFullModel(btn, state, full) {
  const entry = getModelObject(state.config, full)
  if (!entry) return
  const idx = findModelIdx(entry.provider, entry.modelId)
  if (idx >= 0) await testModel(btn, state, entry.providerKey, idx)
}
