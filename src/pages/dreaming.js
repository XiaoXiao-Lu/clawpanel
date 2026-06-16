import { showConfirm } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { t } from '../lib/i18n.js'
import { icon } from '../lib/icons.js'
import { wsClient } from '../lib/ws-client.js'
import { navigate } from '../router.js'
import { escapeHtml as esc } from '../lib/utils.js'

let _page = null
let _unsubReady = null
let _state = createState()

function createState() {
  return {
    loading: true,
    actionLoading: false,
    view: 'scene',
    unsupported: false,
    error: '',
    status: null,
    configSnapshot: null,
    pluginId: 'memory-core',
    pluginSupportsDreaming: null,
    toggleBlockedReason: '',
    diaryPath: 'DREAMS.md',
    diaryContent: null,
    diarySupported: true,
    actionsSupported: true,
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeInt(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const record = asRecord(entry)
    if (!record) return null
    const snippet = normalizeString(record.snippet)
    const path = normalizeString(record.path)
    const key = normalizeString(record.key || path || snippet)
    if (!snippet && !path) return null
    return {
      key: key || `${path}:${normalizeInt(record.startLine, 1)}`,
      snippet,
      path,
      startLine: normalizeInt(record.startLine, 1),
      endLine: normalizeInt(record.endLine, 1),
      recallCount: normalizeInt(record.recallCount, 0),
      dailyCount: normalizeInt(record.dailyCount, 0),
      groundedCount: normalizeInt(record.groundedCount, 0),
      totalSignalCount: normalizeInt(record.totalSignalCount, 0),
      phaseHitCount: normalizeInt(record.phaseHitCount, 0),
      promotedAt: normalizeString(record.promotedAt || ''),
    }
  }).filter(Boolean)
}

function normalizePhase(raw) {
  const record = asRecord(raw)
  return {
    enabled: record?.enabled === true,
    cron: normalizeString(record?.cron),
    nextRunAtMs: typeof record?.nextRunAtMs === 'number' && Number.isFinite(record.nextRunAtMs) ? record.nextRunAtMs : null,
    limit: normalizeInt(record?.limit, 0),
    lookbackDays: normalizeInt(record?.lookbackDays, 0),
    minScore: typeof record?.minScore === 'number' && Number.isFinite(record.minScore) ? record.minScore : null,
    minPatternStrength: typeof record?.minPatternStrength === 'number' && Number.isFinite(record.minPatternStrength) ? record.minPatternStrength : null,
    minRecallCount: normalizeInt(record?.minRecallCount, 0),
    minUniqueQueries: normalizeInt(record?.minUniqueQueries, 0),
  }
}

function normalizeStatus(raw) {
  const record = asRecord(raw)
  if (!record) return null
  const phases = asRecord(record.phases)
  return {
    enabled: record.enabled === true,
    timezone: normalizeString(record.timezone || ''),
    storageMode: normalizeString(record.storageMode || 'inline'),
    shortTermCount: normalizeInt(record.shortTermCount, 0),
    groundedSignalCount: normalizeInt(record.groundedSignalCount, 0),
    totalSignalCount: normalizeInt(record.totalSignalCount, 0),
    promotedToday: normalizeInt(record.promotedToday, 0),
    promotedTotal: normalizeInt(record.promotedTotal, 0),
    storePath: normalizeString(record.storePath || 'MEMORY.md'),
    shortTermEntries: normalizeEntries(record.shortTermEntries),
    signalEntries: normalizeEntries(record.signalEntries),
    promotedEntries: normalizeEntries(record.promotedEntries),
    phases: {
      light: normalizePhase(phases?.light),
      deep: normalizePhase(phases?.deep),
      rem: normalizePhase(phases?.rem),
    },
  }
}

function isUnsupportedError(error) {
  const msg = String(error?.message || error || '').toLowerCase()
  return msg.includes('unknown method') || msg.includes('not found') || msg.includes('unsupported') || msg.includes('不支持')
}

function errorMessage(error) {
  return String(error?.message || error || '')
}

function lookupIncludesDreamingProperty(value) {
  const lookup = asRecord(value)
  const children = Array.isArray(lookup?.children) ? lookup.children : []
  return children.some((child) => normalizeString(asRecord(child)?.key) === 'dreaming')
}

function lookupDisallowsUnknownProperties(value) {
  const lookup = asRecord(value)
  const schema = asRecord(lookup?.schema)
  return schema?.additionalProperties === false
}

function parseDiarySections(content) {
  if (typeof content !== 'string') return []
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const matches = Array.from(normalized.matchAll(/^(#{1,6})\s+(.+)$/gm))
  if (!matches.length) {
    return [{ title: `${t('dreaming.diarySection')} 1`, body: normalized }]
  }
  const result = []
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]
    const start = (current.index ?? 0) + current[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? normalized.length) : normalized.length
    const title = normalizeString(current[2], `${t('dreaming.diarySection')} ${i + 1}`).trim() || `${t('dreaming.diarySection')} ${i + 1}`
    const body = normalized.slice(start, end).trim()
    result.push({ title, body: body || current[0] })
  }
  return result.filter((section) => section.title || section.body)
}


function formatNextRun(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return t('dreaming.notScheduled')
  return new Date(ms).toLocaleString()
}

function resolveNextRun(status) {
  if (!status?.phases) return null
  const values = Object.values(status.phases)
    .filter((phase) => phase.enabled && typeof phase.nextRunAtMs === 'number')
    .map((phase) => phase.nextRunAtMs)
    .sort((a, b) => a - b)
  return values[0] ?? null
}

function resolveMemoryPluginId(config) {
  const root = asRecord(config)
  const plugins = asRecord(root?.plugins)
  const slots = asRecord(plugins?.slots)
  const slot = normalizeString(slots?.memory || '').trim()
  if (slot && slot.toLowerCase() !== 'none') return slot
  return 'memory-core'
}

async function ensureGatewayReady(page) {
  if (wsClient.connected && wsClient.gatewayReady) return true
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
  _unsubReady = wsClient.onReady(() => {
    if (_unsubReady) { _unsubReady(); _unsubReady = null }
    if (_page === page) loadAll(page)
  })
  return false
}

export function render() {
  const page = document.createElement('div')
  page.className = 'page'
  _page = page
  _state = createState()
  renderPage(page)
  setTimeout(() => loadAll(page), 0)
  return page
}

export function cleanup() {
  _page = null
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
}

async function loadAll(page) {
  if (_page !== page) return
  if (!(await ensureGatewayReady(page))) {
    _state.loading = false
    _state.actionLoading = false
    renderPage(page)
    return
  }

  _state.loading = true
  _state.error = ''
  _state.unsupported = false
  _state.toggleBlockedReason = ''
  _state.pluginSupportsDreaming = null
  renderPage(page)

  const [statusResult, diaryResult, configResult] = await Promise.allSettled([
    wsClient.request('doctor.memory.status', {}),
    wsClient.request('doctor.memory.dreamDiary', {}),
    wsClient.request('config.get', {}),
  ])

  if (_page !== page) return

  if (statusResult.status === 'fulfilled') {
    _state.status = normalizeStatus(statusResult.value?.dreaming ?? statusResult.value)
    _state.actionsSupported = true
  } else {
    _state.status = null
    _state.error = errorMessage(statusResult.reason)
    _state.unsupported = isUnsupportedError(statusResult.reason)
    _state.actionsSupported = !_state.unsupported
  }

  if (diaryResult.status === 'fulfilled') {
    const payload = diaryResult.value || {}
    _state.diaryPath = normalizeString(payload.path || 'DREAMS.md')
    _state.diaryContent = payload.found === false ? null : (typeof payload.content === 'string' ? payload.content : null)
    _state.diarySupported = true
  } else {
    _state.diarySupported = !isUnsupportedError(diaryResult.reason)
    if (!_state.diarySupported) {
      _state.diaryContent = null
    } else if (!_state.error) {
      _state.error = errorMessage(diaryResult.reason)
    }
  }

  if (configResult.status === 'fulfilled') {
    const snapshot = asRecord(configResult.value)
    _state.configSnapshot = snapshot && typeof snapshot.hash === 'string' ? snapshot : null
    _state.pluginId = resolveMemoryPluginId(_state.configSnapshot?.config)
    if (!_state.configSnapshot?.hash) {
      _state.toggleBlockedReason = t('dreaming.configUnavailable')
    } else {
      try {
        const lookup = await wsClient.request('config.schema.lookup', {
          path: `plugins.entries.${_state.pluginId}.config`,
        })
        const hasDreaming = lookupIncludesDreamingProperty(lookup)
        const strictSchema = lookupDisallowsUnknownProperties(lookup)
        if (hasDreaming) {
          _state.pluginSupportsDreaming = true
        } else if (strictSchema) {
          _state.pluginSupportsDreaming = false
          _state.toggleBlockedReason = t('dreaming.pluginUnsupported')
        }
      } catch (lookupError) {
        if (!isUnsupportedError(lookupError) && !_state.toggleBlockedReason) {
          _state.toggleBlockedReason = ''
        }
      }
    }
  } else {
    _state.configSnapshot = null
    _state.toggleBlockedReason = t('dreaming.configUnavailable')
  }

  _state.loading = false
  _state.actionLoading = false
  renderPage(page)
}

async function runAction(method, successText, options = {}) {
  if (!_page || _state.actionLoading) return
  if (!(wsClient.connected && wsClient.gatewayReady)) {
    toast(t('dreaming.gwWait'), 'warning')
    return
  }
  _state.actionLoading = true
  renderPage(_page)
  try {
    await wsClient.request(method, {})
    toast(successText, 'success')
    await loadAll(_page)
  } catch (e) {
    if (isUnsupportedError(e)) {
      toast(t('dreaming.rpcUnsupported'), 'warning')
    } else {
      toast(`${t('dreaming.loadFailed')}: ${e?.message || e}`, 'error')
    }
    _state.actionLoading = false
    renderPage(_page)
  }
}

async function toggleDreaming() {
  if (!_page || _state.actionLoading) return
  if (!(wsClient.connected && wsClient.gatewayReady)) {
    toast(t('dreaming.gwWait'), 'warning')
    return
  }
  if (_state.toggleBlockedReason) {
    toast(_state.toggleBlockedReason, 'warning')
    return
  }
  if (!_state.configSnapshot?.hash) {
    toast(t('dreaming.configUnavailable'), 'warning')
    return
  }
  if (_state.pluginSupportsDreaming === false) {
    toast(t('dreaming.pluginUnsupported'), 'warning')
    return
  }
  const enabled = _state.status?.enabled === true
  const pluginId = resolveMemoryPluginId(_state.configSnapshot.config)
  _state.actionLoading = true
  renderPage(_page)
  try {
    await wsClient.request('config.patch', {
      baseHash: _state.configSnapshot.hash,
      raw: JSON.stringify({
        plugins: {
          entries: {
            [pluginId]: {
              config: {
                dreaming: {
                  enabled: !enabled,
                },
              },
            },
          },
        },
      }),
      sessionKey: wsClient.sessionKey || undefined,
      note: 'Dreaming settings updated from ClawPanel.',
    })
    toast(!enabled ? t('dreaming.enabled') : t('dreaming.disabled'), 'success')
    await loadAll(_page)
  } catch (e) {
    if (isUnsupportedError(e)) {
      if (!_state.toggleBlockedReason) _state.toggleBlockedReason = t('dreaming.pluginUnsupported')
      toast(t('dreaming.rpcUnsupported'), 'warning')
    } else {
      toast(`${t('dreaming.toggleFailed')}: ${errorMessage(e)}`, 'error')
    }
    _state.actionLoading = false
    renderPage(_page)
  }
}

function renderStatCard(label, value, meta = '') {
  return `
    <div class="stat-card">
      <div class="stat-card-header"><span class="stat-card-label">${esc(label)}</span></div>
      <div class="stat-card-value">${esc(value)}</div>
      ${meta ? `<div class="stat-card-meta">${esc(meta)}</div>` : ''}
    </div>
  `
}

function renderPhaseCard(title, phase) {
  const meta = [
    phase.cron ? `${t('dreaming.cron')}: ${phase.cron}` : t('dreaming.notScheduled'),
    phase.nextRunAtMs ? `${t('dreaming.nextRun')}: ${formatNextRun(phase.nextRunAtMs)}` : '',
  ].filter(Boolean).join(' · ')

  const details = [
    phase.limit ? `limit ${phase.limit}` : '',
    phase.lookbackDays ? `lookback ${phase.lookbackDays}d` : '',
    typeof phase.minScore === 'number' ? `score≥${phase.minScore}` : '',
    typeof phase.minPatternStrength === 'number' ? `pattern≥${phase.minPatternStrength}` : '',
    phase.minRecallCount ? `recalls≥${phase.minRecallCount}` : '',
    phase.minUniqueQueries ? `uniq≥${phase.minUniqueQueries}` : '',
  ].filter(Boolean).join(' · ')

  return `
    <div class="config-section dream-phase-card">
      <div class="config-section-title dream-phase-header">
        <span>${esc(title)}</span>
        <span class="badge${phase.enabled ? ' badge-success' : ''}">${esc(phase.enabled ? t('dreaming.statusEnabled') : t('dreaming.statusDisabled'))}</span>
      </div>
      <div class="form-hint">${esc(meta || t('dreaming.notScheduled'))}</div>
      ${details ? `<div class="dream-phase-details">${esc(details)}</div>` : ''}
    </div>
  `
}

function renderEntries(title, entries) {
  const content = entries.length
    ? entries.slice(0, 8).map((entry) => `
        <div class="dream-entry">
          <div class="dream-entry-snippet">${esc(entry.snippet || '(empty)')}</div>
          <div class="dream-entry-path">${esc(entry.path)}${entry.startLine ? ':' + entry.startLine : ''}${entry.endLine && entry.endLine !== entry.startLine ? '-' + entry.endLine : ''}</div>
          <div class="dream-entry-meta">
            ${esc([
              entry.recallCount ? `${entry.recallCount} recall` : '',
              entry.dailyCount ? `${entry.dailyCount} daily` : '',
              entry.groundedCount ? `${entry.groundedCount} grounded` : '',
              entry.totalSignalCount ? `${entry.totalSignalCount} signals` : '',
              entry.phaseHitCount ? `${entry.phaseHitCount} ${t('dreaming.phaseHits')}` : '',
            ].filter(Boolean).join(' · '))}
          </div>
        </div>
      `).join('')
    : `<div class="form-hint">${esc(t('dreaming.noEntries'))}</div>`

  return `
    <div class="config-section dream-entries-card">
      <div class="config-section-title">${esc(title)}</div>
      ${content}
    </div>
  `
}

function renderActionButtons(enabled, disabledAttr) {
  const toggleText = enabled ? t('dreaming.toggleOff') : t('dreaming.toggleOn')
  const actionsDisabled = !_state.actionsSupported ? 'disabled title="' + esc(t('dreaming.rpcUnsupported')) + '"' : disabledAttr
  const diaryDisabled = !_state.diarySupported ? 'disabled title="' + esc(t('dreaming.rpcUnsupported')) + '"' : disabledAttr
  return `
    <div class="dream-actions">
      <button class="btn btn-sm ${enabled ? 'btn-warning' : 'btn-primary'}" id="btn-dreaming-toggle" ${disabledAttr}>${esc(_state.actionLoading ? t('dreaming.actionRunning') : toggleText)}</button>
      <button class="btn btn-sm btn-secondary" id="btn-dreaming-backfill" ${diaryDisabled}>${esc(t('dreaming.backfill'))}</button>
      <button class="btn btn-sm btn-secondary" id="btn-dreaming-reset-diary" ${diaryDisabled}>${esc(t('dreaming.resetDiary'))}</button>
      <button class="btn btn-sm btn-secondary" id="btn-dreaming-clear-grounded" ${actionsDisabled}>${esc(t('dreaming.clearGrounded'))}</button>
    </div>
  `
}

function renderStatusHints() {
  const hints = []
  if (_state.toggleBlockedReason) hints.push(`<div class="form-hint dream-hint-blocked">${esc(_state.toggleBlockedReason)}</div>`)
  if (!_state.diarySupported || !_state.actionsSupported) hints.push(`<div class="form-hint dream-hint-unsupported">${esc(t('dreaming.rpcUnsupported'))}</div>`)
  if (_state.error && !_state.unsupported) hints.push(`<div class="dream-hint-error">${esc(_state.error)}</div>`)
  return hints.join('')
}

function renderViewTabs() {
  return `
    <div class="tab-bar dream-tabs">
      <div class="tab${_state.view === 'scene' ? ' active' : ''}" data-dreaming-view="scene">${esc(t('dreaming.viewScene'))}</div>
      <div class="tab${_state.view === 'diary' ? ' active' : ''}" data-dreaming-view="diary">${esc(t('dreaming.viewDiary'))}</div>
    </div>
  `
}

function renderDreamLane(title, subtitle, entries, accent) {
  const tones = {
    violet: { dot: 'var(--brand, #a855f7)', border: 'var(--accent)' },
    cyan: { dot: 'var(--info, #22d3ee)', border: 'var(--success)' },
    amber: { dot: 'var(--warning, #fbbf24)', border: 'var(--warning)' },
  }
  const tone = tones[accent] || tones.violet
  const items = entries.length
    ? entries.slice(0, 4).map((entry, idx) => `
        <div class="dream-lane-item${idx < Math.min(entries.length, 4) - 1 ? ' dream-lane-item--bordered' : ''}">
          <div class="dream-lane-dot" style="background:${tone.dot}"></div>
          <div class="dream-lane-content">
            <div class="dream-lane-snippet">${esc(entry.snippet || '(empty)')}</div>
            <div class="dream-lane-path">${esc(entry.path)}${entry.startLine ? ':' + entry.startLine : ''}</div>
          </div>
        </div>
      `).join('')
    : `<div class="form-hint">${esc(t('dreaming.noEntries'))}</div>`
  return `
    <div class="config-section dream-lane" style="border-left-color:${tone.border}">
      <div class="config-section-title dream-lane-header">
        <span>${esc(title)}</span>
        <span class="badge dream-lane-badge">${entries.length}</span>
      </div>
      <div class="form-hint dream-lane-subtitle">${esc(subtitle)}</div>
      ${items}
    </div>
  `
}

function renderSceneView(status, enabled, heroText, disabledAttr, nextRun) {
  const STARS = [
    { top: 8, left: 15, size: 3, delay: 0 },
    { top: 12, left: 72, size: 2, delay: 1.4 },
    { top: 22, left: 35, size: 3, delay: 0.6 },
    { top: 18, left: 88, size: 2, delay: 2.1 },
    { top: 35, left: 8, size: 2, delay: 0.9 },
    { top: 45, left: 92, size: 2, delay: 1.7 },
    { top: 55, left: 25, size: 3, delay: 2.5 },
    { top: 65, left: 78, size: 2, delay: 0.3 },
    { top: 75, left: 45, size: 2, delay: 1.1 },
    { top: 82, left: 60, size: 3, delay: 1.8 },
    { top: 30, left: 55, size: 2, delay: 0.4 },
    { top: 88, left: 18, size: 2, delay: 2.3 },
  ]
  const starsHtml = STARS.map(s => `<div class="dream-star" style="top:${s.top}%;left:${s.left}%;width:${s.size}px;height:${s.size}px;animation-delay:${s.delay}s"></div>`).join('')

  return `
    <div class="dream-hero">
      ${starsHtml}
      <div class="dream-moon"></div>
      <span class="dream-z">z</span>
      <span class="dream-z">z</span>
      <span class="dream-z">Z</span>

      <div class="dream-hero-body">
        <div class="dream-hero-main">
          <div class="badge${enabled ? ' badge-success' : ''} dream-hero-badge">${esc(enabled ? t('dreaming.statusEnabled') : t('dreaming.statusDisabled'))}</div>
          <div class="dream-hero-title">${esc(t('dreaming.sceneTitle'))}</div>
          <div class="dream-hero-desc">${esc(t('dreaming.sceneDesc'))}</div>
          <div class="dream-hero-text">${esc(heroText)}</div>
          <div class="dream-hero-tags">
            <span class="badge">${esc(`${t('dreaming.nextRun')}: ${nextRun}`)}</span>
            <span class="badge">${esc(`${t('dreaming.timezone')}: ${status?.timezone || '—'}`)}</span>
            <span class="badge">${esc(`${t('dreaming.memoryPath')}: ${status?.storePath || 'MEMORY.md'}`)}</span>
          </div>
        </div>
        <div class="dream-hero-actions">
          ${renderActionButtons(enabled, disabledAttr)}
        </div>
      </div>
      ${renderStatusHints()}
      <div class="dream-stats-row">
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('dreaming.sceneConstellation'))}</div><div class="ds-value">${esc(status?.shortTermCount ?? 0)}</div></div>
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('dreaming.sceneSignals'))}</div><div class="ds-value">${esc(status?.totalSignalCount ?? 0)}</div></div>
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('dreaming.scenePromotions'))}</div><div class="ds-value">${esc(status?.promotedTotal ?? 0)}</div></div>
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('dreaming.sceneQueue'))}</div><div class="ds-value">${esc((status?.shortTermEntries || []).length)}</div></div>
      </div>
    </div>

    <div class="stat-cards dream-stat-cards">
      ${renderStatCard(t('dreaming.promotedToday'), status?.promotedToday ?? 0)}
      ${renderStatCard(t('dreaming.grounded'), status?.groundedSignalCount ?? 0)}
      ${renderStatCard(t('dreaming.storageMode'), status?.storageMode || 'inline')}
      ${renderStatCard(t('dreaming.shortTerm'), status?.shortTermCount ?? 0, `${t('dreaming.memoryPath')}: ${status?.storePath || 'MEMORY.md'}`)}
      ${renderStatCard(t('dreaming.signals'), status?.totalSignalCount ?? 0, `${t('dreaming.diaryPath')}: ${_state.diaryPath || 'DREAMS.md'}`)}
    </div>

    <div class="dream-phase-grid">
      ${renderPhaseCard(t('dreaming.phaseLight'), status?.phases?.light || normalizePhase(null))}
      ${renderPhaseCard(t('dreaming.phaseDeep'), status?.phases?.deep || normalizePhase(null))}
      ${renderPhaseCard(t('dreaming.phaseRem'), status?.phases?.rem || normalizePhase(null))}
    </div>

    <div class="dream-lane-grid">
      ${renderDreamLane(t('dreaming.sceneQueue'), t('dreaming.entriesShortTerm'), status?.shortTermEntries || [], 'violet')}
      ${renderDreamLane(t('dreaming.sceneSignals'), t('dreaming.entriesSignals'), status?.signalEntries || [], 'cyan')}
      ${renderDreamLane(t('dreaming.scenePromotions'), t('dreaming.entriesPromoted'), status?.promotedEntries || [], 'amber')}
    </div>
  `
}

function renderDiaryView(status, enabled, heroText, disabledAttr) {
  const sections = parseDiarySections(_state.diaryContent)
  const diaryUnavailable = !_state.diarySupported

  let diaryBody = ''
  if (diaryUnavailable) {
    diaryBody = `
      <div class="config-section dream-diary-unavailable">
        <div class="config-section-title">${esc(t('dreaming.diary'))}</div>
        <div class="form-hint dream-diary-hint">${esc(t('dreaming.rpcUnsupported'))}</div>
      </div>`
  } else {
    diaryBody = `
      <div class="dream-diary-grid">
        <div class="config-section dream-diary-sections">
          <div class="config-section-title">${esc(t('dreaming.diarySections'))}</div>
          ${sections.length
            ? sections.map((section, idx) => `
                <div class="dream-diary-item${idx === sections.length - 1 ? ' dream-diary-item--last' : ''}">
                  <div class="dream-diary-item-header">
                    <span class="badge${idx === 0 ? ' badge-success' : ''}">${esc(`${t('dreaming.diarySection')} ${idx + 1}`)}</span>
                    <span class="dream-diary-item-title">${esc(section.title)}</span>
                  </div>
                  <div class="dream-diary-item-body">${esc(section.body.slice(0, 220) || section.title)}</div>
                </div>
              `).join('')
            : `<div class="form-hint dream-diary-hint">${esc(t('dreaming.diaryEmpty'))}<br>${esc(t('dreaming.diaryEmptyHint'))}</div>`}
        </div>

        <div class="config-section dream-diary-raw">
          <div class="config-section-title">${esc(t('dreaming.diaryRaw'))}</div>
          ${typeof _state.diaryContent === 'string'
            ? `<pre class="dream-diary-pre">${esc(_state.diaryContent)}</pre>`
            : `<div class="form-hint dream-diary-hint">${esc(t('dreaming.diaryEmpty'))}<br>${esc(t('dreaming.diaryEmptyHint'))}</div>`}
        </div>
      </div>`
  }

  return `
    <div class="config-section dream-diary-header">
      <div class="dream-diary-header-body">
        <div class="dream-diary-header-main">
          <div class="config-section-title">${esc(t('dreaming.diary'))}</div>
          <div class="dream-diary-header-desc">${esc(heroText)}</div>
          <div class="dream-diary-header-tags">
            <span class="badge${enabled ? ' badge-success' : ''}">${esc(enabled ? t('dreaming.statusEnabled') : t('dreaming.statusDisabled'))}</span>
            <span class="badge">${esc(`${t('dreaming.diaryPath')}: ${_state.diaryPath || 'DREAMS.md'}`)}</span>
            ${!diaryUnavailable ? `<span class="badge">${esc(`${t('dreaming.diarySections')}: ${sections.length}`)}</span>` : ''}
          </div>
        </div>
        ${renderActionButtons(enabled, disabledAttr)}
      </div>
      ${renderStatusHints()}
    </div>

    ${diaryBody}
  `
}

function bindEvents(page) {
  page.querySelectorAll('[data-dreaming-view]').forEach((tab) => {
    tab.addEventListener('click', () => {
      _state.view = tab.dataset.dreamingView || 'scene'
      renderPage(page)
    })
  })
  page.querySelector('#btn-dreaming-refresh')?.addEventListener('click', () => loadAll(page))
  page.querySelector('#btn-dreaming-open-memory')?.addEventListener('click', () => navigate('/memory'))
  page.querySelector('#btn-dreaming-toggle')?.addEventListener('click', () => toggleDreaming())
  page.querySelector('#btn-dreaming-backfill')?.addEventListener('click', () => runAction('doctor.memory.backfillDreamDiary', t('dreaming.backfillDone')))
  page.querySelector('#btn-dreaming-reset-diary')?.addEventListener('click', async () => {
    const yes = await showConfirm({
      title: t('dreaming.resetDiaryTitle'),
      message: t('dreaming.confirmResetDiary'),
      impact: [
        t('dreaming.resetDiaryImpactContent'),
        t('dreaming.resetDiaryImpactReplay'),
      ],
      confirmText: t('dreaming.resetDiaryBtn'),
      cancelText: t('dreaming.resetDiaryCancel'),
    })
    if (!yes) return
    runAction('doctor.memory.resetDreamDiary', t('dreaming.resetDiaryDone'))
  })
  page.querySelector('#btn-dreaming-clear-grounded')?.addEventListener('click', async () => {
    const yes = await showConfirm({
      title: t('dreaming.clearGroundedTitle'),
      message: t('dreaming.confirmClearGrounded'),
      impact: [
        t('dreaming.clearGroundedImpact'),
        t('dreaming.clearGroundedImpactNext'),
      ],
      confirmText: t('dreaming.clearGroundedBtn'),
      cancelText: t('dreaming.clearGroundedCancel'),
    })
    if (!yes) return
    runAction('doctor.memory.resetGroundedShortTerm', t('dreaming.clearGroundedDone'))
  })
}

function renderPage(page) {
  const status = _state.status
  const ready = wsClient.connected && wsClient.gatewayReady
  const enabled = status?.enabled === true
  const nextRun = formatNextRun(resolveNextRun(status))
  const heroText = enabled ? t('dreaming.heroActive') : t('dreaming.heroIdle')
  const disabledAttr = _state.actionLoading || !ready ? 'disabled' : ''

  let body = ''

  if (_state.loading) {
    body = `
      <div class="stat-card loading-placeholder dream-skeleton-hero"></div>
      <div class="stat-card loading-placeholder dream-skeleton-body"></div>
    `
  } else if (!ready) {
    body = `
      <div class="config-section dream-connecting">
        <div class="dream-connecting-text">${esc(t('dreaming.gwConnecting'))}</div>
        <div class="form-hint">${esc(t('dreaming.gwWait'))}</div>
      </div>
    `
  } else if (_state.unsupported) {
    body = `
      <div class="config-section dream-error-card">
        <div class="config-section-title">${esc(t('dreaming.loadFailed'))}</div>
        <div class="dream-error-text">${esc(_state.error || t('dreaming.unsupportedHint'))}</div>
        <div class="form-hint dream-error-hint">${esc(t('dreaming.loadFailedHint'))}</div>
      </div>
    `
  } else {
    body = renderViewTabs() + (_state.view === 'diary'
      ? renderDiaryView(status, enabled, heroText, disabledAttr)
      : renderSceneView(status, enabled, heroText, disabledAttr, nextRun))
  }

  page.innerHTML = `
    <style>
      @keyframes dream-twinkle { 0%,100% { opacity:.3; transform:scale(1) } 50% { opacity:1; transform:scale(1.6) } }
      @keyframes dream-float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-6px) } }
      @keyframes dream-z { 0% { opacity:0; transform:translate(0,0) scale(.6) } 30% { opacity:.7 } 100% { opacity:0; transform:translate(18px,-32px) scale(1.1) } }
      .dream-hero { position:relative; overflow:hidden; border-radius:22px; min-height:280px; padding:28px 24px 24px; background:radial-gradient(circle at 20% 10%, rgba(139,92,246,0.42), rgba(15,23,42,0.94) 52%), linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%); color:#f8fafc; box-shadow:0 24px 64px rgba(15,23,42,0.35); margin-bottom:var(--space-lg); display:flex; flex-direction:column; justify-content:space-between }
      .dream-star { position:absolute; border-radius:999px; background:rgba(255,255,255,0.85); box-shadow:0 0 12px rgba(255,255,255,0.35); animation:dream-twinkle 3s ease-in-out infinite }
      .dream-moon { position:absolute; z-index:0; top:22px; right:28px; width:100px; height:100px; border-radius:999px; background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.98), rgba(224,231,255,0.92) 38%, rgba(196,181,253,0.56) 62%, rgba(99,102,241,0.16) 100%); box-shadow:0 0 32px rgba(196,181,253,0.45), 0 0 88px rgba(99,102,241,0.18); animation:dream-float 6s ease-in-out infinite }
      .dream-z { position:absolute; top:28px; right:140px; font-size:16px; font-weight:700; color:var(--text-tertiary); animation:dream-z 2.5s ease-out infinite }
      .dream-z:nth-child(2) { animation-delay:.8s; font-size:13px; right:148px; top:22px }
      .dream-z:nth-child(3) { animation-delay:1.6s; font-size:20px; right:132px; top:16px }
      .dream-hero .badge { background:rgba(255,255,255,0.1); color:#f8fafc; border-color:rgba(255,255,255,0.15) }
      .dream-hero .badge-success { background:rgba(74,222,128,0.15); color:var(--success); border-color:rgba(74,222,128,0.25) }
      .dream-hero .btn-primary { background:rgba(99,102,241,0.85) }
      .dream-hero .btn-secondary { background:rgba(255,255,255,0.08); color:#f8fafc; border-color:rgba(255,255,255,0.15) }
      .dream-hero .btn-secondary:hover { background:rgba(255,255,255,0.14) }
      .dream-hero .btn-secondary:disabled { opacity:.4 }
      .dream-hero .btn-warning { background:rgba(251,191,36,0.2); color:var(--warning); border-color:rgba(251,191,36,0.3) }
      .dream-hero .form-hint { color:rgba(226,232,240,0.72) }
      .dream-stats-row { position:relative; z-index:1; display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-top:22px }
      .dream-stat-glass { padding:14px 16px; border-radius:16px; background:rgba(255,255,255,0.06); backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,0.08) }
      .dream-stat-glass .ds-label { font-size:12px; color:rgba(226,232,240,0.72) }
      .dream-stat-glass .ds-value { font-size:22px; font-weight:700; margin-top:4px; color:#f8fafc }
      .dream-hero-body { position:relative; z-index:1; display:flex; justify-content:space-between; gap:18px; align-items:flex-start; flex-wrap:wrap }
      .dream-hero-main { max-width:600px; min-width:min(100%,320px) }
      .dream-hero-badge { margin-bottom:10px }
      .dream-hero-title { font-size:26px; font-weight:700; letter-spacing:-0.02em; margin-bottom:10px; color:#ffffff }
      .dream-hero-desc { font-size:13px; line-height:1.8; color:rgba(226,232,240,0.82); max-width:540px }
      .dream-hero-text { margin-top:12px; font-size:13px; line-height:1.8; color:#f8fafc }
      .dream-hero-tags { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px }
      .dream-hero-actions { position:relative; z-index:1; display:flex; flex-direction:column; gap:10px; align-items:flex-end; max-width:420px }
      @media (max-width:900px) { .dream-hero { min-height:320px } .dream-hero-actions { width:100%; align-items:flex-start } .dream-actions { width:100% } }
      .dream-stat-cards { margin-bottom:var(--space-lg) }
      .dream-phase-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:var(--space-md); margin-bottom:var(--space-lg) }
      .dream-lane-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:var(--space-md) }
      .dream-tabs { margin-bottom:var(--space-lg) }
      .dream-actions { display:flex; gap:8px; flex-wrap:wrap }
      .dream-hint-blocked { margin-top:10px }
      .dream-hint-unsupported { margin-top:8px; color:var(--text-tertiary) }
      .dream-hint-error { margin-top:12px; color:var(--warning) }
      .dream-phase-card { margin:0 }
      .dream-phase-header { display:flex; justify-content:space-between; align-items:center; gap:8px }
      .dream-phase-details { margin-top:8px; font-size:12px; color:var(--text-secondary) }
      .dream-entries-card { margin:0 }
      .dream-entry { padding:10px 0; border-bottom:1px solid var(--border-primary) }
      .dream-entry:last-child { border-bottom:none }
      .dream-entry-snippet { font-size:13px; color:var(--text-primary); line-height:1.6 }
      .dream-entry-path { margin-top:6px; font-size:12px; color:var(--text-secondary) }
      .dream-entry-meta { margin-top:4px; font-size:12px; color:var(--text-tertiary) }
      .dream-lane { margin:0; border-left:3px solid }
      .dream-lane-header { display:flex; align-items:center; gap:8px }
      .dream-lane-badge { font-size:11px }
      .dream-lane-subtitle { margin-bottom:8px }
      .dream-lane-item { display:flex; gap:10px; align-items:flex-start; padding:10px 0 }
      .dream-lane-item--bordered { border-bottom:1px solid var(--border-primary) }
      .dream-lane-dot { width:8px; height:8px; border-radius:999px; margin-top:6px; flex-shrink:0 }
      .dream-lane-content { min-width:0 }
      .dream-lane-snippet { font-size:13px; line-height:1.6; color:var(--text-primary) }
      .dream-lane-path { margin-top:4px; font-size:12px; color:var(--text-tertiary) }
      .dream-diary-header { margin-bottom:var(--space-lg) }
      .dream-diary-header-body { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap }
      .dream-diary-header-main { flex:1; min-width:280px }
      .dream-diary-header-desc { font-size:13px; line-height:1.8; color:var(--text-secondary) }
      .dream-diary-header-tags { margin-top:10px; display:flex; gap:8px; flex-wrap:wrap }
      .dream-diary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:var(--space-md) }
      .dream-diary-sections { margin:0 }
      .dream-diary-raw { margin:0 }
      .dream-diary-item { padding:14px 0; border-bottom:1px solid var(--border-primary) }
      .dream-diary-item--last { border-bottom:none }
      .dream-diary-item-header { display:flex; align-items:center; gap:8px; margin-bottom:8px }
      .dream-diary-item-title { font-weight:600; color:var(--text-primary) }
      .dream-diary-item-body { font-size:13px; line-height:1.7; color:var(--text-secondary) }
      .dream-diary-pre { white-space:pre-wrap; word-break:break-word; background:var(--bg-secondary); border-radius:var(--radius-md); padding:var(--space-md); font-size:12px; line-height:1.7; max-height:560px; overflow:auto }
      .dream-diary-hint { line-height:1.8 }
      .dream-diary-unavailable { margin:0; border-left:3px solid var(--warning) }
      .dream-skeleton-hero { height:120px }
      .dream-skeleton-body { height:220px; margin-top:var(--space-md) }
      .dream-connecting { color:var(--text-tertiary); margin-bottom:8px }
      .dream-error-card { border-left:3px solid var(--warning) }
      .dream-error-text { color:var(--warning); line-height:1.7 }
      .dream-error-hint { margin-top:8px }
      .dream-page-actions { display:flex; gap:8px; flex-wrap:wrap }
    </style>
    <div class="page-header">
      <h1 class="page-title">${t('dreaming.title')}</h1>
      <p class="page-desc">${t('dreaming.desc')}</p>
      <div class="page-actions dream-page-actions">
        <button class="btn btn-sm btn-secondary" id="btn-dreaming-refresh">${icon('refresh-cw', 14)} ${t('dreaming.refresh')}</button>
        <button class="btn btn-sm btn-secondary" id="btn-dreaming-open-memory">${t('dreaming.openMemory')}</button>
      </div>
    </div>
    ${body}
  `

  bindEvents(page)
}
