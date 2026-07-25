/**
 * 使用情况页面 — 对接 OpenClaw Gateway sessions.usage API
 * 展示 Token 用量、费用、Top Models/Providers/Tools/Agents 等分析数据
 */
import { wsClient } from '../lib/ws-client.js'
import { toast } from '../components/toast.js'
import { icon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'
import { escapeHtml as esc } from '../lib/utils.js'

let _page = null, _unsubReady = null

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  _page = page

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('usage.title')}</h1>
      <p class="page-desc">${t('usage.desc')}</p>
    </div>
    <div class="usage-toolbar" style="display:flex;gap:8px;align-items:center;margin-bottom:var(--space-lg);flex-wrap:wrap">
      <button class="btn btn-sm ${_days === 1 ? 'btn-primary' : 'btn-secondary'}" data-days="1">${t('usage.today')}</button>
      <button class="btn btn-sm ${_days === 7 ? 'btn-primary' : 'btn-secondary'}" data-days="7">${t('usage.days7')}</button>
      <button class="btn btn-sm ${_days === 30 ? 'btn-primary' : 'btn-secondary'}" data-days="30">${t('usage.days30')}</button>
      <button class="btn btn-sm btn-secondary" id="btn-usage-refresh">${icon('refresh-cw', 14)} ${t('usage.refresh')}</button>
    </div>
    <div id="usage-content">
      <div class="stat-card loading-placeholder" style="height:120px"></div>
    </div>
  `

  page.querySelectorAll('[data-days]').forEach(btn => {
    btn.onclick = () => {
      _days = parseInt(btn.dataset.days)
      page.querySelectorAll('[data-days]').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary') })
      btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary')
      loadUsage(page)
    }
  })
  page.querySelector('#btn-usage-refresh')?.addEventListener('click', () => loadUsage(page))

  // 重试按钮（避免内联 onclick）
  page.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-usage-retry]')
    if (btn) { btn.disabled = true; loadUsage(page) }
  })

  loadUsage(page)
  return page
}

export function cleanup() {
  _page = null
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
}

let _days = 7

async function loadUsage(page) {
  const el = page.querySelector('#usage-content')
  el.innerHTML = `<div class="stat-card loading-placeholder" style="height:120px"></div>
    <div class="stat-card loading-placeholder" style="height:200px;margin-top:var(--space-md)"></div>`

  if (!wsClient.gatewayReady) {
    el.innerHTML = `<div class="usage-empty">
      <div style="color:var(--text-tertiary);margin-bottom:8px">${t('usage.gwConnecting')}</div>
      <div class="form-hint">${t('usage.gwWait')}</div>
    </div>`
    // 自动等待连接就绪后重试
    if (_unsubReady) _unsubReady()
    _unsubReady = wsClient.onReady(() => {
      if (_unsubReady) { _unsubReady(); _unsubReady = null }
      if (_page) loadUsage(_page)
    })
    return
  }

  try {
    const now = new Date()
    const end = toLocalDateKey(now)
    const start = toLocalDateKey(new Date(now.getTime() - (_days - 1) * 86400000))
    const data = await loadUsageData({ startDate: start, endDate: end, limit: 20 })
    renderUsage(el, data)
  } catch (e) {
    el.innerHTML = `<div class="usage-empty">
      <div style="color:var(--error);margin-bottom:8px">${t('usage.loadFailed')}: ${esc(e?.message || e)}</div>
      <div class="form-hint">${t('usage.loadFailedHint')}</div>
      <button class="btn btn-secondary btn-sm" style="margin-top:8px" data-usage-retry>${t('usage.retry')}</button>
    </div>`
  }
}

async function loadUsageData(params) {
  const data = await wsClient.requestCompat('sessions.usage', params, null)
  if (data) return normalizeUsageData(data, params)

  const fallback = await wsClient.request('sessions.list', { limit: Math.max(50, params.limit || 20) })
  return buildUsageFromSessionsList(fallback, params)
}

function toLocalDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function num(...values) {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeTotals(value = {}) {
  const input = num(value.input, value.inputTokens, value.input_tokens, value.promptTokens, value.prompt_tokens)
  const output = num(value.output, value.outputTokens, value.output_tokens, value.completionTokens, value.completion_tokens)
  const cacheRead = num(value.cacheRead, value.cacheReadTokens, value.cache_read_tokens, value.cachedTokens, value.cached_tokens)
  const cacheWrite = num(value.cacheWrite, value.cacheWriteTokens, value.cache_write_tokens)
  const totalTokens = num(value.totalTokens, value.total_tokens, value.tokens, input + output + cacheRead + cacheWrite)
  const inputCost = num(value.inputCost, value.input_cost)
  const outputCost = num(value.outputCost, value.output_cost)
  const totalCost = num(value.totalCost, value.total_cost, value.cost, inputCost + outputCost)
  return { input, output, cacheRead, cacheWrite, totalTokens, inputCost, outputCost, totalCost }
}

function normalizeMessageCounts(value = {}) {
  return {
    total: num(value.total, value.messages, value.messageCount, value.message_count),
    user: num(value.user, value.userMessages, value.user_messages),
    assistant: num(value.assistant, value.assistantMessages, value.assistant_messages),
    errors: num(value.errors, value.errorCount, value.error_count),
  }
}

function normalizeUsageData(data, range = {}) {
  const totals = normalizeTotals(data?.totals || data?.usage || {})
  const aggregates = data?.aggregates || {}
  const messages = normalizeMessageCounts(aggregates.messages || data?.messages || data?.messageCounts || data?.message_counts || {})
  const tools = aggregates.tools || data?.tools || {}

  const normalizeBucket = (items, keyName) => (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    [keyName]: item?.[keyName] || item?.name || item?.id || '',
    count: num(item?.count, item?.sessions, item?.messages),
    totals: normalizeTotals(item?.totals || item?.usage || item || {}),
  }))

  const dailySource = aggregates.daily || data?.daily || []
  const daily = (Array.isArray(dailySource) ? dailySource : []).map(day => ({
    ...day,
    date: day?.date || day?.day || '',
    tokens: num(day?.tokens, day?.totalTokens, day?.total_tokens),
    messages: num(day?.messages, day?.messageCount, day?.message_count),
  }))

  const sessions = normalizeSessions(data?.sessions || data?.items || [])
  return {
    ...data,
    startDate: data?.startDate || data?.start_date || range.startDate || '',
    endDate: data?.endDate || data?.end_date || range.endDate || '',
    totals,
    aggregates: {
      ...aggregates,
      messages,
      tools: {
        ...tools,
        totalCalls: num(tools.totalCalls, tools.total_calls, tools.calls),
        uniqueTools: num(tools.uniqueTools, tools.unique_tools),
        tools: Array.isArray(tools.tools) ? tools.tools : [],
      },
      byModel: normalizeBucket(aggregates.byModel || data?.byModel || data?.by_model, 'model'),
      byProvider: normalizeBucket(aggregates.byProvider || data?.byProvider || data?.by_provider, 'provider'),
      byAgent: normalizeBucket(aggregates.byAgent || data?.byAgent || data?.by_agent, 'agentId'),
      byChannel: normalizeBucket(aggregates.byChannel || data?.byChannel || data?.by_channel, 'channel'),
      daily,
    },
    sessions,
  }
}

function normalizeSessions(payload) {
  const sessions = Array.isArray(payload) ? payload : (Array.isArray(payload?.sessions) ? payload.sessions : Array.isArray(payload?.items) ? payload.items : [])
  return sessions.map(session => {
    const usage = normalizeTotals(session?.usage || session?.totals || session || {})
    usage.messageCounts = normalizeMessageCounts(session?.usage?.messageCounts || session?.usage?.message_counts || session?.usage?.messages || session?.messageCounts || session?.message_counts || session?.messages || session || {})
    const modelUsage = session?.usage?.modelUsage || session?.usage?.model_usage || []
    if (Array.isArray(modelUsage) && modelUsage.length) usage.modelUsage = modelUsage
    return {
      ...session,
      key: session?.key || session?.sessionKey || session?.session_key || session?.id || session?.sessionId || session?.session_id,
      sessionId: session?.sessionId || session?.session_id || session?.id,
      agentId: session?.agentId || session?.agent_id,
      model: session?.model || session?.usage?.model,
      modelProvider: session?.modelProvider || session?.model_provider || session?.provider,
      usage,
    }
  })
}

function sessionDateKey(session) {
  const value = session?.updatedAt || session?.updated_at || session?.lastMessageAt || session?.last_message_at || session?.createdAt || session?.created_at || session?.time || session?.timestamp
  if (!value) return ''
  const date = typeof value === 'number'
    ? new Date(value > 1e12 ? value : value * 1000)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return toLocalDateKey(date)
}

export function buildUsageFromSessionsList(payload, range = {}) {
  const sessions = normalizeSessions(payload)
    .filter(session => {
      const date = sessionDateKey(session)
      if (!date) return true
      return (!range.startDate || date >= range.startDate) && (!range.endDate || date <= range.endDate)
    })

  const totals = normalizeTotals({})
  const messages = normalizeMessageCounts({})
  const byModel = new Map()
  const byProvider = new Map()
  const byAgent = new Map()
  const byChannel = new Map()
  const daily = new Map()

  const addBucket = (map, key, usage) => {
    if (!key) return
    if (!map.has(key)) map.set(key, { count: 0, totals: normalizeTotals({}) })
    const row = map.get(key)
    row.count += 1
    mergeTotals(row.totals, usage)
  }

  for (const session of sessions) {
    const usage = session.usage || normalizeTotals({})
    mergeTotals(totals, usage)
    const counts = usage.messageCounts || {}
    messages.total += num(counts.total)
    messages.user += num(counts.user)
    messages.assistant += num(counts.assistant)
    messages.errors += num(counts.errors)
    addBucket(byModel, firstString(session.model, usage.modelUsage?.[0]?.model), usage)
    addBucket(byProvider, firstString(session.modelProvider, usage.modelUsage?.[0]?.provider), usage)
    addBucket(byAgent, firstString(session.agentId, 'main'), usage)
    addBucket(byChannel, firstString(session.channel, 'webchat'), usage)

    const date = sessionDateKey(session) || range.endDate || toLocalDateKey(new Date())
    if (!daily.has(date)) daily.set(date, { date, tokens: 0, messages: 0, sessions: 0 })
    const d = daily.get(date)
    d.tokens += usage.totalTokens || 0
    d.messages += counts.total || 0
    d.sessions += 1
  }

  const bucketArray = (map, keyName) => [...map.entries()]
    .map(([key, value]) => ({ [keyName]: key, count: value.count, totals: value.totals }))
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)

  return {
    startDate: range.startDate || '',
    endDate: range.endDate || '',
    totals,
    aggregates: {
      messages,
      tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
      byModel: bucketArray(byModel, 'model'),
      byProvider: bucketArray(byProvider, 'provider'),
      byAgent: bucketArray(byAgent, 'agentId'),
      byChannel: bucketArray(byChannel, 'channel'),
      daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    },
    sessions,
  }
}

function mergeTotals(target, source = {}) {
  target.input += num(source.input)
  target.output += num(source.output)
  target.cacheRead += num(source.cacheRead)
  target.cacheWrite += num(source.cacheWrite)
  target.totalTokens += num(source.totalTokens)
  target.inputCost += num(source.inputCost)
  target.outputCost += num(source.outputCost)
  target.totalCost += num(source.totalCost)
}

function renderUsage(el, data) {
  if (!data) { el.innerHTML = `<div class="usage-empty">${t('usage.noData')}</div>`; return }

  const totals = data.totals || {}
  const a = data.aggregates || {}
  const msgs = a.messages || {}
  const tools = a.tools || {}

  const fmtTokens = (n) => {
    if (n == null || n === 0) return '0'
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
    return String(n)
  }
  const fmtCost = (n) => n != null && n > 0 ? '$' + n.toFixed(4) : '$0'
  const fmtRate = (errors, total) => {
    if (!total) return '—'
    const pct = (errors / total * 100).toFixed(1)
    return pct + '%'
  }

  // ── 概览卡片 ──
  const overviewHtml = `
    <div class="stat-cards" style="margin-bottom:var(--space-lg)">
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${t('usage.messages')}</span></div>
        <div class="stat-card-value">${msgs.total || 0}</div>
        <div class="stat-card-meta">${msgs.user || 0} ${t('usage.userMsgs')} · ${msgs.assistant || 0} ${t('usage.assistantMsgs')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${t('usage.toolCalls')}</span></div>
        <div class="stat-card-value">${tools.totalCalls || 0}</div>
        <div class="stat-card-meta">${t('usage.toolKinds', { count: tools.uniqueTools || 0 })}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${t('usage.errors')}</span></div>
        <div class="stat-card-value">${msgs.errors || 0}</div>
        <div class="stat-card-meta">${t('usage.errorRate')} ${fmtRate(msgs.errors, msgs.total)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${t('usage.totalTokens')}</span></div>
        <div class="stat-card-value">${fmtTokens(totals.totalTokens)}</div>
        <div class="stat-card-meta">${fmtTokens(totals.input)} ${t('usage.input')} · ${fmtTokens(totals.output)} ${t('usage.output')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${t('usage.cost')}</span></div>
        <div class="stat-card-value">${fmtCost(totals.totalCost)}</div>
        <div class="stat-card-meta">${fmtCost(totals.inputCost)} ${t('usage.input')} · ${fmtCost(totals.outputCost)} ${t('usage.output')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${t('usage.sessions')}</span></div>
        <div class="stat-card-value">${(data.sessions || []).length}</div>
        <div class="stat-card-meta">${data.startDate || ''} ~ ${data.endDate || ''}</div>
      </div>
    </div>
  `

  // ── Top 排行 ──
  const renderTop = (title, items, keyFn, valueFn) => {
    if (!items || !items.length) return ''
    const rows = items.slice(0, 5).map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-primary)">
        <span style="font-size:var(--font-size-sm);color:var(--text-primary);font-weight:500">${esc(keyFn(item))}</span>
        <span style="font-size:var(--font-size-sm);color:var(--text-secondary);font-family:var(--font-mono)">${valueFn(item)}</span>
      </div>
    `).join('')
    return `
      <div class="usage-top-card">
        <div class="usage-top-title">${title}</div>
        ${rows}
      </div>
    `
  }

  const topModels = renderTop(t('usage.topModels'),
    a.byModel, m => m.model || t('usage.unknownModel'), m => fmtCost(m.totals?.totalCost) + ' · ' + fmtTokens(m.totals?.totalTokens))
  const topProviders = renderTop(t('usage.topProviders'),
    a.byProvider, p => p.provider || t('usage.unknownProvider'), p => fmtCost(p.totals?.totalCost) + ' · ' + t('usage.times', { count: p.count }))
  const topTools = renderTop(t('usage.topTools'),
    (tools.tools || []), item => item.name, item => t('usage.timesCall', { count: item.count }))
  const topAgents = renderTop(t('usage.topAgents'),
    a.byAgent, item => item.agentId || 'main', item => fmtCost(item.totals?.totalCost))
  const topChannels = renderTop(t('usage.topChannels'),
    a.byChannel, c => c.channel || 'webchat', c => fmtCost(c.totals?.totalCost))

  const topsHtml = `<div class="usage-tops-grid">${topModels}${topProviders}${topTools}${topAgents}${topChannels}</div>`

  // ── Token 分类 ──
  const tokenBreakdownHtml = `
    <div class="config-section" style="margin-top:var(--space-lg)">
      <div class="config-section-title">${t('usage.tokenBreakdown')}</div>
      <div style="display:flex;gap:var(--space-lg);flex-wrap:wrap;padding:var(--space-md)">
        <div><span style="display:inline-block;width:10px;height:10px;background:var(--error);border-radius:2px;margin-right:6px"></span>${t('usage.outputTokens')} ${fmtTokens(totals.output)}</div>
        <div><span style="display:inline-block;width:10px;height:10px;background:var(--accent);border-radius:2px;margin-right:6px"></span>${t('usage.inputTokens')} ${fmtTokens(totals.input)}</div>
        <div><span style="display:inline-block;width:10px;height:10px;background:var(--success);border-radius:2px;margin-right:6px"></span>${t('usage.cacheRead')} ${fmtTokens(totals.cacheRead)}</div>
        <div><span style="display:inline-block;width:10px;height:10px;background:var(--warning);border-radius:2px;margin-right:6px"></span>${t('usage.cacheWrite')} ${fmtTokens(totals.cacheWrite)}</div>
      </div>
    </div>
  `

  // ── 每日用量 ──
  const daily = a.daily || []
  let dailyHtml = ''
  if (daily.length > 0) {
    const maxTokens = Math.max(...daily.map(d => d.tokens || 0), 1)
    const bars = daily.map(d => {
      const pct = Math.max(1, Math.round((d.tokens || 0) / maxTokens * 100))
      const date = (d.date || '').slice(5) // MM-DD
      return `<div class="usage-daily-bar-wrap" title="${d.date}: ${fmtTokens(d.tokens)} tokens · ${d.messages || 0} msgs">
        <div class="usage-daily-bar" style="height:${pct}%"></div>
        <div class="usage-daily-label">${date}</div>
      </div>`
    }).join('')
    dailyHtml = `
      <div class="config-section" style="margin-top:var(--space-lg)">
        <div class="config-section-title">${t('usage.dailyUsage')}</div>
        <div class="usage-daily-chart">${bars}</div>
      </div>
    `
  }

  // ── 会话列表 ──
  const sessions = (data.sessions || []).slice(0, 10)
  let sessionsHtml = ''
  if (sessions.length > 0) {
    const rows = sessions.map(s => {
      const u = s.usage || {}
      const key = esc(s.key || '').replace(/^agent:main:/, '')
      const model = s.model || u.modelUsage?.[0]?.model || ''
      const provider = u.modelUsage?.[0]?.provider || s.modelProvider || ''
      return `<div class="session-row">
        <div class="session-row-header">
          <span class="session-key" title="${esc(s.key || '')}">${key || s.sessionId?.slice(0, 12) || '—'}</span>
          ${s.agentId ? `<span class="session-flag">${esc(s.agentId)}</span>` : ''}
          ${model ? `<span class="session-model">${esc(model)}</span>` : ''}
          ${provider ? `<span class="session-flag">${esc(provider)}</span>` : ''}
        </div>
        <div class="session-row-meta">${fmtTokens(u.totalTokens)} tokens · ${fmtCost(u.totalCost)} · ${(u.messageCounts?.total || 0)} msgs${u.messageCounts?.errors ? ' · ' + u.messageCounts.errors + ' err' : ''}</div>
      </div>`
    }).join('')
    sessionsHtml = `
      <div class="config-section" style="margin-top:var(--space-lg)">
        <div class="config-section-title">${t('usage.sessionDetail')} <span style="font-weight:normal;color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('usage.recentN', { count: sessions.length })}</span></div>
        <div class="session-list">${rows}</div>
      </div>
    `
  }

  el.innerHTML = overviewHtml + topsHtml + tokenBreakdownHtml + dailyHtml + sessionsHtml
}
