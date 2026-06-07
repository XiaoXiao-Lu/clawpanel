/**
 * Agent 管理页面
 * Agent 增删改查 + 身份编辑
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { showModal, showConfirm } from '../components/modal.js'
import { CHANNEL_LABELS } from '../lib/channel-labels.js'
import { t } from '../lib/i18n.js'
import { listAgentsCompat } from '../lib/api-compat.js'
import { hasFeature } from '../lib/kernel.js'
import { termHelpHtml, attachTermTooltips } from '../lib/term-tooltip.js'

const SHOW_OFFICE_DEMO = import.meta.env.DEV || localStorage.getItem('agentOfficeDemo') === '1'
const SHOW_OFFICE_STRESS = import.meta.env.DEV || localStorage.getItem('agentOfficeStress') === '1'

function tr(key, fallback, params) {
  const value = t(key, params)
  return value === key ? fallback : value
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page agents-page'

  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t('agents.title')}</h1>
        <p class="page-desc">${t('agents.desc')}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-add-agent">${tr('agents.addAgent', '新增 Agent')}</button>
      </div>
    </div>
    <div class="page-content">
      <div class="agent-office-shell">
        <div class="agent-office-head">
          <div>
            <div class="agent-office-eyebrow">Agent digital office</div>
            <h2 class="agent-office-title">办公室监控</h2>
          </div>
          <div class="agent-office-legend">
            <span><i class="is-idle"></i>空闲</span>
            <span><i class="is-working"></i>工作中</span>
            <span><i class="is-blocked"></i>阻塞</span>
            <span><i class="is-error"></i>异常</span>
          </div>
          <div class="agent-office-actions">
            <div class="agent-office-view-tabs" aria-label="办公室视角">
              <button class="btn btn-sm btn-secondary is-active" data-office-view="overview">全景</button>
              <button class="btn btn-sm btn-secondary" data-office-view="work">工位</button>
              <button class="btn btn-sm btn-secondary" data-office-view="lounge">休息区</button>
            </div>
            <button class="btn btn-sm btn-secondary" id="agent-office-focus">专注视图</button>
            ${SHOW_OFFICE_DEMO ? '<button class="btn btn-sm btn-secondary" id="agent-office-demo">演示动态</button>' : ''}
            ${SHOW_OFFICE_STRESS ? `
              <label class="agent-office-stress-control" title="开发压测只影响当前 3D 可视化，不会写入 Agent 配置">
                <span>压测</span>
                <select id="agent-office-stress-size" aria-label="压测 Agent 数量">
                  <option value="30">30</option>
                  <option value="60" selected>60</option>
                  <option value="100">100</option>
                </select>
              </label>
              <button class="btn btn-sm btn-secondary" id="agent-office-stress">开始压测</button>
            ` : ''}
          </div>
        </div>
        <div id="agent-office-summary" class="agent-office-summary" aria-label="Agent office summary"></div>
        <div id="agent-office-diagnostics" class="agent-office-diagnostics" aria-label="Agent office diagnostics"></div>
        <div class="agent-office-body">
          <div id="agent-office-scene" class="agent-office-scene" aria-label="Agent office scene"></div>
          <aside class="agent-office-sidebar" aria-label="Agent office monitoring">
            <section id="agent-office-panel" class="agent-office-panel"></section>
            <section id="agent-office-activity" class="agent-office-activity"></section>
          </aside>
        </div>
      </div>
      <div id="agents-stats-bar" class="agents-stats-bar"></div>
      <div class="agents-toolbar">
        <div class="models-search-wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="form-input" id="agents-search" placeholder="${tr('agents.detailHint', '搜索 Agent、模型或工作区')}">
        </div>
      </div>
      <div id="agents-list"></div>
    </div>
  `

  const state = { agents: [], bindings: [], activities: [], search: '', officeStressSize: 60 }
  page.querySelector('#agent-office-panel').innerHTML = `
    <div class="agent-office-panel-empty">
      <div class="agent-office-panel-title">办公室加载中</div>
      <div class="agent-office-panel-desc">正在准备 3D Agent 办公室视图。</div>
    </div>
  `
  initOfficeScene(page, state)

  // 非阻塞：先返回 DOM，后台加载数据
  loadAgents(page, state)

  page.querySelector('#btn-add-agent').addEventListener('click', () => showAddAgentDialog(page, state))

  // 搜索过滤
  page.querySelector('#agents-search').oninput = (e) => {
    state.search = e.target.value.trim().toLowerCase()
    renderAgents(page, state)
  }

  page.querySelector('#agent-office-panel').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-office-detail]')
    if (!btn) return
    location.hash = `#/agent-detail?id=${encodeURIComponent(btn.dataset.officeDetail)}`
  })

  page.querySelector('#agent-office-scene').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-office-agent]')
    if (!btn) return
    state.selectedOfficeAgentId = btn.dataset.officeAgent
    state.officeScene?.setSelectedAgent?.(state.selectedOfficeAgentId)
    renderOffice(page, state)
  })

  page.querySelector('#agent-office-activity').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-office-agent]')
    if (!btn) return
    state.selectedOfficeAgentId = btn.dataset.officeAgent
    state.officeScene?.setSelectedAgent?.(state.selectedOfficeAgentId)
    renderOffice(page, state)
  })

  page.querySelector('.agent-office-view-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-office-view]')
    if (!btn) return
    setOfficeView(page, state, btn.dataset.officeView)
  })

  page.querySelector('#agent-office-demo')?.addEventListener('click', () => {
    toggleOfficeDemo(page, state)
  })

  page.querySelector('#agent-office-stress')?.addEventListener('click', () => {
    toggleOfficeStress(page, state)
  })

  page.querySelector('#agent-office-stress-size')?.addEventListener('change', (e) => {
    state.officeStressSize = Number(e.target.value) || 60
    if (state.officeStress) {
      state.officeStressAgents = createStressAgents(state.agents, state.officeStressSize)
      state.officeStressStartedAt = Date.now()
      renderOffice(page, state)
    }
    renderOfficeDiagnostics(page, state)
  })

  page.querySelector('#agent-office-focus')?.addEventListener('click', () => {
    toggleOfficeFocus(page, state)
  })

  return page
}

async function initOfficeScene(page, state) {
  if (!canUseWebGL()) {
    state.officeSceneFallback = true
    page.querySelector('#agent-office-scene').innerHTML = `
      <div class="agent-office-fallback">
        <div class="agent-office-fallback-title">2D 监控视图</div>
        <div class="agent-office-fallback-desc">当前设备不可用 WebGL，已切换到低负载状态板。</div>
        <div class="agent-office-fallback-grid"></div>
      </div>
    `
    renderOffice(page, state)
    return
  }
  try {
    const mod = await import('../components/agent-office-scene.js')
    state.renderAgentOfficePanel = mod.renderAgentOfficePanel
    state.officeScene = new mod.AgentOfficeScene(page.querySelector('#agent-office-scene'), {
      onMetrics: (metrics) => {
        state.officeMetrics = metrics
        renderOfficeSummary(page, state)
        renderOfficeDiagnostics(page, state)
      },
      onSelect: (agent) => {
        state.selectedOfficeAgentId = agent.id
        const selected = state.officeAgents?.find(a => a.id === agent.id) || state.agents.find(a => a.id === agent.id) || agent
        state.officeScene?.setSelectedAgent?.(agent.id)
        state.renderAgentOfficePanel?.(page.querySelector('#agent-office-panel'), selected)
      },
    })
    state.officeScene.setViewMode?.(state.officeView || 'overview')
    state.renderAgentOfficePanel(page.querySelector('#agent-office-panel'), null)

    const observer = new MutationObserver(() => {
      if (!document.body.contains(page)) {
        state.officeScene?.dispose()
        if (state.officeDemoTimer) clearInterval(state.officeDemoTimer)
        if (state.officeStressTimer) clearInterval(state.officeStressTimer)
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    renderOffice(page, state)
  } catch (e) {
    state.officeSceneFallback = true
    page.querySelector('#agent-office-panel').innerHTML = `
      <div class="agent-office-panel-empty">
        <div class="agent-office-panel-title">办公室加载失败</div>
        <div class="agent-office-panel-desc">${escHtml(e)}</div>
      </div>
    `
    page.querySelector('#agent-office-scene').innerHTML = `
      <div class="agent-office-fallback">
        <div class="agent-office-fallback-title">2D 监控视图</div>
        <div class="agent-office-fallback-desc">3D 办公室初始化失败，已切换到低负载状态板。</div>
        <div class="agent-office-fallback-grid"></div>
      </div>
    `
    renderOffice(page, state)
  }
}

function renderSkeleton(container) {
  const item = () => `
    <div class="agent-card" style="pointer-events:none">
      <div class="agent-card-header">
        <div class="skeleton" style="width:40px;height:40px;border-radius:50%"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div class="skeleton" style="width:45%;height:16px;border-radius:4px"></div>
          <div class="skeleton" style="width:60%;height:12px;border-radius:4px"></div>
        </div>
      </div>
    </div>`
  container.innerHTML = [item(), item(), item()].join('')
}

async function loadAgents(page, state) {
  const container = page.querySelector('#agents-list')
  renderSkeleton(container)
  try {
    const [agents, config, activity] = await Promise.all([
      listAgentsCompat(),
      api.readOpenclawConfig().catch(() => null),
      api.listAgentActivity().catch(() => null),
    ])
    state.agents = agents
    state.bindings = Array.isArray(config?.bindings) ? config.bindings : []
    state.activities = Array.isArray(activity?.items) ? activity.items : []
    state.activityUpdatedAt = latestActivityTime(state.activities)
    renderAgents(page, state)
    renderOffice(page, state)
    renderActivityRail(page, state)
    startActivityStream(page, state)

    // 只在第一次加载时绑定事件（避免重复绑定）
    if (!state.eventsAttached) {
      attachAgentEvents(page, state)
      state.eventsAttached = true
    }
  } catch (e) {
    container.innerHTML = '<div style="color:var(--error);padding:20px">' + tr('agents.loadFailed', '加载失败') + ': ' + String(e).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
    toast(humanizeError(e, tr('agents.loadListFailed', 'Agent 列表加载失败')), 'error')
  }
}

function activityForAgent(agent, state) {
  return (state.activities || []).find(item => item.agentId === agent?.id) || null
}

function officeStateForAgent(agent, state, activity = null) {
  if (!agent) return 'offline'
  const explicit = normalizeOfficeState(activity?.state || activityForAgent(agent, state)?.state || agent.activity?.state)
  if (explicit) return explicit
  if (agent.error || agent.status === 'error') return 'error'
  if (agent.status === 'blocked') return 'blocked'
  if (agent.status === 'running' || agent.active) return 'working'
  return 'idle'
}

function normalizeOfficeState(value) {
  const raw = String(value || '').toLowerCase()
  if (!raw) return ''
  if (['idle', 'offline', 'queued', 'walking', 'working', 'tool_call', 'thinking', 'blocked', 'error', 'done'].includes(raw)) return raw
  if (['running', 'streaming', 'responding', 'busy', 'active'].includes(raw)) return 'working'
  if (['tool', 'tool_calling', 'tool-use', 'tool_use', 'function_call'].includes(raw)) return 'tool_call'
  if (['planning', 'reasoning', 'analyzing'].includes(raw)) return 'thinking'
  if (['waiting', 'pending', 'scheduled'].includes(raw)) return 'queued'
  if (['failed', 'failure', 'crashed'].includes(raw)) return 'error'
  if (['complete', 'completed', 'success', 'succeeded'].includes(raw)) return 'done'
  if (['paused', 'blocked_by_user', 'needs_input'].includes(raw)) return 'blocked'
  return ''
}

function renderOffice(page, state) {
  const sourceAgents = getOfficeSourceAgents(state)
  const agents = sourceAgents.map(agent => {
    const bindingCount = agent.bindingCount ?? (state.bindings || []).filter(b => (b.agentId || 'main') === agent.id).length
    const activity = state.officeStress
      ? stressActivityForAgent(agent, state)
      : state.officeDemo
        ? demoActivityForAgent(agent, state)
        : activityForAgent(agent, state)
    return {
      ...agent,
      activity,
      officeState: officeStateForAgent(agent, state, activity),
      bindingCount: activity?.bindingCount ?? bindingCount,
    }
  })
  state.officeAgents = agents
  const selected = agents.find(a => a.id === state.selectedOfficeAgentId) || agents[0] || null
  state.selectedOfficeAgentId = selected?.id || null
  if (state.officeScene && state.renderAgentOfficePanel) {
    state.officeScene.setAgents(agents)
    state.officeScene.setSelectedAgent?.(state.selectedOfficeAgentId)
    state.renderAgentOfficePanel(page.querySelector('#agent-office-panel'), selected)
  } else if (state.renderAgentOfficePanel) {
    state.renderAgentOfficePanel(page.querySelector('#agent-office-panel'), selected)
  } else {
    renderOfficeFallbackPanel(page, selected)
  }
  renderOfficeFallback(page, state)
  renderOfficeSummary(page, state)
  renderOfficeDiagnostics(page, state)
  renderActivityRail(page, state)
}

function renderOfficeSummary(page, state) {
  const el = page.querySelector('#agent-office-summary')
  if (!el) return
  const agents = state.officeAgents || []
  const counts = agents.reduce((acc, agent) => {
    const key = agent.officeState || 'idle'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const working = ['queued', 'walking', 'working', 'tool_call', 'thinking', 'done'].reduce((sum, key) => sum + (counts[key] || 0), 0)
  const blocked = counts.blocked || 0
  const error = counts.error || 0
  const idle = counts.idle || Math.max(0, agents.length - working - blocked - error)
  const metrics = state.officeMetrics || {}
  const flowText = state.officeStress
    ? '压测数据'
    : state.officeDemo
      ? '演示数据'
      : state.activityStreamStatus === 'failed'
        ? '活动流异常'
        : state.activityStreamStatus === 'connected'
          ? `活动流 ${formatShortTime(state.activityUpdatedAt)}`
          : '活动流启动中'
  el.innerHTML = `
    <div class="agent-office-summary-item">
      <span>Agent 总数</span>
      <strong>${agents.length}</strong>
    </div>
    <div class="agent-office-summary-item is-working">
      <span>运行中</span>
      <strong>${working}</strong>
    </div>
    <div class="agent-office-summary-item is-blocked">
      <span>阻塞</span>
      <strong>${blocked}</strong>
    </div>
    <div class="agent-office-summary-item is-error">
      <span>异常</span>
      <strong>${error}</strong>
    </div>
    <div class="agent-office-summary-item is-idle">
      <span>空闲</span>
      <strong>${idle}</strong>
    </div>
    <div class="agent-office-summary-item is-perf">
      <span>场景性能</span>
      <strong>${metrics.fps ? `${metrics.fps} FPS` : '--'}</strong>
      <small>${metrics.qualityLabel || '--'} · ${metrics.labels ?? 0} 标签 · ${metrics.agents ?? agents.length} 角色</small>
    </div>
    <div class="agent-office-summary-item is-flow">
      <span>任务流</span>
      <strong>${working + blocked + error}</strong>
      <small>${escHtml(flowText)}</small>
    </div>
  `
}

function renderOfficeDiagnostics(page, state) {
  const el = page.querySelector('#agent-office-diagnostics')
  if (!el) return
  const metrics = state.officeMetrics || {}
  const agents = state.officeAgents || []
  const source = state.officeStress ? '压测' : state.officeDemo ? '演示' : '真实'
  const stream = state.officeStress || state.officeDemo
    ? '模拟数据'
    : state.activityStreamStatus === 'failed'
      ? '活动流异常'
      : state.activityStreamStatus === 'connected'
        ? `活动流在线 · ${formatShortTime(state.activityUpdatedAt)}`
        : '活动流连接中'
  const qualityReason = {
    initial: '初始化',
    'agent-count': '角色数量',
    fps: '帧率采样',
    auto: '自动',
  }[metrics.qualityReason] || metrics.qualityReason || '自动'
  const assetLabel = metrics.assetType === 'procedural-v2'
    ? 'Procedural v2'
    : metrics.assetType || '未加载'
  const triangles = Number(metrics.triangles || 0).toLocaleString()
  const drawCalls = Number(metrics.drawCalls || 0).toLocaleString()
  const shadows = metrics.shadows ? '阴影开' : '阴影关'
  const pixelRatio = metrics.pixelRatio || '--'
  const statusClass = metrics.quality === 'low' || state.activityStreamStatus === 'failed'
    ? 'is-warning'
    : metrics.quality === 'medium'
      ? 'is-attention'
      : 'is-ok'
  el.className = `agent-office-diagnostics ${statusClass}`
  el.innerHTML = `
    <div class="agent-office-diagnostic-main">
      <span>${escHtml(source)}监控</span>
      <strong>${escHtml(metrics.qualityLabel || '--')}</strong>
      <small>${escHtml(qualityReason)} · ${escHtml(stream)}</small>
    </div>
    <div class="agent-office-diagnostic-grid">
      <span><b>${escHtml(assetLabel)}</b><small>资产</small></span>
      <span><b>${drawCalls}</b><small>Draw calls</small></span>
      <span><b>${triangles}</b><small>Triangles</small></span>
      <span><b>${pixelRatio}x</b><small>Pixel ratio</small></span>
      <span><b>${escHtml(shadows)}</b><small>Render</small></span>
      <span><b>${agents.length}</b><small>Agents</small></span>
    </div>
  `
}

function stateLabel(state) {
  const map = {
    idle: '空闲',
    queued: '排队',
    walking: '移动中',
    working: '工作中',
    tool_call: '调用工具',
    thinking: '思考中',
    blocked: '阻塞',
    error: '异常',
    done: '完成',
    offline: '离线',
  }
  return map[state] || state || '未知'
}

function renderOfficeFallback(page, state) {
  const grid = page.querySelector('.agent-office-fallback-grid')
  if (!grid) return
  const agents = state.officeAgents || []
  grid.innerHTML = agents.map(agent => `
    <button class="agent-office-fallback-card is-${escHtml(agent.officeState)} ${agent.id === state.selectedOfficeAgentId ? 'is-selected' : ''}" data-office-agent="${escHtml(agent.id)}" aria-pressed="${agent.id === state.selectedOfficeAgentId ? 'true' : 'false'}">
      <span>${escHtml(stateLabel(agent.officeState))}</span>
      <strong>${escHtml(agent.identityName || agent.id)}</strong>
      <small>${escHtml(agent.activity?.taskTitle || agent.activity?.progressText || '等待调度')}</small>
    </button>
  `).join('') || '<div class="agent-office-fallback-empty">暂无 Agent</div>'
}

function renderOfficeFallbackPanel(page, agent) {
  const panel = page.querySelector('#agent-office-panel')
  if (!panel) return
  if (!agent) {
    panel.innerHTML = `
      <div class="agent-office-panel-empty">
        <div class="agent-office-panel-title">暂无 Agent</div>
        <div class="agent-office-panel-desc">创建 Agent 后，这里会显示对应的模型、工作区、渠道绑定和实时任务。</div>
      </div>
    `
    return
  }
  panel.innerHTML = `
    <div class="agent-office-panel-head">
      <div>
        <div class="agent-office-panel-kicker">${escHtml(stateLabel(agent.officeState))}</div>
        <div class="agent-office-panel-title">${escHtml(agent.identityName || agent.id)}</div>
      </div>
    </div>
    <div class="agent-office-panel-grid">
      <div><span>ID</span><strong>${escHtml(agent.id)}</strong></div>
      <div><span>模型</span><strong>${escHtml(typeof agent.model === 'object' ? (agent.model?.primary || agent.model?.id || '未设置') : (agent.model || '未设置'))}</strong></div>
      <div><span>工作区</span><strong>${escHtml(agent.workspace || '未设置')}</strong></div>
      <div><span>当前任务</span><strong>${escHtml(agent.activity?.taskTitle || '暂无任务')}</strong></div>
      <div><span>进度</span><strong>${escHtml(agent.activity?.progressText || '等待调度')}</strong></div>
    </div>
    <button class="btn btn-sm btn-primary agent-office-detail-btn" data-office-detail="${escHtml(agent.id)}">进入 Agent 详情</button>
  `
}

function toggleOfficeFocus(page, state) {
  state.officeFocus = !state.officeFocus
  page.classList.toggle('agents-page--office-focus', state.officeFocus)
  const btn = page.querySelector('#agent-office-focus')
  if (btn) {
    btn.textContent = state.officeFocus ? '退出专注' : '专注视图'
    btn.classList.toggle('btn-primary', state.officeFocus)
    btn.classList.toggle('btn-secondary', !state.officeFocus)
  }
  setTimeout(() => state.officeScene?.resize?.(), 60)
}

function setOfficeView(page, state, mode) {
  state.officeView = ['overview', 'work', 'lounge'].includes(mode) ? mode : 'overview'
  page.querySelectorAll('[data-office-view]').forEach(btn => {
    const active = btn.dataset.officeView === state.officeView
    btn.classList.toggle('is-active', active)
    btn.classList.toggle('btn-primary', active)
    btn.classList.toggle('btn-secondary', !active)
  })
  state.officeScene?.setViewMode?.(state.officeView)
}

function demoActivityForAgent(agent, state) {
  const index = state.agents.findIndex(a => a.id === agent.id)
  const phase = Math.floor((Date.now() - (state.officeDemoStartedAt || Date.now())) / 6200)
  const offset = (index + phase) % 6
  const states = ['idle', 'walking', 'working', 'thinking', 'tool_call', 'blocked']
  const current = states[offset] || 'idle'
  if (current === 'idle') return { agentId: agent.id, state: 'idle', progressText: '休息区待命', updatedAt: Date.now() }
  const labels = {
    walking: '走向工位',
    working: '处理渠道消息',
    thinking: '分析上下文',
    tool_call: '调用工具',
    blocked: '等待人工确认',
  }
  return {
    agentId: agent.id,
    state: current,
    taskTitle: labels[current],
    progressText: current === 'blocked' ? '需要检查输入或权限' : '演示动态，不影响真实任务',
    toolName: current === 'tool_call' ? 'workspace.read' : '',
    source: 'demo',
    updatedAt: Date.now(),
  }
}

function toggleOfficeDemo(page, state) {
  if (!SHOW_OFFICE_DEMO) return
  state.officeDemo = !state.officeDemo
  state.officeDemoStartedAt = Date.now()
  const btn = page.querySelector('#agent-office-demo')
  if (btn) {
    btn.textContent = state.officeDemo ? '关闭演示' : '演示动态'
    btn.classList.toggle('btn-primary', state.officeDemo)
    btn.classList.toggle('btn-secondary', !state.officeDemo)
  }
  if (state.officeDemo) {
    if (state.officeDemoTimer) clearInterval(state.officeDemoTimer)
    state.officeDemoTimer = setInterval(() => {
      if (!document.body.contains(page) || !state.officeDemo || document.hidden) {
        clearInterval(state.officeDemoTimer)
        state.officeDemoTimer = null
        return
      }
      renderOffice(page, state)
    }, 1200)
  } else if (state.officeDemoTimer) {
    clearInterval(state.officeDemoTimer)
    state.officeDemoTimer = null
  }
  renderOffice(page, state)
}

function getOfficeSourceAgents(state) {
  if (!state.officeStress) return state.agents
  if (!state.officeStressAgents?.length) state.officeStressAgents = createStressAgents(state.agents, state.officeStressSize || 60)
  return state.officeStressAgents
}

function createStressAgents(sourceAgents, count = 60) {
  const seeds = sourceAgents?.length ? sourceAgents : [{
    id: 'main',
    identityName: 'main',
    model: 'demo/model',
    workspace: 'stress-workspace',
  }]
  return Array.from({ length: count }, (_, index) => {
    const seed = seeds[index % seeds.length] || {}
    const baseName = seed.identityName || seed.name || seed.id || 'Agent'
    return {
      ...seed,
      id: `stress-${index + 1}`,
      identityName: `${String(baseName).split(',')[0].trim() || 'Agent'} ${index + 1}`,
      workspace: seed.workspace || `workspace-${(index % 6) + 1}`,
      bindingCount: index % 4,
    }
  })
}

function stressActivityForAgent(agent, state) {
  const index = Number(String(agent.id).match(/\d+$/)?.[0] || 0)
  const phase = Math.floor((Date.now() - (state.officeStressStartedAt || Date.now())) / 3600)
  const states = ['idle', 'walking', 'working', 'thinking', 'tool_call', 'blocked', 'done', 'queued', 'working', 'error']
  const current = states[(index + phase) % states.length] || 'idle'
  return {
    agentId: agent.id,
    state: current,
    taskTitle: current === 'idle' ? '休息区待命' : `压测任务 ${index}`,
    progressText: current === 'error' ? '模拟异常路径' : current === 'blocked' ? '模拟等待输入' : '压测渲染与任务流联动',
    toolName: current === 'tool_call' ? 'stress.tool' : '',
    source: 'stress',
    updatedAt: Date.now(),
  }
}

function toggleOfficeStress(page, state) {
  if (!SHOW_OFFICE_STRESS) return
  state.officeStress = !state.officeStress
  state.officeStressStartedAt = Date.now()
  const size = Number(page.querySelector('#agent-office-stress-size')?.value || state.officeStressSize || 60)
  state.officeStressSize = size
  if (state.officeStress) state.officeStressAgents = createStressAgents(state.agents, size)
  const btn = page.querySelector('#agent-office-stress')
  if (btn) {
    btn.textContent = state.officeStress ? '关闭压测' : '开始压测'
    btn.classList.toggle('btn-primary', state.officeStress)
    btn.classList.toggle('btn-secondary', !state.officeStress)
  }
  if (state.officeStress) {
    if (state.officeStressTimer) clearInterval(state.officeStressTimer)
    state.officeStressTimer = setInterval(() => {
      if (!document.body.contains(page) || !state.officeStress || document.hidden) {
        clearInterval(state.officeStressTimer)
        state.officeStressTimer = null
        return
      }
      renderOffice(page, state)
    }, 1000)
  } else if (state.officeStressTimer) {
    clearInterval(state.officeStressTimer)
    state.officeStressTimer = null
  }
  renderOffice(page, state)
  renderOfficeDiagnostics(page, state)
}

function startActivityStream(page, state) {
  if (state.activityStreamStarted) return
  state.activityStreamStarted = true
  state.activityStreamStatus = 'connecting'
  const controller = new AbortController()
  state.activityStreamController = controller
  const stopObserver = new MutationObserver(() => {
    if (!document.body.contains(page)) {
      controller.abort()
      stopObserver.disconnect()
    }
  })
  stopObserver.observe(document.body, { childList: true, subtree: true })

  api.agentActivityStream?.((event) => {
    if (event?.event !== 'agent_activity.snapshot') return
    state.activityStreamStatus = 'connected'
    state.activities = Array.isArray(event.items) ? event.items : []
    state.activityUpdatedAt = latestActivityTime(state.activities)
    renderOffice(page, state)
    renderActivityRail(page, state)
  }, { signal: controller.signal }).catch(e => {
    if (e?.name !== 'AbortError') {
      state.activityStreamStatus = 'failed'
      renderOfficeSummary(page, state)
      renderOfficeDiagnostics(page, state)
      renderActivityRail(page, state)
      console.warn('[agents] activity stream failed:', e)
    }
  })
}

function latestActivityTime(items) {
  const timestamps = (items || [])
    .map(item => new Date(item.updatedAt || item.createdAt || item.time || 0).getTime())
    .filter(value => Number.isFinite(value) && value > 0)
  return timestamps.length ? Math.max(...timestamps) : Date.now()
}

function formatShortTime(value) {
  if (!value) return '待更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '待更新'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function renderActivityRail(page, state) {
  const el = page.querySelector('#agent-office-activity')
  if (!el) return
  const officeAgents = state.officeAgents || []
  const activities = state.officeDemo
    ? officeAgents.map(agent => ({
        agentId: agent.id,
        state: agent.officeState,
        taskTitle: agent.activity?.taskTitle,
        progressText: agent.activity?.progressText,
      }))
    : state.officeStress
      ? officeAgents.map(agent => ({
          agentId: agent.id,
          state: agent.officeState,
          taskTitle: agent.activity?.taskTitle,
          progressText: agent.activity?.progressText,
          updatedAt: agent.activity?.updatedAt,
        }))
    : (state.activities || [])
  const counts = activities.reduce((acc, item) => {
    const key = normalizeOfficeState(item.state) || 'idle'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const workingCount = ['queued', 'walking', 'working', 'tool_call', 'thinking', 'done'].reduce((sum, key) => sum + (counts[key] || 0), 0)
  const idleCount = state.officeDemo ? (counts.idle || 0) : (counts.idle || Math.max(0, officeAgents.length - activities.length))
  const active = activities
    .map(item => ({ ...item, state: normalizeOfficeState(item.state) || item.state || 'idle' }))
    .filter(item => ['queued', 'walking', 'working', 'tool_call', 'thinking', 'blocked', 'error', 'done'].includes(item.state))
    .slice(0, 7)
  const nameForAgent = (id) => {
    const agent = officeAgents.find(item => item.id === id)
    return agent?.identityName || agent?.name || id
  }
  const renderTime = (value) => {
    if (!value) return '刚刚'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '刚刚'
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  el.innerHTML = `
    <div class="agent-office-activity-head">
      <div>
        <span>${state.officeStress ? '压测概览' : state.officeDemo ? '演示概览' : '实时概览'}</span>
        <strong>${officeAgents.length}</strong>
      </div>
      <small>${state.activityStreamStatus === 'failed' ? 'Stream failed' : state.activityStreamStatus === 'connected' ? 'Live stream' : 'Agents'}</small>
    </div>
    <div class="agent-office-activity-stats">
      <span><strong>${workingCount}</strong> 工作中</span>
      <span><strong>${counts.blocked || 0}</strong> 阻塞</span>
      <span><strong>${counts.error || 0}</strong> 异常</span>
      <span><strong>${idleCount}</strong> 空闲</span>
    </div>
    <div class="agent-office-activity-list">
      ${active.length ? active.map(item => `
        <button class="agent-office-activity-item is-${escHtml(item.state || 'idle')}" data-office-agent="${escHtml(item.agentId)}">
          <span class="agent-office-activity-dot" aria-hidden="true"></span>
          <span class="agent-office-activity-main">
            <strong>${escHtml(nameForAgent(item.agentId))}</strong>
            <small>${escHtml(item.taskTitle || item.progressText || stateLabel(item.state))}</small>
          </span>
          <span class="agent-office-activity-meta">
            <b>${escHtml(stateLabel(item.state))}</b>
            <small>${escHtml(renderTime(item.updatedAt))}</small>
          </span>
        </button>
      `).join('') : '<span class="agent-office-activity-empty">当前没有运行中的任务</span>'}
    </div>
  `
}

/** 为指定 agent 生成绑定渠道的 badge HTML */
function renderBindingBadges(agentId, bindings) {
  const matched = (bindings || []).filter(b => (b.agentId || 'main') === agentId)
  if (!matched.length) {
    return `<span style="color:var(--text-tertiary)">${tr('agents.noBinding', '未绑定')}</span>`
  }
  return matched.map(b => {
    const channel = b.match?.channel || ''
    const label = CHANNEL_LABELS[channel] || channel
    const accountId = b.match?.accountId
    const text = accountId ? `${label} · ${accountId}` : label
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return `<span style="font-size:var(--font-size-xs);color:var(--accent);background:var(--accent-muted);padding:1px 6px;border-radius:10px;white-space:nowrap">${escaped}</span>`
  }).join(' ')
}

/**
 * 渲染 Agent Runtime 徽章。
 *
 * 上游 2026.5.2+ 会在 agents.list 返回 agentRuntime 元数据：
 *   - { id: 'pi' }     → 默认 Pi runtime（最常用，蓝色徽章）
 *   - { id: 'codex' }  → OpenAI Codex CLI runtime（紫色徽章）
 *   - { id: '其他' }   → 显示原始 id（灰色徽章）
 *
 * 老内核不会调用本函数（被 hasFeature('agents.runtime') 门控）。
 */
function _renderRuntimeBadge(runtime) {
  const id = (runtime && typeof runtime === 'object' ? runtime.id : runtime) || 'pi'
  const map = {
    pi: { label: 'Pi', cls: 'badge-info' },
    codex: { label: 'Codex CLI', cls: 'badge-purple' },
  }
  const meta = map[id] || { label: id, cls: 'badge-neutral' }
  return `<span class="badge ${meta.cls}" title="agentRuntime.id = ${id}">${meta.label}</span>`
}

function renderAgents(page, state) {
  const container = page.querySelector('#agents-list')

  // stats bar
  const defaultAgent = state.agents.find(a => a.isDefault || a.id === 'main')
  const totalBindings = (state.bindings || []).length
  const statsBar = page.querySelector('#agents-stats-bar')
  if (statsBar) {
    statsBar.innerHTML = `
      <div class="agents-stat">
        <span class="agents-stat__num">${state.agents.length}</span>
        <span class="agents-stat__label">${tr('agents.totalAgents', '个 Agent')}</span>
      </div>
      <div class="agents-stat">
        <span class="agents-stat__num">${defaultAgent ? (defaultAgent.identityEmoji || '🤖') : '—'}</span>
        <span class="agents-stat__label">${defaultAgent ? (defaultAgent.identityName || defaultAgent.id) : tr('common.none', '无')}</span>
      </div>
      <div class="agents-stat">
        <span class="agents-stat__num">${totalBindings}</span>
        <span class="agents-stat__label">${tr('agents.bindings', '渠道绑定')}</span>
      </div>
    `
  }

  // filter by search
  const search = state.search || ''
  let filtered = state.agents
  if (search) {
    filtered = state.agents.filter(a => {
      const name = (a.identityName || '').toLowerCase()
      const model = typeof a.model === 'object' ? (a.model?.primary || '') : (a.model || '')
      const ws = (a.workspace || '').toLowerCase()
      const text = `${a.id} ${name} ${model} ${ws}`.toLowerCase()
      return text.includes(search)
    })
  }

  if (!filtered.length) {
    container.innerHTML = search
      ? `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">${tr('agents.noMatch', '没有匹配的 Agent')}</div></div>`
      : `
      <div class="empty-state">
        <div class="empty-icon">🤖</div>
        <div class="empty-title">${tr('agents.noAgents', '暂无 Agent')}</div>
        <div class="empty-desc">${tr('common.emptyGetStartedHint', '先新增一个开始使用')}</div>
        <div class="empty-cta"><button class="btn btn-primary" data-empty-cta="add-agent">${tr('agents.addAgent', '新增 Agent')}</button></div>
      </div>
    `
    container.querySelector('[data-empty-cta="add-agent"]')?.addEventListener('click', () => {
      page.querySelector('#btn-add-agent')?.click()
    })
    return
  }

  container.innerHTML = filtered.map(a => {
    const isDefault = a.isDefault || a.id === 'main'
    const name = a.identityName ? a.identityName.split(',')[0].trim() : ''
    const emoji = a.identityEmoji || '🤖'
    const modelStr = typeof a.model === 'object' ? (a.model?.primary || a.model?.id || '') : (a.model || '')
    const bindingCount = (state.bindings || []).filter(b => (b.agentId || 'main') === a.id).length

    return `
      <div class="agent-card${isDefault ? ' agent-card--default' : ''}" data-id="${a.id}">
        <div class="agent-card-header">
          <div class="agent-card-title">
            <span class="agent-av">${emoji}</span>
            <div class="agent-name-block">
              <span class="agent-display-name">${name || a.id}</span>
              <span class="agent-id-sub">${a.id}${isDefault ? ` · ${tr('agents.default', '默认')}` : ''}</span>
            </div>
          </div>
          <div class="agent-card-actions">
            <button class="btn btn-sm btn-primary" data-action="detail" data-id="${a.id}">${tr('agents.detail', '详情')}</button>
            <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${a.id}">${tr('agents.edit', '编辑')}</button>
            <button class="btn btn-sm btn-secondary" data-action="backup" data-id="${a.id}">${tr('agents.backup', '备份')}</button>
            ${!isDefault ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}">${tr('agents.delete', '删除')}</button>` : ''}
          </div>
        </div>
        <div class="agent-card-body">
          <div class="agent-meta-grid">
            ${modelStr ? `<div class="agent-meta-item"><span class="agent-meta-label">${tr('agents.labelModel', '模型')}</span><span class="agent-meta-value" title="${modelStr}">${modelStr}</span></div>` : ''}
            ${a.workspace ? `<div class="agent-meta-item"><span class="agent-meta-label">${tr('agents.labelWorkspace', '工作区')}</span><span class="agent-meta-value" title="${a.workspace}">${a.workspace}</span></div>` : ''}
            <div class="agent-meta-item"><span class="agent-meta-label">${tr('agents.bindings', '渠道')}</span><span class="agent-meta-value">${bindingCount > 0 ? renderBindingBadges(a.id, state.bindings) : `<span style="color:var(--text-tertiary)">${tr('agents.noBinding', '未绑定')}</span>`}</span></div>
            ${hasFeature('agents.runtime') ? `<div class="agent-meta-item"><span class="agent-meta-label">${tr('agents.labelRuntime', '运行时')}</span><span class="agent-meta-value">${_renderRuntimeBadge(a.agentRuntime)}</span></div>` : ''}
          </div>
        </div>
        <div class="agent-card-click-hint">${tr('agents.clickToDetail', '点击查看详情 ->')}</div>
      </div>
    `
  }).join('')
}

function attachAgentEvents(page, state) {
  const container = page.querySelector('#agents-list')
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (btn) {
      const action = btn.dataset.action
      const id = btn.dataset.id
      if (action === 'detail') location.hash = `#/agent-detail?id=${encodeURIComponent(id)}`
      else if (action === 'edit') showEditAgentDialog(page, state, id)
      else if (action === 'delete') await deleteAgent(page, state, id)
      else if (action === 'backup') await backupAgent(id)
      return
    }
    // 点击卡片空白区域 → 进入详情页
    const card = e.target.closest('.agent-card')
    if (card) {
      const id = card.dataset.id
      if (id) location.hash = `#/agent-detail?id=${encodeURIComponent(id)}`
    }
  })
}

async function showAddAgentDialog(page, state) {
  // 获取模型列表
  let models = []
  try {
    const config = await api.readOpenclawConfig()
    const providers = config?.models?.providers || {}
    for (const [pk, pv] of Object.entries(providers)) {
      for (const m of (pv.models || [])) {
        const id = typeof m === 'string' ? m : m.id
        if (id) models.push({ value: `${pk}/${id}`, label: `${pk}/${id}` })
      }
    }
  } catch { models = [{ value: 'newapi/claude-opus-4-6', label: 'newapi/claude-opus-4-6' }] }

  if (!models.length) {
    toast(t('agents.addModelsFirst'), 'warning')
    return
  }

  setTimeout(() => attachTermTooltips(document.body), 0)
  showModal({
    title: t('agents.addTitle'),
    fields: [
      { name: 'id', label: t('agents.agentId'), value: '', placeholder: t('agents.agentIdPlaceholder') },
      { name: 'name', label: t('agents.agentName'), value: '', placeholder: t('agents.agentNamePlaceholder') },
      { name: 'emoji', label: t('agents.agentEmoji'), value: '', placeholder: t('agents.agentEmojiPlaceholder') },
      { name: 'model', label: t('agents.agentModel'), type: 'select', value: models[0]?.value || '', options: models },
      { name: 'workspace', label: t('agents.agentWorkspace') + termHelpHtml('workspace'), value: '', placeholder: t('agents.agentWorkspacePlaceholder') },
    ],
    onConfirm: async (result) => {
      const id = (result.id || '').trim()
      if (!id) { toast(t('agents.idRequired'), 'warning'); return }
      if (!/^[a-z0-9_-]+$/.test(id)) { toast(t('agents.idInvalid'), 'warning'); return }

      const name = (result.name || '').trim()
      const emoji = (result.emoji || '').trim()
      const model = result.model || models[0]?.value || ''
      const workspace = (result.workspace || '').trim()

      try {
        await api.addAgent(id, model, workspace || null)
        // 身份信息更新（非关键，失败不阻塞）
        if (name || emoji) {
          try {
            await api.updateAgentIdentity(id, name || null, emoji || null)
          } catch (identityErr) {
            console.warn('[Agent] 身份信息更新失败（Agent 已创建）:', identityErr)
            toast(t('agents.createdNameFailed'), 'warning')
          }
        }
        toast(t('agents.created'), 'success')

        // 强制清除缓存并重新加载
        invalidate('list_agents')
        await loadAgents(page, state)
      } catch (e) {
        toast(humanizeError(e, t('agents.createFailed')), 'error')
      }
    }
  })
}

async function showEditAgentDialog(page, state, id) {
  const agent = state.agents.find(a => a.id === id)
  if (!agent) return

  const name = agent.identityName ? agent.identityName.split(',')[0].trim() : ''

  // 获取模型列表
  let models = []
  try {
    const config = await api.readOpenclawConfig()
    const providers = config?.models?.providers || {}
    for (const [pk, pv] of Object.entries(providers)) {
      for (const m of (pv.models || [])) {
        const mid = typeof m === 'string' ? m : m.id
        if (mid) models.push({ value: `${pk}/${mid}`, label: `${pk}/${mid}` })
      }
    }
    console.log('[Agent编辑] 获取到模型列表:', models.length, '个')
  } catch (e) {
    console.error('[Agent编辑] 获取模型列表失败:', e)
  }

  const fields = [
    { name: 'name', label: t('agents.agentName'), value: name, placeholder: t('agents.agentNamePlaceholder') },
    { name: 'emoji', label: t('agents.agentEmoji'), value: agent.identityEmoji || '', placeholder: t('agents.agentEmojiPlaceholder') },
  ]

  if (models.length) {
    const modelField = {
      name: 'model', label: t('agents.agentModel'), type: 'select',
      value: agent.model || models[0]?.value || '',
      options: models,
    }
    fields.push(modelField)
    console.log('[Agent编辑] 当前模型:', agent.model)
    console.log('[Agent编辑] 模型选项:', models)
  } else {
    console.warn('[Agent编辑] 模型列表为空，不显示模型选择器')
  }

  fields.push({
    name: 'workspace', label: t('agents.labelWorkspace').replace(':', ''),
    value: agent.workspace || t('agents.notSet'),
    placeholder: t('agents.workspaceReadonly'),
    readonly: true,
  })

  showModal({
    title: t('agents.editTitle', { id }),
    fields,
    onConfirm: async (result) => {
      console.log('[Agent编辑] 保存数据:', result)
      const newName = (result.name || '').trim()
      const emoji = (result.emoji || '').trim()
      const model = (result.model || '').trim()

      try {
        if (newName || emoji) {
          console.log('[Agent编辑] 更新身份信息...')
          await api.updateAgentIdentity(id, newName || null, emoji || null)
        }
        if (model && model !== agent.model) {
          console.log('[Agent编辑] 更新模型:', agent.model, '->', model)
          await api.updateAgentModel(id, model)
        }

        // 手动更新 state 并重新渲染，确保立即生效
        if (newName) agent.identityName = newName
        if (emoji) agent.identityEmoji = emoji
        if (model) agent.model = model
        renderAgents(page, state)
        renderOffice(page, state)

        toast(t('agents.updated'), 'success')
      } catch (e) {
        console.error('[Agent编辑] 保存失败:', e)
        toast(humanizeError(e, t('agents.updateFailed')), 'error')
      }
    }
  })
}

async function deleteAgent(page, state, id) {
  // 计算关联渠道绑定数（小白看清楚删了会丢什么）
  const linkedBindings = (state.bindings || []).filter(b => (b.agentId || 'main') === id).length
  const impact = [t('agents.deleteImpactConfig')]
  if (linkedBindings > 0) {
    impact.unshift(t('agents.deleteImpactBindings', { n: linkedBindings }))
  }
  const yes = await showConfirm({
    title: t('agents.deleteConfirmTitle'),
    message: t('agents.confirmDelete', { id }),
    impact,
    confirmText: t('agents.deleteConfirmBtn'),
    cancelText: t('agents.deleteCancelBtn'),
  })
  if (!yes) return

  try {
    await api.deleteAgent(id)
    toast(t('agents.deleted'), 'success')
    await loadAgents(page, state)
  } catch (e) {
    toast(humanizeError(e, t('agents.deleteFailed')), 'error')
  }
}

async function backupAgent(id) {
  toast(t('agents.backingUp', { id }), 'info')
  try {
    const zipPath = await api.backupAgent(id)
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      const dir = zipPath.substring(0, zipPath.lastIndexOf('/')) || zipPath
      await open(dir)
    } catch { /* fallback */ }
    toast(t('agents.backupDone', { file: zipPath.split('/').pop() }), 'success')
  } catch (e) {
    toast(humanizeError(e, t('agents.backupFailed')), 'error')
  }
}
