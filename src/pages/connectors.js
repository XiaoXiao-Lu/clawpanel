/**
 * 连接器与 MCP 管理
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm, showContentModal } from '../components/modal.js'
import { icon, statusIcon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'
import { humanizeError } from '../lib/humanize-error.js'
import {
  buildMcpConfigWithServers,
  getMcpConfigShape,
  normalizeMcpServers,
  summarizeMcpConfig,
  validateMcpServer,
} from '../lib/mcp-config.js'

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function attr(value) {
  return esc(value).replace(/'/g, '&#39;')
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}))
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function keyValueToLines(value) {
  if (!isPlainObject(value)) return ''
  return Object.entries(value).map(([k, v]) => `${k}=${String(v)}`).join('\n')
}

function linesToKeyValue(text) {
  const result = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) throw new Error(t('connectors.invalidKeyValueLine', { line: trimmed }))
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return result
}

function argsToLines(args) {
  return Array.isArray(args) ? args.map(v => String(v)).join('\n') : ''
}

function linesToArgs(text) {
  return String(text || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean)
}

function getManagedExtra(raw) {
  const extra = cloneJson(raw)
  for (const key of ['command', 'args', 'cwd', 'env', 'url', 'headers', 'timeout', 'disabled', 'enabled', 'description', 'type', 'transport']) {
    delete extra[key]
  }
  return extra
}

function statusLabel(status) {
  if (status === 'ok') return t('connectors.statusOk')
  if (status === 'warn') return t('connectors.statusWarn')
  if (status === 'error') return t('connectors.statusError')
  if (status === 'disabled') return t('connectors.statusDisabled')
  return t('connectors.statusUnknown')
}

function statusClass(status) {
  if (status === 'ok') return 'ok'
  if (status === 'warn') return 'warn'
  if (status === 'error') return 'error'
  return 'neutral'
}

function issueText(code) {
  return t(`connectors.issue.${code}`)
}

function transportLabel(transport) {
  if (transport === 'stdio') return t('connectors.transportStdio')
  if (transport === 'http') return t('connectors.transportHttp')
  return t('connectors.transportUnknown')
}

function displayTarget(server) {
  if (server.transport === 'stdio') return server.command || t('connectors.notConfigured')
  if (server.transport === 'http') return server.url || t('connectors.notConfigured')
  return t('connectors.notConfigured')
}

function renderMetric(value, label, tone = '') {
  return `<div class="connectors-metric ${tone}">
    <strong>${esc(value)}</strong>
    <span>${esc(label)}</span>
  </div>`
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page connectors-page'
  const state = {
    rawConfig: {},
    shape: null,
    servers: [],
    selectedId: '',
    search: '',
    filter: 'all',
    dirty: false,
    loading: true,
  }

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('connectors.title')}</h1>
      <p class="page-desc">${t('connectors.desc')}</p>
    </div>
    <div id="connectors-root">
      <div class="config-section">
        <div class="stat-card loading-placeholder" style="height:160px"></div>
      </div>
    </div>
  `

  await loadConfig(page, state)
  return page
}

async function loadConfig(page, state) {
  const root = page.querySelector('#connectors-root')
  state.loading = true
  root.innerHTML = `<div class="config-section"><div class="stat-card loading-placeholder" style="height:160px"></div></div>`
  try {
    state.rawConfig = await api.readMcpConfig()
    state.shape = getMcpConfigShape(state.rawConfig)
    state.servers = normalizeMcpServers(state.rawConfig)
    state.selectedId = state.servers[0]?.id || ''
    state.dirty = false
    state.loading = false
    renderWorkbench(page, state)
  } catch (err) {
    const message = humanizeError(err, t('connectors.loadFailed'))
    root.innerHTML = `
      <div class="config-section connectors-empty">
        <div class="connectors-empty-icon">${statusIcon('err', 28)}</div>
        <div class="connectors-empty-title">${esc(t('connectors.loadFailed'))}</div>
        <div class="form-hint">${esc(message)}</div>
        <button class="btn btn-secondary btn-sm" id="connectors-retry">${icon('refresh-cw', 14)} ${t('connectors.retry')}</button>
      </div>
    `
    root.querySelector('#connectors-retry')?.addEventListener('click', () => loadConfig(page, state))
  }
}

function renderWorkbench(page, state) {
  const root = page.querySelector('#connectors-root')
  const summary = summarizeFromState(state)
  const selected = state.servers.find(s => s.id === state.selectedId) || state.servers[0] || null
  if (selected && state.selectedId !== selected.id) state.selectedId = selected.id

  root.innerHTML = `
    <div class="connectors-console">
      <div class="connectors-console-main">
        <div class="models-console-kicker">${t('connectors.kicker')}</div>
        <div class="connectors-console-head">
          <div class="connectors-console-icon">${icon('plug', 22)}</div>
          <div>
            <div class="connectors-console-title">${t('connectors.consoleTitle')}</div>
            <div class="connectors-console-desc">${t('connectors.consoleDesc')}</div>
          </div>
        </div>
        <div class="connectors-toolbar">
          <div class="connectors-search">
            ${icon('search', 15)}
            <input class="form-input" id="connectors-search" placeholder="${t('connectors.searchPlaceholder')}" value="${attr(state.search)}">
          </div>
          <select class="form-input connectors-filter" id="connectors-filter">
            ${['all', 'enabled', 'disabled', 'stdio', 'http', 'review'].map(f => `<option value="${f}" ${state.filter === f ? 'selected' : ''}>${t(`connectors.filter.${f}`)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="connectors-console-side">
        <div class="connectors-metrics">
          ${renderMetric(summary.total, t('connectors.metricTotal'))}
          ${renderMetric(summary.enabled, t('connectors.metricEnabled'), 'ok')}
          ${renderMetric(summary.needsReview, t('connectors.metricReview'), summary.needsReview ? 'warn' : '')}
          ${renderMetric(summary.secrets, t('connectors.metricSecrets'), summary.secrets ? 'warn' : '')}
        </div>
      </div>
    </div>

    <div class="connectors-actions">
      <button class="btn btn-primary btn-sm" data-action="add">${icon('plus-circle', 14)} ${t('connectors.add')}</button>
      <button class="btn btn-secondary btn-sm" data-action="import">${icon('upload', 14)} ${t('connectors.importJson')}</button>
      <button class="btn btn-secondary btn-sm" data-action="export">${icon('download', 14)} ${t('connectors.exportJson')}</button>
      <button class="btn btn-secondary btn-sm" data-action="reload">${icon('refresh-cw', 14)} ${t('connectors.reload')}</button>
      <button class="btn btn-primary btn-sm" data-action="save" ${state.dirty ? '' : 'disabled'}>${icon('check', 14)} ${state.dirty ? t('connectors.saveChanges') : t('connectors.saved')}</button>
    </div>

    <div class="connectors-layout">
      <div class="connectors-list" id="connectors-list">
        ${renderServerList(state)}
      </div>
      <div class="connectors-preview" id="connectors-preview">
        ${renderPreview(selected)}
      </div>
    </div>
  `

  bindWorkbench(page, state)
}

function summarizeFromState(state) {
  const config = buildMcpConfigWithServers(state.rawConfig, state.servers, state.shape)
  return summarizeMcpConfig(config)
}

function filteredServers(state) {
  const q = state.search.trim().toLowerCase()
  return state.servers.filter(server => {
    if (state.filter === 'enabled' && server.disabled) return false
    if (state.filter === 'disabled' && !server.disabled) return false
    if (state.filter === 'stdio' && server.transport !== 'stdio') return false
    if (state.filter === 'http' && server.transport !== 'http') return false
    if (state.filter === 'review' && !['warn', 'error'].includes(server.status)) return false
    if (!q) return true
    const haystack = [server.id, server.command, server.url, server.description, server.transport].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

function renderServerList(state) {
  const servers = filteredServers(state)
  if (!state.servers.length) {
    return `<div class="connectors-empty">
      <div class="connectors-empty-icon">${icon('plug', 28)}</div>
      <div class="connectors-empty-title">${t('connectors.emptyTitle')}</div>
      <div class="form-hint">${t('connectors.emptyDesc')}</div>
      <button class="btn btn-primary btn-sm" data-action="add">${icon('plus-circle', 14)} ${t('connectors.addFirst')}</button>
    </div>`
  }
  if (!servers.length) {
    return `<div class="connectors-empty">
      <div class="connectors-empty-title">${t('connectors.noResults')}</div>
      <div class="form-hint">${t('connectors.noResultsHint')}</div>
    </div>`
  }
  return servers.map(server => `
    <button class="connectors-card ${server.id === state.selectedId ? 'active' : ''}" data-action="select" data-id="${attr(server.id)}">
      <div class="connectors-card-head">
        <span class="connectors-card-title">${esc(server.id)}</span>
        <span class="models-status ${statusClass(server.status)}">${statusLabel(server.status)}</span>
      </div>
      <div class="connectors-card-target">${esc(displayTarget(server))}</div>
      <div class="connectors-card-meta">
        <span>${transportLabel(server.transport)}</span>
        <span>${t('connectors.argsCount', { count: server.argsCount })}</span>
        <span>${t('connectors.envCount', { count: server.envCount + server.headerCount })}</span>
      </div>
    </button>
  `).join('')
}

function renderPreview(server) {
  if (!server) {
    return `<div class="connectors-empty">
      <div class="connectors-empty-icon">${icon('eye', 28)}</div>
      <div class="connectors-empty-title">${t('connectors.previewEmpty')}</div>
      <div class="form-hint">${t('connectors.previewEmptyHint')}</div>
    </div>`
  }
  const checks = [
    ...(server.issues || []).map(code => ['error', issueText(code)]),
    ...(server.warnings || []).map(code => ['warn', issueText(code)]),
  ]
  const raw = JSON.stringify(server.raw, null, 2)
  return `
    <div class="connectors-preview-head">
      <div>
        <div class="connectors-preview-title">${icon(server.transport === 'http' ? 'globe' : 'terminal', 18)} ${esc(server.id)}</div>
        <div class="connectors-preview-subtitle">${transportLabel(server.transport)} · ${esc(statusLabel(server.status))}</div>
      </div>
      <div class="connectors-preview-actions">
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${attr(server.id)}">${icon('edit', 14)} ${t('connectors.edit')}</button>
        <button class="btn btn-secondary btn-sm" data-action="duplicate" data-id="${attr(server.id)}">${icon('copy', 14)} ${t('connectors.duplicate')}</button>
        <button class="btn btn-secondary btn-sm" data-action="toggle" data-id="${attr(server.id)}">${server.disabled ? t('connectors.enable') : t('connectors.disable')}</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${attr(server.id)}">${icon('trash', 14)} ${t('connectors.delete')}</button>
      </div>
    </div>
    <div class="connectors-preview-grid">
      <div><span>${t('connectors.previewTarget')}</span><code>${esc(displayTarget(server))}</code></div>
      <div><span>${t('connectors.previewArgs')}</span><code>${server.argsCount}</code></div>
      <div><span>${t('connectors.previewEnv')}</span><code>${server.envCount + server.headerCount}</code></div>
      <div><span>${t('connectors.previewSecrets')}</span><code>${server.secretCount}</code></div>
    </div>
    <div class="connectors-purpose">
      <div class="connectors-section-label">${t('connectors.purposeTitle')}</div>
      <div class="form-hint">${esc(server.description || inferPurpose(server))}</div>
    </div>
    <div class="connectors-checks">
      <div class="connectors-section-label">${t('connectors.checkTitle')}</div>
      ${checks.length
        ? checks.map(([tone, text]) => `<div class="connectors-check ${tone}">${tone === 'error' ? statusIcon('err', 14) : statusIcon('warn', 14)} <span>${esc(text)}</span></div>`).join('')
        : `<div class="connectors-check ok">${statusIcon('ok', 14)} <span>${t('connectors.checkPassed')}</span></div>`}
    </div>
    <details class="connectors-raw">
      <summary>${t('connectors.rawJson')}</summary>
      <pre>${esc(raw)}</pre>
    </details>
  `
}

function inferPurpose(server) {
  const target = displayTarget(server).toLowerCase()
  if (target.includes('filesystem')) return t('connectors.purposeFilesystem')
  if (target.includes('github')) return t('connectors.purposeGithub')
  if (target.includes('browser') || target.includes('playwright')) return t('connectors.purposeBrowser')
  if (server.transport === 'http') return t('connectors.purposeHttp')
  if (server.transport === 'stdio') return t('connectors.purposeStdio')
  return t('connectors.purposeUnknown')
}

function bindWorkbench(page, state) {
  page.querySelector('#connectors-search')?.addEventListener('input', (e) => {
    state.search = e.target.value
    renderWorkbench(page, state)
  })
  page.querySelector('#connectors-filter')?.addEventListener('change', (e) => {
    state.filter = e.target.value
    renderWorkbench(page, state)
  })
  const root = page.querySelector('#connectors-root')
  if (!root) return
  root.onclick = async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id
    if (action === 'select') {
      state.selectedId = id
      renderWorkbench(page, state)
    } else if (action === 'add') {
      openEditor(page, state, null)
    } else if (action === 'edit') {
      openEditor(page, state, id)
    } else if (action === 'duplicate') {
      duplicateServer(page, state, id)
    } else if (action === 'toggle') {
      toggleServer(page, state, id)
    } else if (action === 'delete') {
      await deleteServer(page, state, id)
    } else if (action === 'save') {
      await saveConfig(page, state)
    } else if (action === 'reload') {
      if (!state.dirty || await showConfirm(t('connectors.reloadConfirm'), { variant: 'primary' })) {
        await loadConfig(page, state)
      }
    } else if (action === 'export') {
      exportJson(state)
    } else if (action === 'import') {
      openImport(page, state)
    }
  }
}

function rehydrateServers(state) {
  const config = buildMcpConfigWithServers(state.rawConfig, state.servers, state.shape)
  state.servers = normalizeMcpServers(config)
}

function markDirty(page, state, selectedId) {
  state.dirty = true
  if (selectedId) state.selectedId = selectedId
  rehydrateServers(state)
  renderWorkbench(page, state)
}

function uniqueId(state, base) {
  const existing = new Set(state.servers.map(s => s.id))
  let candidate = String(base || 'connector').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '') || 'connector'
  if (!existing.has(candidate)) return candidate
  let i = 2
  while (existing.has(`${candidate}-${i}`)) i++
  return `${candidate}-${i}`
}

function openEditor(page, state, id) {
  const current = id ? state.servers.find(s => s.id === id) : null
  const raw = cloneJson(current?.raw || { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] })
  const initialTransport = current?.transport === 'http' || raw.url ? 'http' : 'stdio'
  const extra = getManagedExtra(raw)
  const modal = showContentModal({
    title: current ? t('connectors.editTitle', { id: current.id }) : t('connectors.addTitle'),
    width: 760,
    buttons: [{ id: 'connectors-editor-save', className: 'btn btn-primary btn-sm', label: t('connectors.apply') }],
    content: `
      <div class="connectors-editor" data-mode="${initialTransport}">
        <div class="connectors-editor-grid">
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldId')}</span>
            <input class="form-input" name="id" value="${attr(current?.id || uniqueId(state, 'filesystem'))}" ${current ? 'readonly' : ''}>
            <span class="form-hint">${t('connectors.fieldIdHint')}</span>
          </label>
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldDescription')}</span>
            <input class="form-input" name="description" value="${attr(raw.description || '')}" placeholder="${attr(t('connectors.descriptionPlaceholder'))}">
          </label>
        </div>
        <div class="connectors-segment" role="tablist">
          <button class="${initialTransport === 'stdio' ? 'active' : ''}" type="button" data-editor-transport="stdio">${icon('terminal', 14)} ${t('connectors.transportStdio')}</button>
          <button class="${initialTransport === 'http' ? 'active' : ''}" type="button" data-editor-transport="http">${icon('globe', 14)} ${t('connectors.transportHttp')}</button>
        </div>
        <div class="connectors-editor-panel" data-panel="stdio">
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldCommand')}</span>
            <input class="form-input" name="command" value="${attr(raw.command || '')}" placeholder="npx">
          </label>
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldArgs')}</span>
            <textarea class="form-input connectors-textarea" name="args" rows="5" placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;E:/Code">${esc(argsToLines(raw.args))}</textarea>
            <span class="form-hint">${t('connectors.fieldArgsHint')}</span>
          </label>
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldCwd')}</span>
            <input class="form-input" name="cwd" value="${attr(raw.cwd || '')}" placeholder="E:/Code">
          </label>
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldEnv')}</span>
            <textarea class="form-input connectors-textarea" name="env" rows="4" placeholder="GITHUB_TOKEN=${'${GITHUB_TOKEN}'}">${esc(keyValueToLines(raw.env))}</textarea>
          </label>
        </div>
        <div class="connectors-editor-panel" data-panel="http">
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldUrl')}</span>
            <input class="form-input" name="url" value="${attr(raw.url || '')}" placeholder="https://example.com/mcp">
          </label>
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldHeaders')}</span>
            <textarea class="form-input connectors-textarea" name="headers" rows="4" placeholder="Authorization=Bearer ${'${TOKEN}'}">${esc(keyValueToLines(raw.headers))}</textarea>
          </label>
        </div>
        <div class="connectors-editor-grid">
          <label class="form-group">
            <span class="form-label">${t('connectors.fieldTimeout')}</span>
            <input class="form-input" name="timeout" type="number" min="1" step="1" value="${attr(raw.timeout || '')}" placeholder="60">
          </label>
          <label class="form-group connectors-checkline">
            <input type="checkbox" name="disabled" ${raw.disabled === true || raw.enabled === false ? 'checked' : ''}>
            <span>${t('connectors.fieldDisabled')}</span>
          </label>
        </div>
        <details class="connectors-editor-advanced">
          <summary>${t('connectors.advancedFields')}</summary>
          <textarea class="form-input connectors-textarea" name="extra" rows="7" spellcheck="false">${esc(JSON.stringify(extra, null, 2))}</textarea>
          <span class="form-hint">${t('connectors.advancedFieldsHint')}</span>
        </details>
        <div class="form-hint connectors-editor-error" id="connectors-editor-error"></div>
      </div>
    `,
  })

  const setMode = (mode) => {
    modal.querySelector('.connectors-editor')?.setAttribute('data-mode', mode)
    modal.querySelectorAll('[data-editor-transport]').forEach(btn => btn.classList.toggle('active', btn.dataset.editorTransport === mode))
  }
  setMode(initialTransport)
  modal.querySelectorAll('[data-editor-transport]').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.editorTransport))
  })
  modal.querySelector('#connectors-editor-save')?.addEventListener('click', () => {
    try {
      const next = readEditor(modal)
      const validation = validateMcpServer(next.id, next.raw)
      if (validation.issues.length) {
        throw new Error(validation.issues.map(issueText).join('\n'))
      }
      const existingIndex = state.servers.findIndex(s => s.id === next.id)
      if (!current && existingIndex >= 0) throw new Error(t('connectors.duplicateId'))
      if (current && next.id !== current.id && existingIndex >= 0) throw new Error(t('connectors.duplicateId'))
      if (current) {
        const idx = state.servers.findIndex(s => s.id === current.id)
        state.servers[idx] = { id: next.id, raw: next.raw }
      } else {
        state.servers.push({ id: next.id, raw: next.raw })
      }
      modal.close()
      markDirty(page, state, next.id)
    } catch (err) {
      const errEl = modal.querySelector('#connectors-editor-error')
      if (errEl) {
        errEl.style.color = 'var(--error)'
        errEl.textContent = err?.message || String(err)
      }
    }
  })
}

function readEditor(modal) {
  const root = modal.querySelector('.connectors-editor')
  const mode = root?.getAttribute('data-mode') || 'stdio'
  const id = modal.querySelector('[name="id"]')?.value.trim() || ''
  let extra = {}
  const extraText = modal.querySelector('[name="extra"]')?.value.trim()
  if (extraText) {
    extra = JSON.parse(extraText)
    if (!isPlainObject(extra)) throw new Error(t('connectors.extraMustObject'))
  }
  const raw = { ...extra }
  const description = modal.querySelector('[name="description"]')?.value.trim()
  if (description) raw.description = description
  const timeout = modal.querySelector('[name="timeout"]')?.value
  if (timeout) raw.timeout = Number(timeout)
  if (modal.querySelector('[name="disabled"]')?.checked) raw.disabled = true
  else raw.disabled = false

  if (mode === 'http') {
    raw.url = modal.querySelector('[name="url"]')?.value.trim() || ''
    const headers = linesToKeyValue(modal.querySelector('[name="headers"]')?.value || '')
    if (Object.keys(headers).length) raw.headers = headers
    delete raw.command
    delete raw.args
    delete raw.cwd
    delete raw.env
  } else {
    raw.command = modal.querySelector('[name="command"]')?.value.trim() || ''
    const args = linesToArgs(modal.querySelector('[name="args"]')?.value || '')
    if (args.length) raw.args = args
    const cwd = modal.querySelector('[name="cwd"]')?.value.trim()
    if (cwd) raw.cwd = cwd
    const env = linesToKeyValue(modal.querySelector('[name="env"]')?.value || '')
    if (Object.keys(env).length) raw.env = env
    delete raw.url
    delete raw.headers
  }
  return { id, raw }
}

function duplicateServer(page, state, id) {
  const server = state.servers.find(s => s.id === id)
  if (!server) return
  const nextId = uniqueId(state, `${id}-copy`)
  state.servers.push({ id: nextId, raw: cloneJson(server.raw) })
  markDirty(page, state, nextId)
}

function toggleServer(page, state, id) {
  const server = state.servers.find(s => s.id === id)
  if (!server) return
  const raw = cloneJson(server.raw)
  raw.disabled = !(raw.disabled === true || raw.enabled === false)
  delete raw.enabled
  server.raw = raw
  markDirty(page, state, id)
}

async function deleteServer(page, state, id) {
  const ok = await showConfirm({
    title: t('connectors.deleteTitle'),
    message: t('connectors.deleteConfirm', { id }),
    impact: [t('connectors.deleteImpact')],
    confirmText: t('connectors.delete'),
  })
  if (!ok) return
  state.servers = state.servers.filter(s => s.id !== id)
  state.selectedId = state.servers[0]?.id || ''
  markDirty(page, state, state.selectedId)
}

async function saveConfig(page, state) {
  try {
    const next = buildMcpConfigWithServers(state.rawConfig, state.servers, state.shape)
    await api.writeMcpConfig(next)
    state.rawConfig = next
    state.shape = getMcpConfigShape(next)
    state.servers = normalizeMcpServers(next)
    state.dirty = false
    renderWorkbench(page, state)
    toast(t('connectors.saveSuccess'), 'success')
  } catch (err) {
    toast(humanizeError(err, t('connectors.saveFailed')), 'error')
  }
}

function exportJson(state) {
  const next = buildMcpConfigWithServers(state.rawConfig, state.servers, state.shape)
  const text = JSON.stringify(next, null, 2)
  navigator.clipboard?.writeText(text).then(() => {
    toast(t('connectors.copied'), 'success')
  }).catch(() => {
    const modal = showContentModal({
      title: t('connectors.exportJson'),
      width: 720,
      content: `<textarea class="form-input connectors-textarea" rows="16" spellcheck="false">${esc(text)}</textarea>`,
    })
    modal.querySelector('textarea')?.select()
  })
}

function openImport(page, state) {
  const modal = showContentModal({
    title: t('connectors.importJson'),
    width: 720,
    buttons: [{ id: 'connectors-import-apply', className: 'btn btn-primary btn-sm', label: t('connectors.apply') }],
    content: `
      <div class="form-group">
        <label class="form-label">${t('connectors.importLabel')}</label>
        <textarea class="form-input connectors-textarea" id="connectors-import-text" rows="16" spellcheck="false" placeholder='{ "mcpServers": {} }'></textarea>
        <div class="form-hint">${t('connectors.importHint')}</div>
      </div>
      <div class="form-hint connectors-editor-error" id="connectors-import-error"></div>
    `,
  })
  modal.querySelector('#connectors-import-apply')?.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(modal.querySelector('#connectors-import-text')?.value || '{}')
      if (!isPlainObject(parsed)) throw new Error(t('connectors.extraMustObject'))
      const servers = normalizeMcpServers(parsed)
      const bad = servers.find(s => s.issues.length)
      if (bad) throw new Error(`${bad.id}: ${bad.issues.map(issueText).join(', ')}`)
      state.rawConfig = parsed
      state.shape = getMcpConfigShape(parsed)
      state.servers = servers
      state.selectedId = servers[0]?.id || ''
      state.dirty = true
      modal.close()
      renderWorkbench(page, state)
    } catch (err) {
      const errEl = modal.querySelector('#connectors-import-error')
      if (errEl) {
        errEl.style.color = 'var(--error)'
        errEl.textContent = err?.message || String(err)
      }
    }
  })
}
