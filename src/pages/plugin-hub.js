/**
 * 插件中心 — OpenClaw 扩展插件管理与浏览
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { navigate } from '../router.js'
import { t } from '../lib/i18n.js'
import { openAIDrawerWithError } from '../components/ai-drawer.js'
import { escapeHtml as esc } from '../lib/utils.js'
import { showContentModal } from '../components/modal.js'

const PLUGIN_ICONS = {
  qqbot: '🐧', feishu: '🪶', dingtalk: '📌', telegram: '✈️',
  discord: '🎮', slack: '💬', weixin: '💚', wechat: '💚',
  webchat: '🌐', whatsapp: '📱', signal: '🔒', line: '🟢',
  teams: '👥', matrix: '🔗', irc: '📡',
}

let _allPlugins = []
let _searchQuery = ''

export async function render() {
  const page = document.createElement('div')
  page.className = 'page plugin-hub-page'
  _searchQuery = ''

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('extensions.title')}</h1>
      <div class="page-actions" style="display:flex;align-items:center;gap:var(--space-sm)">
        <button class="btn btn-sm btn-secondary" id="ph-refresh">${t('extensions.refresh')}</button>
        <button class="btn btn-sm btn-secondary" id="ph-go-channels">${t('extensions.goToChannels')}</button>
      </div>
    </div>
    <p class="form-hint" style="margin-bottom:var(--space-md)">${t('extensions.subtitle')}</p>
    <div id="ph-stats" class="route-map-stats"></div>
    <div class="plugin-hub-toolbar">
      <div class="plugin-hub-search">
        <input type="text" class="form-input" id="ph-search" placeholder="${t('extensions.searchPlaceholder')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </div>
      <div class="plugin-hub-install">
        <input type="text" class="form-input" id="ph-pkg-input" placeholder="${t('extensions.installPlaceholder')}">
        <button class="btn btn-primary btn-sm" id="ph-install-btn" style="white-space:nowrap">${t('extensions.installBtn')}</button>
      </div>
    </div>
    <div id="ph-install-msg" style="display:none;margin-bottom:var(--space-md)"></div>
    <div id="ph-list">
      <div class="stat-card loading-placeholder" style="height:200px"></div>
    </div>
  `

  page.querySelector('#ph-refresh').onclick = () => loadPlugins(page)
  page.querySelector('#ph-go-channels').onclick = () => navigate('/channels')
  page.querySelector('#ph-install-btn').onclick = () => handleInstall(page)
  page.querySelector('#ph-pkg-input').onkeydown = (e) => { if (e.key === 'Enter') handleInstall(page) }
  page.querySelector('#ph-search').oninput = (e) => {
    _searchQuery = e.target.value.trim().toLowerCase()
    renderPluginList(page)
  }

  // Event delegation for toggle buttons
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle-plugin]')
    if (!btn) return
    const pluginId = btn.dataset.togglePlugin
    const newEnabled = btn.dataset.toggleTo === 'true'
    btn.disabled = true
    btn.textContent = '...'
    try {
      await api.togglePlugin(pluginId, newEnabled)
      toast(t('extensions.toggleSuccess'), 'success')
      await loadPlugins(page)
    } catch (err) {
      toast(`${t('extensions.toggleFailed')}: ${err}`, 'error')
      btn.disabled = false
      btn.textContent = newEnabled ? t('extensions.enable') : t('extensions.disable')
    }
  })

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-config-plugin]')
    if (!btn) return
    await openPluginConfig(page, btn.dataset.configPlugin)
  })

  // Expand/collapse install messages
  page.addEventListener('click', (e) => {
    if (e.target.closest('#ph-install-msg-toggle')) {
      const detail = page.querySelector('#ph-install-msg-detail')
      const toggle = page.querySelector('#ph-install-msg-toggle')
      if (detail && toggle) {
        const expanded = detail.style.display !== 'none'
        detail.style.display = expanded ? 'none' : 'block'
        toggle.textContent = expanded ? t('extensions.showDetail') : t('extensions.hideDetail')
      }
    }
  })

  setTimeout(() => loadPlugins(page), 0)
  return page
}

async function handleInstall(page) {
  const input = page.querySelector('#ph-pkg-input')
  const btn = page.querySelector('#ph-install-btn')
  const msgEl = page.querySelector('#ph-install-msg')
  const pkg = input.value.trim()
  if (!pkg) return

  btn.disabled = true
  btn.textContent = t('extensions.installing')
  msgEl.style.display = 'block'
  msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--bg-secondary);color:var(--text-tertiary);font-size:13px">${t('extensions.installing')}</div>`

  try {
    const result = await api.installPlugin(pkg)
    const output = result.output ? esc(result.output).substring(0, 120) : ''
    msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--success-bg,#f0fdf4);border:1px solid var(--success-border,#86efac);color:var(--success);font-size:13px">
      ✅ ${t('extensions.installSuccess')}${output ? ' — ' + output : ''}
    </div>`
    toast(t('extensions.installSuccess'), 'success')
    input.value = ''
    await loadPlugins(page)
    setTimeout(() => { msgEl.style.display = 'none' }, 5000)
  } catch (e) {
    const errStr = String(e.message || e)
    const short = errStr.length > 100 ? errStr.substring(0, 100) + '...' : errStr
    const hasDetail = errStr.length > 100
    msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--error-bg,#fef2f2);border:1px solid var(--error-border,#fca5a5);font-size:13px">
      <div style="display:flex;align-items:center;gap:8px;color:var(--error)">
        <span>❌ ${t('extensions.installFailed')}: ${esc(short)}</span>
        ${hasDetail ? `<button id="ph-install-msg-toggle" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;white-space:nowrap;padding:0">${t('extensions.showDetail')}</button>` : ''}
      </div>
      ${hasDetail ? `<pre id="ph-install-msg-detail" style="display:none;margin-top:8px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);background:var(--bg-secondary);padding:8px;border-radius:6px">${esc(errStr)}</pre>` : ''}
    </div>`
    toast(t('extensions.installFailed'), 'error')
    openAIDrawerWithError({
      scene: 'plugin-install',
      title: t('extensions.installFailed') + ': ' + pkg,
      hint: t('extensions.installPlaceholder'),
      error: errStr,
    })
  } finally {
    btn.disabled = false
    btn.textContent = t('extensions.installBtn')
  }
}

async function loadPlugins(page) {
  const listEl = page.querySelector('#ph-list')
  const statsEl = page.querySelector('#ph-stats')
  listEl.innerHTML = `<div class="stat-card loading-placeholder" style="height:200px;display:flex;align-items:center;justify-content:center;color:var(--text-tertiary)">${t('extensions.loading')}</div>`

  try {
    const result = await api.listAllPlugins()
    _allPlugins = result?.plugins || []

    if (_allPlugins.length === 0) {
      statsEl.innerHTML = ''
      listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-xl);text-align:center;color:var(--text-tertiary)">${t('extensions.noPlugins')}</div>`
      return
    }

    const enabled = _allPlugins.filter(p => p.enabled).length
    const builtin = _allPlugins.filter(p => p.builtin).length

    statsEl.innerHTML = `
      <div class="route-map-stat"><span class="route-map-stat-num">${_allPlugins.length}</span><span class="route-map-stat-label">${t('extensions.statsInstalled')}</span></div>
      <div class="route-map-stat"><span class="route-map-stat-num">${enabled}</span><span class="route-map-stat-label">${t('extensions.statsEnabled')}</span></div>
      ${builtin ? `<div class="route-map-stat"><span class="route-map-stat-num">${builtin}</span><span class="route-map-stat-label">${t('extensions.statsBuiltin')}</span></div>` : ''}
    `

    renderPluginList(page)
  } catch (e) {
    listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-lg);color:var(--error)">${esc(e.message || e)}</div>`
  }
}

function renderPluginList(page) {
  const listEl = page.querySelector('#ph-list')
  if (!listEl) return

  const filtered = _searchQuery
    ? _allPlugins.filter(p => {
        const q = _searchQuery
        return (p.id || '').toLowerCase().includes(q) ||
               (p.description || '').toLowerCase().includes(q) ||
               (p.version || '').toLowerCase().includes(q)
      })
    : _allPlugins

  if (filtered.length === 0 && _searchQuery) {
    listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-lg);text-align:center;color:var(--text-tertiary)">
      ${t('extensions.noSearchResults', { query: esc(_searchQuery) })}
    </div>`
    return
  }

  listEl.innerHTML = `<div class="plugin-grid">${filtered.map(p => renderPluginCard(p)).join('')}</div>
    <div class="form-hint" style="margin-top:var(--space-md);font-size:var(--font-size-xs)">${t('extensions.restartHint')}</div>`
}

function renderPluginCard(p) {
  const icon = PLUGIN_ICONS[p.id.toLowerCase()] || '🧩'
  const statusClass = p.enabled ? 'plugin-status-enabled' : (p.installed ? 'plugin-status-disabled' : 'plugin-status-missing')
  const statusText = p.enabled ? t('extensions.enabled') : (p.installed ? t('extensions.disabled') : t('extensions.notInstalled'))
  const statusPillClass = p.enabled ? 'plugin-state-enabled' : (p.installed ? 'plugin-state-disabled' : 'plugin-state-missing')
  const badges = []
  if (p.builtin) badges.push(`<span class="plugin-badge plugin-badge-builtin">${t('extensions.builtin')}</span>`)
  if (p.version) badges.push(`<span class="plugin-badge plugin-badge-version">${t('extensions.version')} ${esc(p.version)}</span>`)
  if (isPlainObject(p.config) && Object.keys(p.config).length) badges.push(`<span class="plugin-badge plugin-badge-config">${t('extensions.configured')}</span>`)
  if (hasConfigHints(p)) badges.push(`<span class="plugin-badge plugin-badge-schema">${t('extensions.configAvailable')}</span>`)

  // Toggle button: installed plugins can be enabled/disabled
  let toggleBtn = ''
  if (p.installed) {
    if (p.enabled) {
      toggleBtn = `<button class="btn btn-sm btn-secondary" data-toggle-plugin="${esc(p.id)}" data-toggle-to="false">${t('extensions.disable')}</button>`
    } else {
      toggleBtn = `<button class="btn btn-sm btn-primary" data-toggle-plugin="${esc(p.id)}" data-toggle-to="true">${t('extensions.enable')}</button>`
    }
  }

  return `
    <div class="plugin-card ${p.enabled ? '' : 'plugin-card-inactive'}">
      <div class="plugin-card-header">
        <span class="plugin-card-icon">${icon}</span>
        <div class="plugin-card-title">
          <div class="plugin-card-title-line">
            <span class="plugin-card-name">${esc(p.id)}</span>
            <span class="plugin-state-pill ${statusPillClass}">${statusText}</span>
          </div>
          <div class="plugin-card-badges">${badges.join('')}</div>
        </div>
        <span class="plugin-status-dot ${statusClass}" title="${statusText}"></span>
      </div>
      <div class="plugin-card-desc">${esc(p.description) || t('extensions.noDescription')}</div>
      <div class="plugin-card-footer">
        <span class="plugin-card-status">${statusText}</span>
        <div class="plugin-card-actions">
          <button class="btn btn-sm btn-secondary" data-config-plugin="${esc(p.id)}">${t('extensions.configBtn')}</button>
          ${toggleBtn}
        </div>
      </div>
    </div>
  `
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function hasConfigHints(plugin) {
  return isPlainObject(plugin?.configDefaults) ||
    Object.keys(getConfigSchemaProperties(plugin?.configSchema)).length > 0
}

function getConfigSchemaProperties(schema) {
  if (!isPlainObject(schema)) return {}
  if (isPlainObject(schema.properties)) return schema.properties
  if (isPlainObject(schema.schema?.properties)) return schema.schema.properties
  if (isPlainObject(schema.configSchema?.properties)) return schema.configSchema.properties
  return {}
}

function schemaType(definition) {
  if (!isPlainObject(definition)) return null
  const raw = Array.isArray(definition.type) ? definition.type.find(type => type !== 'null') : definition.type
  if (['string', 'number', 'boolean', 'array', 'object', 'null'].includes(raw)) return raw
  if (definition.properties) return 'object'
  if (definition.items) return 'array'
  if (definition.enum?.some(item => typeof item === 'number')) return 'number'
  if (definition.enum?.some(item => typeof item === 'boolean')) return 'boolean'
  return null
}

function schemaDefaultValue(definition, type) {
  if (isPlainObject(definition) && Object.prototype.hasOwnProperty.call(definition, 'default')) {
    return cloneJson(definition.default)
  }
  if (isPlainObject(definition) && Array.isArray(definition.enum) && definition.enum.length) {
    return cloneJson(definition.enum[0])
  }
  if (type === 'boolean') return false
  if (type === 'number') return 0
  if (type === 'array') return []
  if (type === 'object') return {}
  if (type === 'null') return null
  return ''
}

function configFieldHint(definition) {
  if (!isPlainObject(definition)) return ''
  const parts = []
  const desc = definition.markdownDescription || definition.description || definition.title
  if (desc) parts.push(String(desc))
  if (Array.isArray(definition.enum) && definition.enum.length) {
    parts.push(`${t('extensions.configEnum')}: ${definition.enum.map(item => String(item)).join(', ')}`)
  }
  return parts.join(' · ')
}

function buildConfigRows(plugin) {
  const saved = isPlainObject(plugin?.config) ? cloneJson(plugin.config) : {}
  const defaults = isPlainObject(plugin?.configDefaults) ? cloneJson(plugin.configDefaults) : {}
  const schemaProps = getConfigSchemaProperties(plugin?.configSchema)
  const keys = new Set([...Object.keys(schemaProps), ...Object.keys(defaults), ...Object.keys(saved)])
  return [...keys].sort((a, b) => a.localeCompare(b)).map(key => {
    const definition = isPlainObject(schemaProps[key]) ? schemaProps[key] : null
    const hasSaved = Object.prototype.hasOwnProperty.call(saved, key)
    const hasDefault = Object.prototype.hasOwnProperty.call(defaults, key)
    const type = schemaType(definition) || inferConfigType(hasSaved ? saved[key] : (hasDefault ? defaults[key] : undefined))
    const value = hasSaved ? saved[key] : (hasDefault ? defaults[key] : schemaDefaultValue(definition, type))
    return { key, value, type, definition }
  })
}

function inferConfigType(value) {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'array'
  if (isPlainObject(value)) return 'object'
  if (value === null) return 'null'
  return 'string'
}

function formatConfigValue(value, type = inferConfigType(value)) {
  if (type === 'array' || type === 'object') return JSON.stringify(value ?? (type === 'array' ? [] : {}), null, 2)
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'null') return ''
  if (value == null) return ''
  return String(value)
}

function renderConfigValueInput(key, value, type = inferConfigType(value), definition = null) {
  const text = esc(formatConfigValue(value, type))
  const enumValues = Array.isArray(definition?.enum) ? definition.enum : []
  if (enumValues.length && !['array', 'object'].includes(type)) {
    return `<select class="form-input" data-config-value>
      ${enumValues.map(item => {
        const val = String(item)
        return `<option value="${esc(val)}" ${String(value) === val ? 'selected' : ''}>${esc(val)}</option>`
      }).join('')}
    </select>`
  }
  if (type === 'boolean') {
    return `<select class="form-input" data-config-value>
      <option value="true" ${value ? 'selected' : ''}>true</option>
      <option value="false" ${!value ? 'selected' : ''}>false</option>
    </select>`
  }
  if (type === 'array' || type === 'object') {
    return `<textarea class="form-input" data-config-value spellcheck="false" placeholder="${type === 'array' ? '[]' : '{}'}">${text}</textarea>`
  }
  if (type === 'null') {
    return `<input class="form-input" data-config-value value="" placeholder="null" disabled>`
  }
  return `<input class="form-input" data-config-value value="${text}" placeholder="${esc(key)}">`
}

function renderConfigTypeSelect(type) {
  const options = ['string', 'number', 'boolean', 'array', 'object', 'null']
  return `<select class="form-input" data-config-type>
    ${options.map(opt => `<option value="${opt}" ${opt === type ? 'selected' : ''}>${opt}</option>`).join('')}
  </select>`
}

function renderConfigRow(key = '', value = '', type = inferConfigType(value), definition = null) {
  const hint = configFieldHint(definition)
  return `
    <div class="plugin-config-row">
      <input class="form-input" data-config-key value="${esc(key)}" placeholder="${t('extensions.configKey')}">
      ${renderConfigTypeSelect(type)}
      <div data-config-value-wrap>${renderConfigValueInput(key, value, type, definition)}</div>
      <button class="btn btn-sm btn-secondary" data-remove-config-row type="button">${t('common.delete')}</button>
      ${hint ? `<div class="plugin-config-field-hint">${esc(hint)}</div>` : ''}
    </div>
  `
}

function renderConfigRows(plugin) {
  const rows = buildConfigRows(plugin)
  if (!rows.length) return `<div class="plugin-config-empty" data-config-empty>${t('extensions.configEmpty')}</div>`
  return rows.map(row => renderConfigRow(row.key, row.value, row.type, row.definition)).join('')
}

function refreshRowValueInput(row) {
  const key = row.querySelector('[data-config-key]')?.value || ''
  const type = row.querySelector('[data-config-type]')?.value || 'string'
  const wrap = row.querySelector('[data-config-value-wrap]')
  const current = row.querySelector('[data-config-value]')?.value
  let nextValue = current
  if (type === 'boolean') nextValue = current === 'true'
  else if (type === 'number') nextValue = Number(current || 0)
  else if (type === 'array') nextValue = []
  else if (type === 'object') nextValue = {}
  else if (type === 'null') nextValue = null
  if (wrap) wrap.innerHTML = renderConfigValueInput(key, nextValue, type)
}

function parseConfigValue(raw, type, key) {
  if (type === 'string') return String(raw ?? '')
  if (type === 'number') {
    const num = Number(raw)
    if (!Number.isFinite(num)) throw new Error(`${key}: ${t('extensions.configInvalidNumber')}`)
    return num
  }
  if (type === 'boolean') return raw === 'true'
  if (type === 'null') return null
  if (type === 'array' || type === 'object') {
    let parsed
    try {
      parsed = JSON.parse(raw || (type === 'array' ? '[]' : '{}'))
    } catch {
      throw new Error(`${key}: ${t('extensions.configInvalidJson')}`)
    }
    if (type === 'array' && !Array.isArray(parsed)) throw new Error(`${key}: ${t('extensions.configExpectedArray')}`)
    if (type === 'object' && !isPlainObject(parsed)) throw new Error(`${key}: ${t('extensions.configExpectedObject')}`)
    return parsed
  }
  return raw
}

function collectConfigRows(modal) {
  const result = {}
  const seen = new Set()
  for (const row of modal.querySelectorAll('.plugin-config-row')) {
    const key = row.querySelector('[data-config-key]')?.value.trim()
    if (!key) continue
    if (seen.has(key)) throw new Error(t('extensions.configDuplicateKey', { key }))
    seen.add(key)
    const type = row.querySelector('[data-config-type]')?.value || 'string'
    const raw = row.querySelector('[data-config-value]')?.value ?? ''
    result[key] = parseConfigValue(raw, type, key)
  }
  return result
}

async function openPluginConfig(page, pluginId) {
  const plugin = _allPlugins.find(item => item.id === pluginId)
  if (!plugin) return
  const knownFieldCount = buildConfigRows(plugin).length
  const modal = showContentModal({
    title: esc(t('extensions.configFor', { id: pluginId })),
    width: 760,
    content: `
      <div class="plugin-config-editor">
        <div class="plugin-config-meta">
          <span>${esc(plugin.installed ? t('extensions.installed') : t('extensions.notInstalled'))}</span>
          <span>·</span>
          <span>${esc(plugin.enabled ? t('extensions.enabled') : t('extensions.disabled'))}</span>
          ${knownFieldCount ? `<span>·</span><span>${t('extensions.configKnownFields', { count: knownFieldCount })}</span>` : ''}
          <span>·</span>
          <span>plugins.entries.${esc(pluginId)}.config</span>
        </div>
        <div class="plugin-config-error" id="plugin-config-error"></div>
        <div class="plugin-config-rows" id="plugin-config-rows">${renderConfigRows(plugin)}</div>
        <div>
          <button class="btn btn-sm btn-secondary" id="plugin-config-add" type="button">${t('extensions.configAddField')}</button>
        </div>
        <div class="form-hint">${t('extensions.configHint')}</div>
      </div>
    `,
    buttons: [
      { id: 'plugin-config-save', label: t('common.save'), className: 'btn btn-primary btn-sm' },
    ],
  })

  const rowsEl = modal.querySelector('#plugin-config-rows')
  const errorEl = modal.querySelector('#plugin-config-error')
  const showError = (msg) => {
    if (!errorEl) return
    errorEl.style.display = msg ? 'block' : 'none'
    errorEl.textContent = msg || ''
  }

  modal.querySelector('#plugin-config-add')?.addEventListener('click', () => {
    modal.querySelector('[data-config-empty]')?.remove()
    rowsEl.insertAdjacentHTML('beforeend', renderConfigRow('', '', 'string'))
    rowsEl.querySelector('.plugin-config-row:last-child [data-config-key]')?.focus()
  })

  rowsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-config-row]')
    if (!btn) return
    btn.closest('.plugin-config-row')?.remove()
    if (!rowsEl.querySelector('.plugin-config-row')) {
      rowsEl.innerHTML = `<div class="plugin-config-empty" data-config-empty>${t('extensions.configEmpty')}</div>`
    }
  })

  rowsEl?.addEventListener('change', (e) => {
    const select = e.target.closest('[data-config-type]')
    if (!select) return
    refreshRowValueInput(select.closest('.plugin-config-row'))
  })

  modal.querySelector('#plugin-config-save')?.addEventListener('click', async () => {
    const saveBtn = modal.querySelector('#plugin-config-save')
    showError('')
    let nextPluginConfig
    try {
      nextPluginConfig = collectConfigRows(modal)
    } catch (err) {
      showError(err.message || String(err))
      return
    }

    saveBtn.disabled = true
    saveBtn.textContent = t('extensions.configSaving')
    try {
      const config = await api.readOpenclawConfig()
      const next = cloneJson(config)
      if (!isPlainObject(next.plugins)) next.plugins = {}
      if (!isPlainObject(next.plugins.entries)) next.plugins.entries = {}
      if (!isPlainObject(next.plugins.entries[pluginId])) next.plugins.entries[pluginId] = {}
      next.plugins.entries[pluginId].config = nextPluginConfig
      await api.writeOpenclawConfig(next)
      toast(t('extensions.configSaved'), 'success')
      modal.close()
      await loadPlugins(page)
    } catch (err) {
      showError(err.message || String(err))
      toast(t('common.saveFailed'), 'error')
    } finally {
      saveBtn.disabled = false
      saveBtn.textContent = t('common.save')
    }
  })
}
