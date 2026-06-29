/**
 * OpenClaw memory-auto-capture hook configuration page.
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { showConfirm } from '../components/modal.js'
import { icon, statusIcon } from '../lib/icons.js'
import { escapeHtml } from '../lib/utils.js'

const PLUGIN_ID = 'memory-auto-capture'
const DEFAULT_OUTPUT_DIR = 'C:\\Users\\Kinnon\\.openclaw\\workspace\\memory_auto_capture\\events'
const DEFAULT_PLUGIN_CONFIG = {
  enabled: true,
  captureReceived: true,
  captureSent: true,
  maxContentChars: 4000,
  outputDir: DEFAULT_OUTPUT_DIR,
}

let _refreshTimer = null

export async function render() {
  const page = document.createElement('div')
  page.className = 'page memory-capture-page'
  page.innerHTML = `
    <div class="page-header memory-capture-header">
      <div>
        <h1 class="page-title">记忆捕获</h1>
        <p class="page-desc">管理 OpenClaw Hook 的消息事件账本配置。</p>
      </div>
      <div class="page-actions memory-capture-actions">
        <button class="btn btn-secondary btn-sm" data-action="reload">${icon('refresh-cw', 14)}刷新</button>
        <button class="btn btn-secondary btn-sm" data-action="restart">${icon('refresh-cw', 14)}重启 Gateway</button>
        <button class="btn btn-primary btn-sm" data-action="save">${icon('check', 14)}保存配置</button>
      </div>
    </div>

    <div class="memory-capture-grid">
      <section class="memory-capture-panel memory-capture-status-panel">
        <div class="memory-capture-panel-head">
          <h2>运行状态</h2>
          <span class="memory-capture-chip" id="mc-status-chip">读取中</span>
        </div>
        <div class="memory-capture-stats">
          <div class="memory-capture-stat">
            <span>插件入口</span>
            <strong id="mc-entry-state">-</strong>
          </div>
          <div class="memory-capture-stat">
            <span>Hook 开关</span>
            <strong id="mc-hook-state">-</strong>
          </div>
          <div class="memory-capture-stat">
            <span>捕获方向</span>
            <strong id="mc-direction-state">-</strong>
          </div>
        </div>
        <div class="memory-capture-path-block">
          <span>事件账本目录</span>
          <code id="mc-effective-path">-</code>
        </div>
        <div class="memory-capture-ledger" id="mc-ledger-panel">
          <div class="memory-capture-ledger-row">
            <span>最近事件文件</span>
            <strong>未读取</strong>
          </div>
        </div>
      </section>

      <section class="memory-capture-panel memory-capture-form-panel">
        <div class="memory-capture-panel-head">
          <h2>捕获规则</h2>
          <span class="memory-capture-dirty" id="mc-dirty" hidden>有未保存修改</span>
        </div>
        <form id="mc-form" class="memory-capture-form">
          ${toggleField('pluginEnabled', '总开关', '启用插件入口和 Hook 内部捕获逻辑')}
          ${toggleField('captureReceived', '收到的消息', '记录 message:received，适合保留用户输入与外部渠道消息')}
          ${toggleField('captureSent', '发出的消息', '记录 message:sent，适合回放 Agent 输出与同步结果')}
          <label class="memory-capture-field">
            <span class="memory-capture-label">单条内容上限</span>
            <input class="form-input" id="mc-max-content" type="number" min="200" max="50000" step="100" inputmode="numeric">
            <span class="memory-capture-hint">超过上限的内容会被截断后写入 JSONL。</span>
          </label>
          <label class="memory-capture-field memory-capture-field-wide">
            <span class="memory-capture-label">事件账本目录</span>
            <div class="memory-capture-input-row">
              <input class="form-input" id="mc-output-dir" spellcheck="false">
              <button class="btn btn-secondary btn-sm" type="button" data-action="reset-dir">${icon('refresh-cw', 14)}默认</button>
            </div>
            <span class="memory-capture-hint">每天生成一个 <code>YYYY-MM-DD.jsonl</code> 文件，后续记忆整理流程可以从这里读取。</span>
          </label>
        </form>
      </section>
    </div>

    <section class="memory-capture-panel memory-capture-preview-panel">
      <div class="memory-capture-panel-head">
        <h2>写入片段</h2>
        <span class="memory-capture-muted">plugins.entries.${PLUGIN_ID}</span>
      </div>
      <pre class="memory-capture-json" id="mc-json-preview">{}</pre>
    </section>
  `

  const state = {
    config: null,
    initial: null,
    current: { ...DEFAULT_PLUGIN_CONFIG },
    loading: true,
  }

  bindEvents(page, state)
  await loadConfig(page, state)
  return page
}

export function cleanup() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer)
    _refreshTimer = null
  }
}

function toggleField(id, label, hint) {
  return `
    <label class="memory-capture-toggle">
      <span class="memory-capture-toggle-copy">
        <span class="memory-capture-label">${escapeHtml(label)}</span>
        <span class="memory-capture-hint">${escapeHtml(hint)}</span>
      </span>
      <span class="toggle-switch">
        <input type="checkbox" id="mc-${id}">
        <span class="toggle-slider"></span>
      </span>
    </label>
  `
}

function bindEvents(page, state) {
  page.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    btn.disabled = true
    try {
      if (action === 'reload') {
        await loadConfig(page, state, true)
      } else if (action === 'save') {
        await saveConfig(page, state)
      } else if (action === 'reset-dir') {
        page.querySelector('#mc-output-dir').value = DEFAULT_OUTPUT_DIR
        collectForm(page, state)
      } else if (action === 'restart') {
        await restartGateway()
      }
    } finally {
      btn.disabled = false
    }
  })

  page.querySelector('#mc-form')?.addEventListener('input', () => collectForm(page, state))
  page.querySelector('#mc-form')?.addEventListener('change', () => collectForm(page, state))
}

async function loadConfig(page, state, notify = false) {
  setLoading(page, true)
  try {
    invalidate('read_openclaw_config')
    const config = await api.readOpenclawConfig()
    const pluginEntry = getPluginEntry(config)
    const current = normalizePluginConfig(pluginEntry)
    state.config = config || {}
    state.initial = JSON.stringify(current)
    state.current = current
    applyForm(page, current)
    renderStatus(page, pluginEntry, current)
    renderPreview(page, current)
    renderDirty(page, state)
    await refreshLedger(page, current.outputDir)
    if (notify) toast('记忆捕获配置已刷新', 'success')
  } catch (error) {
    renderLoadError(page, error)
    toast(humanizeError(error, '加载记忆捕获配置失败'), 'error')
  } finally {
    setLoading(page, false)
  }
}

function getPluginEntry(config) {
  return config?.plugins?.entries?.[PLUGIN_ID] || null
}

function normalizePluginConfig(entry) {
  const raw = entry?.config && typeof entry.config === 'object' ? entry.config : {}
  return {
    enabled: raw.enabled !== false && entry?.enabled !== false,
    captureReceived: raw.captureReceived !== false,
    captureSent: raw.captureSent !== false,
    maxContentChars: clampNumber(raw.maxContentChars, 200, 50000, DEFAULT_PLUGIN_CONFIG.maxContentChars),
    outputDir: String(raw.outputDir || DEFAULT_OUTPUT_DIR).trim() || DEFAULT_OUTPUT_DIR,
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function applyForm(page, current) {
  page.querySelector('#mc-pluginEnabled').checked = !!current.enabled
  page.querySelector('#mc-captureReceived').checked = !!current.captureReceived
  page.querySelector('#mc-captureSent').checked = !!current.captureSent
  page.querySelector('#mc-max-content').value = String(current.maxContentChars)
  page.querySelector('#mc-output-dir').value = current.outputDir
}

function collectForm(page, state) {
  state.current = {
    enabled: !!page.querySelector('#mc-pluginEnabled')?.checked,
    captureReceived: !!page.querySelector('#mc-captureReceived')?.checked,
    captureSent: !!page.querySelector('#mc-captureSent')?.checked,
    maxContentChars: clampNumber(page.querySelector('#mc-max-content')?.value, 200, 50000, DEFAULT_PLUGIN_CONFIG.maxContentChars),
    outputDir: String(page.querySelector('#mc-output-dir')?.value || DEFAULT_OUTPUT_DIR).trim() || DEFAULT_OUTPUT_DIR,
  }
  renderStatus(page, getPluginEntry(state.config), state.current)
  renderPreview(page, state.current)
  renderDirty(page, state)
  scheduleLedgerRefresh(page, state.current.outputDir)
}

async function saveConfig(page, state) {
  collectForm(page, state)
  const nextConfig = cloneJson(state.config || {})
  nextConfig.plugins = nextConfig.plugins && typeof nextConfig.plugins === 'object' ? nextConfig.plugins : {}
  nextConfig.plugins.entries = nextConfig.plugins.entries && typeof nextConfig.plugins.entries === 'object' ? nextConfig.plugins.entries : {}

  const previousEntry = nextConfig.plugins.entries[PLUGIN_ID] && typeof nextConfig.plugins.entries[PLUGIN_ID] === 'object'
    ? nextConfig.plugins.entries[PLUGIN_ID]
    : {}

  nextConfig.plugins.entries[PLUGIN_ID] = {
    ...previousEntry,
    enabled: state.current.enabled,
    config: {
      ...(previousEntry.config && typeof previousEntry.config === 'object' ? previousEntry.config : {}),
      enabled: state.current.enabled,
      captureReceived: state.current.captureReceived,
      captureSent: state.current.captureSent,
      maxContentChars: state.current.maxContentChars,
      outputDir: state.current.outputDir,
    },
  }

  try {
    await api.writeOpenclawConfig(nextConfig)
    state.config = nextConfig
    state.initial = JSON.stringify(state.current)
    renderDirty(page, state)
    renderStatus(page, getPluginEntry(state.config), state.current)
    toast('记忆捕获配置已保存，Gateway 会自动重载；如未生效可手动重启。', 'success')
  } catch (error) {
    toast(humanizeError(error, '保存记忆捕获配置失败'), 'error')
  }
}

async function restartGateway() {
  const ok = await showConfirm({
    title: '重启 Gateway',
    message: '重启会短暂中断正在连接的 OpenClaw 会话。确定现在重启吗？',
    confirmText: '重启',
    cancelText: '取消',
  })
  if (!ok) return
  try {
    await api.restartGateway()
    toast('Gateway 重启请求已发送', 'success')
  } catch (error) {
    toast(humanizeError(error, 'Gateway 重启失败'), 'error')
  }
}

function renderStatus(page, entry, current) {
  const entryEnabled = entry?.enabled !== false
  const hookEnabled = current.enabled
  const statusChip = page.querySelector('#mc-status-chip')
  const status = entryEnabled && hookEnabled ? 'active' : 'paused'
  if (statusChip) {
    statusChip.className = `memory-capture-chip memory-capture-chip-${status}`
    statusChip.innerHTML = `${status === 'active' ? statusIcon('ok', 14) : statusIcon('warn', 14)}${status === 'active' ? '已启用' : '已暂停'}`
  }
  page.querySelector('#mc-entry-state').textContent = entryEnabled ? '启用' : '关闭'
  page.querySelector('#mc-hook-state').textContent = hookEnabled ? '启用' : '关闭'
  page.querySelector('#mc-direction-state').textContent = directionText(current)
  page.querySelector('#mc-effective-path').textContent = current.outputDir
}

function directionText(current) {
  if (current.captureReceived && current.captureSent) return '收 / 发'
  if (current.captureReceived) return '仅收到'
  if (current.captureSent) return '仅发出'
  return '不捕获'
}

function renderPreview(page, current) {
  const preview = page.querySelector('#mc-json-preview')
  if (!preview) return
  const payload = {
    enabled: current.enabled,
    config: current,
  }
  preview.textContent = JSON.stringify(payload, null, 2)
}

function renderDirty(page, state) {
  const dirty = JSON.stringify(state.current) !== state.initial
  const el = page.querySelector('#mc-dirty')
  if (el) el.hidden = !dirty
}

function setLoading(page, loading) {
  page.classList.toggle('memory-capture-loading', loading)
  page.querySelectorAll('[data-action]').forEach(btn => {
    if (btn.dataset.action !== 'reset-dir') btn.disabled = loading
  })
}

function renderLoadError(page, error) {
  const chip = page.querySelector('#mc-status-chip')
  if (chip) {
    chip.className = 'memory-capture-chip memory-capture-chip-error'
    chip.innerHTML = `${statusIcon('err', 14)}读取失败`
  }
  const panel = page.querySelector('#mc-ledger-panel')
  if (panel) {
    panel.innerHTML = `<div class="memory-capture-error">${escapeHtml(String(error?.message || error))}</div>`
  }
}

function scheduleLedgerRefresh(page, outputDir) {
  if (_refreshTimer) clearTimeout(_refreshTimer)
  _refreshTimer = setTimeout(() => refreshLedger(page, outputDir), 350)
}

async function refreshLedger(page, outputDir) {
  const panel = page.querySelector('#mc-ledger-panel')
  if (!panel) return
  panel.innerHTML = `
    <div class="memory-capture-ledger-row">
      <span>最近事件文件</span>
      <strong>读取中</strong>
    </div>
  `
  try {
    const listing = await api.assistantListDir(outputDir)
    const files = parseLedgerListing(listing)
    if (!files.length) {
      panel.innerHTML = `
        <div class="memory-capture-ledger-row">
          <span>最近事件文件</span>
          <strong>暂无 JSONL</strong>
        </div>
        <div class="memory-capture-ledger-hint">Hook 写入第一条消息后会自动创建当天文件。</div>
      `
      return
    }
    const latest = files[files.length - 1]
    panel.innerHTML = `
      <div class="memory-capture-ledger-row">
        <span>最近事件文件</span>
        <strong>${escapeHtml(latest.name)}</strong>
      </div>
      <div class="memory-capture-ledger-row">
        <span>文件大小</span>
        <strong>${formatBytes(latest.size)}</strong>
      </div>
      <div class="memory-capture-ledger-hint">${escapeHtml(outputDir)}</div>
    `
  } catch {
    panel.innerHTML = `
      <div class="memory-capture-ledger-row">
        <span>最近事件文件</span>
        <strong>目录暂不可读</strong>
      </div>
      <div class="memory-capture-ledger-hint">保存配置不依赖目录预读；目录会在 Hook 写入时按需创建。</div>
    `
  }
}

function parseLedgerListing(listing) {
  return String(listing || '')
    .split(/\r?\n/)
    .map(line => {
      const match = line.match(/^\[FILE\]\s+(.+?\.jsonl)\s+\((\d+)\s+bytes\)/i)
      if (!match) return null
      return { name: match[1], size: Number(match[2]) || 0 }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function formatBytes(value) {
  const size = Number(value) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}))
}
