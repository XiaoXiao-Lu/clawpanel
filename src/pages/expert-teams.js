/**
 * Expert Teams configuration page.
 *
 * Covers custom expert profiles, reusable expert teams, member selection,
 * and moderator/workflow settings. Expert teams are executed from Assistant.
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'
import { humanizeError } from '../lib/humanize-error.js'
import { t } from '../lib/i18n.js'
import { icon } from '../lib/icons.js'
import { escapeHtml, escapeAttr } from '../lib/utils.js'

// ── 可用工具分类 ──
const TOOL_CATEGORIES = [
  { id: 'system', name: '系统工具', desc: 'shell_exec, python, get_system_info 等' },
  { id: 'process', name: '流程控制', desc: 'goal, run_script, check_port 等' },
  { id: 'interaction', name: '交互工具', desc: 'ask_user_question 等' },
  { id: 'browser', name: '浏览器', desc: 'browser_navigate, browser_click 等' },
  { id: 'terminal', name: '终端', desc: 'shell_exec（含 MCP 终端）' },
  { id: 'webSearch', name: '联网搜索', desc: 'web_search, web_fetch 等' },
  { id: 'fileOps', name: '文件操作', desc: 'list_directory, read_file, write_file 等' },
  { id: 'skills', name: '技能管理', desc: 'skills_install_dep, skillhub_install 等' },
  { id: 'openclaw', name: 'OpenClaw 专用', desc: 'get_openclaw_context, diagnose_openclaw 等' },
]

const TABS = {
  experts: 'experts',
  groups: 'groups',
}

const GROUP_MODES = [
  ['panel', 'expertTeams.modePanel'],
  ['creation', 'expertTeams.modeCreation'],
  ['debate', 'expertTeams.modeDebate'],
  ['review', 'expertTeams.modeReview'],
  ['research', 'expertTeams.modeResearch'],
  ['sequential', 'expertTeams.modeSequential'],
]

const APPROVAL_POLICIES = [
  ['none', 'expertTeams.approvalNone'],
  ['before_final', 'expertTeams.approvalBeforeFinal'],
  ['before_tools', 'expertTeams.approvalBeforeTools'],
]

const ID_RE = /^[A-Za-z0-9_.-]+$/

export async function render() {
  const page = document.createElement('div')
  page.className = 'page expert-teams-page'

  page.innerHTML = `
    <div class="page-header expert-teams-header">
      <div>
        <h1 class="page-title">${t('expertTeams.title')}</h1>
        <p class="page-desc">${t('expertTeams.desc')}</p>
      </div>
      <div class="page-actions expert-teams-actions">
        <button class="btn btn-sm btn-secondary" data-action="refresh">${icon('refresh-cw', 14)} ${t('expertTeams.refresh')}</button>
        <button class="btn btn-sm btn-primary" data-action="add">${icon('plus-circle', 14)} <span id="expert-teams-add-label">${t('expertTeams.addExpert')}</span></button>
      </div>
    </div>

    <div class="expert-teams-topline">
      <div class="tab-bar expert-teams-tabs" id="expert-teams-tabs">
        <button class="tab active" type="button" data-expert-tab="experts">${t('expertTeams.libraryTab')} <span id="expert-count">0</span></button>
        <button class="tab" type="button" data-expert-tab="groups">${t('expertTeams.groupsTab')} <span id="group-count">0</span></button>
      </div>
      <div class="expert-teams-summary" id="expert-teams-summary"></div>
    </div>

    <div class="expert-teams-shell">
      <aside class="expert-teams-list" aria-label="${escapeAttr(t('expertTeams.title'))}">
        <div class="expert-teams-search">
          ${icon('search', 15)}
          <input class="form-input" id="expert-teams-search" placeholder="${escapeAttr(t('expertTeams.searchExperts'))}">
        </div>
        <div class="expert-teams-list-body" id="expert-teams-list-body">
          <div class="loading-placeholder" style="height:96px"></div>
        </div>
      </aside>
      <section class="expert-teams-editor" id="expert-teams-editor">
        <div class="expert-teams-empty">${t('common.loading')}</div>
      </section>
    </div>
  `

  const state = {
    activeTab: TABS.experts,
    experts: [],
    groups: [],
    availableSkills: [],
    skillsLoadFailed: false,
    search: '',
    selectedExpertId: null,
    selectedGroupId: null,
    draftExpert: null,
    draftGroup: null,
    loading: true,
  }

  bindEvents(page, state)
  loadData(page, state)

  return page
}

function bindEvents(page, state) {
  page.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-expert-tab]')
    if (tab) {
      state.activeTab = tab.dataset.expertTab === TABS.groups ? TABS.groups : TABS.experts
      state.search = ''
      state.draftExpert = null
      state.draftGroup = null
      renderAll(page, state)
      return
    }

    const item = e.target.closest('[data-select-id]')
    if (item) {
      if (state.activeTab === TABS.experts) {
        state.selectedExpertId = item.dataset.selectId
        state.draftExpert = null
      } else {
        state.selectedGroupId = item.dataset.selectId
        state.draftGroup = null
      }
      renderList(page, state)
      renderEditor(page, state)
      return
    }

    const action = e.target.closest('[data-action]')?.dataset.action
    if (!action) return
    if (action === 'refresh') await loadData(page, state, { clearDrafts: true })
    else if (action === 'add') addCurrent(page, state)
    else if (action === 'duplicate') duplicateCurrent(page, state)
    else if (action === 'save') await saveCurrent(page, state)
    else if (action === 'delete') await deleteCurrent(page, state)
  })

  page.addEventListener('input', (e) => {
    if (e.target.id !== 'expert-teams-search') return
    state.search = e.target.value.trim().toLowerCase()
    renderList(page, state)
  })

  page.addEventListener('change', (e) => {
    if (e.target.matches('[data-member-toggle], [data-member-order]')) {
      updateGroupMemberControls(page, state)
      return
    }
    if (e.target.id === 'group-mode' || e.target.id === 'group-max-rounds' || e.target.id === 'group-max-parallel') {
      updateGroupWorkflowGuide(page)
    }
  })

  page.addEventListener('input', (e) => {
    if (!['group-max-rounds', 'group-max-parallel'].includes(e.target.id)) return
    updateGroupWorkflowGuide(page)
  })

  page.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-member-row].is-selected')
    if (!row || !e.target.closest('[data-member-drag]')) return
    row.classList.add('is-dragging')
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', row.dataset.memberRow || '')
  })

  page.addEventListener('dragover', (e) => {
    const picker = e.target.closest('#expert-member-picker')
    if (!picker) return
    const dragging = picker.querySelector('.expert-member-row.is-dragging')
    const target = e.target.closest('[data-member-row].is-selected')
    if (!dragging || !target || target === dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = target.getBoundingClientRect()
    const afterTarget = e.clientY > rect.top + rect.height / 2
    picker.insertBefore(dragging, afterTarget ? target.nextSibling : target)
    renumberSelectedMembers(picker)
  })

  page.addEventListener('drop', (e) => {
    const picker = e.target.closest('#expert-member-picker')
    if (!picker) return
    e.preventDefault()
    renumberSelectedMembers(picker)
  })

  page.addEventListener('dragend', (e) => {
    const row = e.target.closest('[data-member-row]')
    row?.classList.remove('is-dragging')
    const picker = page.querySelector('#expert-member-picker')
    if (picker) renumberSelectedMembers(picker)
  })
}

async function loadData(page, state, opts = {}) {
  state.loading = true
  renderAll(page, state)
  try {
    const [experts, groups, skillsResult] = await Promise.all([
      api.listExperts(),
      api.listExpertGroups(),
      api.skillsList().catch(error => ({ error })),
    ])
    state.experts = Array.isArray(experts) ? experts : []
    state.groups = Array.isArray(groups) ? groups : []
    state.availableSkills = normalizeSkillOptions(skillsResult?.skills || [])
    state.skillsLoadFailed = !!skillsResult?.error
    state.loading = false
    if (opts.clearDrafts) {
      state.draftExpert = null
      state.draftGroup = null
    }
    if (state.selectedExpertId && !state.experts.some(item => item.id === state.selectedExpertId)) state.selectedExpertId = null
    if (state.selectedGroupId && !state.groups.some(item => item.id === state.selectedGroupId)) state.selectedGroupId = null
    if (!state.selectedExpertId && state.experts[0]) state.selectedExpertId = state.experts[0].id
    if (!state.selectedGroupId && state.groups[0]) state.selectedGroupId = state.groups[0].id
    renderAll(page, state)
  } catch (e) {
    state.loading = false
    renderAll(page, state)
    toast(humanizeError(e, t('expertTeams.loadFailed')), 'error')
  }
}

function renderAll(page, state) {
  renderTabs(page, state)
  renderList(page, state)
  renderEditor(page, state)
}

function renderTabs(page, state) {
  page.querySelectorAll('[data-expert-tab]').forEach(tab => {
    const active = tab.dataset.expertTab === state.activeTab
    tab.classList.toggle('active', active)
  })
  const search = page.querySelector('#expert-teams-search')
  if (search) {
    search.placeholder = state.activeTab === TABS.experts ? t('expertTeams.searchExperts') : t('expertTeams.searchGroups')
    if (search.value !== state.search) search.value = state.search
  }
  const addLabel = page.querySelector('#expert-teams-add-label')
  if (addLabel) addLabel.textContent = state.activeTab === TABS.experts ? t('expertTeams.addExpert') : t('expertTeams.addGroup')
  page.querySelector('#expert-count').textContent = String(state.experts.length)
  page.querySelector('#group-count').textContent = String(state.groups.length)
  page.querySelector('#expert-teams-summary').innerHTML = `
    ${renderTopSummary(state)}
  `
}

function renderTopSummary(state) {
  const group = state.groups.find(item => item.id === state.selectedGroupId)
  const totalSlots = totalSelectedMembers(state.groups)
  const parts = state.activeTab === TABS.groups
    ? [
        t('expertTeams.groupCountSummary', { count: state.groups.length }),
        group ? t('expertTeams.currentGroupMembersSummary', { count: Array.isArray(group.members) ? group.members.length : 0 }) : null,
        t('expertTeams.memberSlotSummary', { count: totalSlots }),
      ]
    : [
        t('expertTeams.expertCountSummary', { count: state.experts.length }),
        t('expertTeams.memberSlotSummary', { count: totalSlots }),
      ]

  return parts
    .filter(Boolean)
    .map(text => `<span>${icon('users', 14)} ${escapeHtml(text)}</span>`)
    .join('')
}

function renderList(page, state) {
  const body = page.querySelector('#expert-teams-list-body')
  if (!body) return
  if (state.loading) {
    body.innerHTML = `
      <div class="expert-list-skeleton"></div>
      <div class="expert-list-skeleton"></div>
      <div class="expert-list-skeleton"></div>
    `
    return
  }

  const items = state.activeTab === TABS.experts ? state.experts : state.groups
  const filtered = filterItems(items, state.search)
  if (!filtered.length) {
    body.innerHTML = `
      <div class="expert-teams-empty">
        <strong>${state.activeTab === TABS.experts ? t('expertTeams.noExperts') : t('expertTeams.noGroups')}</strong>
        <span>${state.activeTab === TABS.experts ? t('expertTeams.emptyExpertsHint') : t('expertTeams.emptyGroupsHint')}</span>
      </div>
    `
    return
  }

  body.innerHTML = filtered.map(item => {
    const active = state.activeTab === TABS.experts
      ? item.id === state.selectedExpertId && !state.draftExpert
      : item.id === state.selectedGroupId && !state.draftGroup
    return state.activeTab === TABS.experts
      ? renderExpertListItem(item, active)
      : renderGroupListItem(item, active, state.experts)
  }).join('')
}

function renderExpertListItem(expert, active) {
  return `
    <button class="expert-list-item ${active ? 'is-active' : ''}" type="button" data-select-id="${escapeAttr(expert.id)}">
      <span class="expert-avatar" style="--expert-color:${escapeAttr(expert.color || '#4f46e5')}"></span>
      <span class="expert-list-main">
        <strong>${escapeHtml(expert.name || expert.id)}</strong>
        <small>${escapeHtml(expert.title || expert.description || expert.id)}</small>
      </span>
      <span class="expert-status ${expert.enabled === false ? 'is-disabled' : 'is-enabled'}">${expert.enabled === false ? t('common.disabled') : t('common.enabled')}</span>
    </button>
  `
}

function renderGroupListItem(group, active, experts) {
  const members = Array.isArray(group.members) ? group.members : []
  const mode = group.mode || 'panel'
  const modeLabel = t(GROUP_MODES.find(([value]) => value === mode)?.[1] || 'expertTeams.modePanel')
  const names = members
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map(member => findExpert(experts, member.expertId)?.name || member.expertId)
    .filter(Boolean)
    .slice(0, 3)
    .join(' / ')
  return `
    <button class="expert-list-item ${active ? 'is-active' : ''}" type="button" data-select-id="${escapeAttr(group.id)}">
      <span class="expert-avatar expert-avatar--team"></span>
      <span class="expert-list-main">
        <strong>${escapeHtml(group.name || group.id)}</strong>
        <small>${escapeHtml(`${modeLabel} · ${names || group.description || group.id}`)}</small>
      </span>
      <span class="expert-status">${members.length}</span>
    </button>
  `
}

function renderEditor(page, state) {
  const editor = page.querySelector('#expert-teams-editor')
  if (!editor) return
  if (state.loading) {
    editor.innerHTML = `<div class="expert-teams-empty">${t('common.loading')}</div>`
    return
  }
  if (state.activeTab === TABS.experts) {
    const expert = state.draftExpert || state.experts.find(item => item.id === state.selectedExpertId) || null
    editor.innerHTML = renderExpertEditor(expert, state)
    // 绑定工具和技能选择器
    bindTagPickerEvents(editor, 'expert-tools', TOOL_CATEGORIES)
    bindTagPickerEvents(editor, 'expert-skills', skillOptionsForExpert(expert, state))
  } else {
    const group = state.draftGroup || state.groups.find(item => item.id === state.selectedGroupId) || null
    editor.innerHTML = renderGroupEditor(group, state)
    updateGroupMemberControls(page, state)
  }
}

function renderExpertEditor(expert, state) {
  if (!expert) {
    return `
      <div class="expert-teams-empty">
        <strong>${t('expertTeams.noExperts')}</strong>
        <span>${t('expertTeams.emptyExpertsHint')}</span>
      </div>
    `
  }
  const model = expert.model && typeof expert.model === 'object' ? expert.model : {}
  const inheritDefault = model.inheritDefault !== false
  return `
    <div class="expert-editor-head">
      <div>
        <div class="expert-editor-kicker">${t('expertTeams.formIdentity')}</div>
        <h2>${escapeHtml(expert.name || t('expertTeams.addExpert'))}</h2>
      </div>
      <div class="expert-editor-actions">
        <button class="btn btn-sm btn-secondary" data-action="duplicate">${icon('copy', 14)} ${t('expertTeams.duplicate')}</button>
        <button class="btn btn-sm btn-danger" data-action="delete">${icon('trash', 14)} ${t('expertTeams.delete')}</button>
        <button class="btn btn-sm btn-primary" data-action="save">${icon('check', 14)} ${t('expertTeams.save')}</button>
      </div>
    </div>

    <form class="expert-editor-form" id="expert-editor-form">
      <section class="expert-form-section">
        <h3>${t('expertTeams.formIdentity')}</h3>
        <div class="expert-form-grid">
          ${field('expert-id', t('expertTeams.id'), expert.id || '', { placeholder: 'research.strategy' })}
          ${field('expert-name', t('expertTeams.name'), expert.name || '', { placeholder: 'Strategy Reviewer' })}
          ${field('expert-title', t('expertTeams.titleField'), expert.title || '', { placeholder: 'Market / Product / Code Review' })}
          <label class="form-group expert-color-field">
            <span class="form-label">${t('expertTeams.color')}</span>
            <input class="form-input" id="expert-color" type="color" value="${escapeAttr(expert.color || '#4f46e5')}">
          </label>
        </div>
        ${textarea('expert-description', t('expertTeams.description'), expert.description || '', { rows: 3 })}
        <label class="expert-check-row">
          <input id="expert-enabled" type="checkbox" ${expert.enabled === false ? '' : 'checked'}>
          <span>${t('expertTeams.enabled')}</span>
        </label>
      </section>

      <section class="expert-form-section">
        <h3>${t('expertTeams.formCapability')}</h3>
        ${textarea('expert-system-prompt', t('expertTeams.systemPrompt'), expert.systemPrompt || '', { rows: 7, hint: t('expertTeams.systemPromptHint') })}
        <div class="expert-form-grid">
          <label class="form-group">
            <span class="form-label">${t('expertTeams.modelMode')}</span>
            <select class="form-input" id="expert-model-inherit">
              ${option('inherit', t('expertTeams.inheritModel'), inheritDefault ? 'inherit' : 'fixed')}
              ${option('fixed', t('expertTeams.fixedModel'), inheritDefault ? 'inherit' : 'fixed')}
            </select>
          </label>
          ${field('expert-model-id', t('expertTeams.modelId'), model.modelId || '', { placeholder: 'provider/model' })}
        </div>
        <div class="expert-form-grid expert-form-grid--three">
          ${renderTagPicker('expert-tools', t('expertTeams.tools'), TOOL_CATEGORIES, expert.tools || [])}
          ${renderTagPicker('expert-skills', t('expertTeams.skills'), skillOptionsForExpert(expert, state), expert.skills || [])}
          ${textarea('expert-knowledge', t('expertTeams.knowledgeRefs'), joinLines(expert.knowledgeRefs), { rows: 5 })}
        </div>
        ${textarea('expert-output-schema', t('expertTeams.outputSchema'), expert.outputSchema || '', { rows: 5 })}
      </section>
    </form>
  `
}

function renderGroupEditor(group, state) {
  if (!group) {
    return `
      <div class="expert-teams-empty">
        <strong>${t('expertTeams.noGroups')}</strong>
        <span>${t('expertTeams.emptyGroupsHint')}</span>
      </div>
    `
  }
  return `
    <div class="expert-editor-head">
      <div>
        <div class="expert-editor-kicker">${t('expertTeams.formWorkflow')}</div>
        <h2>${escapeHtml(group.name || t('expertTeams.addGroup'))}</h2>
      </div>
      <div class="expert-editor-actions">
        <button class="btn btn-sm btn-secondary" data-action="duplicate">${icon('copy', 14)} ${t('expertTeams.duplicate')}</button>
        <button class="btn btn-sm btn-danger" data-action="delete">${icon('trash', 14)} ${t('expertTeams.delete')}</button>
        <button class="btn btn-sm btn-primary" data-action="save">${icon('check', 14)} ${t('expertTeams.save')}</button>
      </div>
    </div>

    <div class="expert-communication-note">
      ${icon('message-square', 18)}
      <div>
        <strong>${t('expertTeams.communicationTitle')}</strong>
        <span>${t('expertTeams.communicationDesc')}</span>
      </div>
    </div>

    <form class="expert-editor-form" id="expert-group-form">
      <section class="expert-form-section">
        <h3>${t('expertTeams.formIdentity')}</h3>
        <div class="expert-form-grid">
          ${field('group-id', t('expertTeams.id'), group.id || '', { placeholder: 'product-review' })}
          ${field('group-name', t('expertTeams.name'), group.name || '', { placeholder: 'Product Review Panel' })}
        </div>
        ${textarea('group-description', t('expertTeams.description'), group.description || '', { rows: 3 })}
      </section>

      <section class="expert-form-section">
        <h3>${t('expertTeams.formMembers')}</h3>
        <div class="expert-member-toolbar">
          <span id="expert-members-count">${memberCountText(group)}</span>
          <label class="form-group expert-moderator-field">
            <span class="form-label">${t('expertTeams.moderator')}</span>
            <select class="form-input" id="group-moderator">
              ${moderatorOptions(group, state.experts)}
            </select>
          </label>
        </div>
        <p class="expert-member-help">${t('expertTeams.memberOrderHint')}</p>
        <div class="expert-member-picker" id="expert-member-picker">
          ${renderMemberPicker(group, state.experts)}
        </div>
      </section>

      <section class="expert-form-section">
        <h3>${t('expertTeams.formWorkflow')}</h3>
        <div class="expert-form-grid">
          <label class="form-group">
            <span class="form-label">${t('expertTeams.mode')}</span>
            <select class="form-input" id="group-mode">
              ${GROUP_MODES.map(([value, key]) => option(value, t(key), group.mode || 'panel')).join('')}
            </select>
          </label>
          ${field('group-max-rounds', t('expertTeams.maxRounds'), group.maxRounds ?? 3, { type: 'number', min: 1, max: 10 })}
          ${field('group-max-parallel', t('expertTeams.maxParallel'), group.maxParallel ?? 3, { type: 'number', min: 1, max: 8 })}
          <label class="form-group">
            <span class="form-label">${t('expertTeams.approvalPolicy')}</span>
            <select class="form-input" id="group-approval-policy">
              ${APPROVAL_POLICIES.map(([value, key]) => option(value, t(key), group.approvalPolicy || 'none')).join('')}
            </select>
          </label>
        </div>
        <div id="expert-workflow-guide">
          ${renderWorkflowGuide(group)}
        </div>
      </section>
    </form>
  `
}

function updateGroupWorkflowGuide(page) {
  const guide = page.querySelector('#expert-workflow-guide')
  if (!guide) return
  const current = currentGroupFromForm(page)
  guide.innerHTML = renderWorkflowGuide(current)
  page.querySelector('#group-max-rounds')?.closest('.form-group')?.classList.toggle('is-muted', current.mode !== 'sequential')
  page.querySelector('#group-max-parallel')?.closest('.form-group')?.classList.toggle('is-muted', current.mode === 'sequential')
}

function renderWorkflowGuide(group = {}) {
  const mode = group.mode || 'panel'
  const guide = workflowGuide(mode)
  const maxRounds = clampInt(group.maxRounds, 3, 1, 10)
  const maxParallel = clampInt(group.maxParallel, 3, 1, 8)
  const execution = mode === 'sequential'
    ? `每位专家会按顺序执行，最多 ${maxRounds} 轮；后一位能看到前面专家输出，下一轮能看到上一轮结果。`
    : `每位专家通常执行 1 次；按最多 ${maxParallel} 位并行分批收集意见，最后由主持专家综合。`
  const roundMeaning = mode === 'sequential'
    ? `当前会产生最多 ${maxRounds * Math.max(1, Array.isArray(group.members) ? group.members.length : 1)} 次专家发言；第二轮会基于第一轮黑板继续深化，不会从空白重写。`
    : '当前模式不使用多轮接力；最大轮次只在“串联接力”中生效。'
  return `
    <div class="expert-workflow-guide">
      <div class="expert-workflow-guide-head">
        ${icon(guide.icon, 16)}
        <div>
          <strong>${escapeHtml(guide.title)}</strong>
          <span>${escapeHtml(guide.summary)}</span>
        </div>
      </div>
      <div class="expert-workflow-grid">
        <span>
          <small>执行次数</small>
          <strong>${escapeHtml(execution)}</strong>
        </span>
        <span>
          <small>沟通方式</small>
          <strong>${escapeHtml(guide.communication)}</strong>
        </span>
        <span>
          <small>适合任务</small>
          <strong>${escapeHtml(guide.bestFor)}</strong>
        </span>
        <span>
          <small>参数建议</small>
          <strong>${escapeHtml(guide.tuning)}</strong>
        </span>
        <span class="expert-workflow-grid-wide">
          <small>轮次说明</small>
          <strong>${escapeHtml(roundMeaning)}</strong>
        </span>
      </div>
    </div>
  `
}

function workflowGuide(mode) {
  return {
    panel: {
      icon: 'users',
      title: '专家会诊',
      summary: '多位专家独立看同一个问题，主持人归纳共识和分歧。',
      communication: '专家之间不自由聊天，通过共享黑板和主持综合间接沟通。',
      bestFor: '方案判断、疑难问题、需要多视角诊断。',
      tuning: 'maxParallel 控制同时跑几位专家；一般 2-4 比较稳。',
    },
    creation: {
      icon: 'edit',
      title: '团队创作',
      summary: '不同角色分别产出素材、结构、实现建议，再合成可交付结果。',
      communication: '先分工创作，再由主持人整合成统一版本。',
      bestFor: '文案、产品方案、功能设计、代码方案草稿。',
      tuning: '选择互补角色；maxParallel 可稍高以加快产出。',
    },
    debate: {
      icon: 'message-square',
      title: '辩论评审',
      summary: '让角色从不同立场挑战方案，暴露反例、风险和权衡。',
      communication: '专家基于任务和黑板提出观点，主持人保留强分歧。',
      bestFor: '重大决策、架构选型、商业策略、争议方案。',
      tuning: '成员最好包含支持方、反对方、风险/成本视角。',
    },
    review: {
      icon: 'shield',
      title: '交叉审稿',
      summary: '各专家从质量、风险、测试、体验等角度找问题。',
      communication: '独立审查为主，主持人按严重度合并问题。',
      bestFor: '代码评审、PRD 评审、上线前检查、UI 体验检查。',
      tuning: 'maxParallel 2-3；保留测试/安全/体验等角色。',
    },
    research: {
      icon: 'search',
      title: '并行调研',
      summary: '多名专家并行收集线索或分析方向，主持人汇总证据。',
      communication: '共享黑板记录发现；主持人区分事实、推断和缺口。',
      bestFor: '资料调研、竞品分析、技术选型前调查。',
      tuning: '如启用联网工具，建议开启工具前确认或保留只读工具。',
    },
    sequential: {
      icon: 'refresh-cw',
      title: '串联接力',
      summary: '专家按顺序接力，后一位必须基于前一位输出推进。',
      communication: '这是最像“对话接力”的模式；多轮时会反复深化。',
      bestFor: '复杂创作、架构推演、逐步完善方案、WorkBuddy 式接力流程。',
      tuning: 'maxRounds 决定每位专家最多执行几轮；轮数越高越慢、成本越高。',
    },
  }[mode || 'panel'] || workflowGuide('panel')
}

function currentGroupFromForm(page) {
  return {
    mode: valueOf(page, '#group-mode') || 'panel',
    maxRounds: valueOf(page, '#group-max-rounds') || 3,
    maxParallel: valueOf(page, '#group-max-parallel') || 3,
    members: [...page.querySelectorAll('[data-member-row].is-selected')],
  }
}

function renderMemberPicker(group, experts) {
  if (!experts.length) {
    return `<div class="expert-teams-empty">${t('expertTeams.emptyExpertsHint')}</div>`
  }
  const memberMap = new Map((Array.isArray(group.members) ? group.members : []).map(member => [member.expertId, member]))
  const orderedExperts = [...experts].sort((a, b) => {
    const memberA = memberMap.get(a.id)
    const memberB = memberMap.get(b.id)
    if (memberA && memberB) return clampInt(memberA.order, 99, 1, 99) - clampInt(memberB.order, 99, 1, 99)
    if (memberA) return -1
    if (memberB) return 1
    return 0
  })
  return orderedExperts.map((expert, index) => {
    const member = memberMap.get(expert.id)
    const checked = !!member
    const order = member?.order ?? index + 1
    const orderLabel = t('expertTeams.memberOrderLabel', { order })
    return `
      <label class="expert-member-row ${checked ? 'is-selected' : ''}" data-member-row="${escapeAttr(expert.id)}">
        <input type="checkbox" data-member-toggle value="${escapeAttr(expert.id)}" ${checked ? 'checked' : ''}>
        <span class="expert-avatar" style="--expert-color:${escapeAttr(expert.color || '#4f46e5')}"></span>
        <span class="expert-member-main">
          <strong>${escapeHtml(expert.name || expert.id)}</strong>
          <small>${escapeHtml(expert.title || expert.description || expert.id)}</small>
        </span>
        <span class="expert-member-order-wrap">
          <span class="expert-member-order-label">${escapeHtml(orderLabel)}</span>
          <button class="expert-member-drag" type="button" data-member-drag draggable="${checked ? 'true' : 'false'}" ${checked ? '' : 'disabled'} aria-label="${escapeAttr(t('expertTeams.memberDragLabel'))}">${icon('grip-vertical', 14)}</button>
          <input class="expert-member-order" type="hidden" data-member-order value="${escapeAttr(order)}" ${checked ? '' : 'disabled'} aria-label="${escapeAttr(orderLabel)}">
        </span>
      </label>
    `
  }).join('')
}

function updateGroupMemberControls(page, state) {
  if (state.activeTab !== TABS.groups) return
  const rows = [...page.querySelectorAll('[data-member-row]')]
  const selected = []
  for (const row of rows) {
    const checkbox = row.querySelector('[data-member-toggle]')
    const order = row.querySelector('[data-member-order]')
    const checked = !!checkbox?.checked
    row.classList.toggle('is-selected', checked)
    if (order) order.disabled = !checked
    const drag = row.querySelector('[data-member-drag]')
    if (drag) {
      drag.disabled = !checked
      drag.draggable = checked
    }
    syncMemberOrderLabel(row)
    if (checked) selected.push(checkbox.value)
  }
  renumberSelectedMembers(page.querySelector('#expert-member-picker'))

  const count = page.querySelector('#expert-members-count')
  if (count) {
    count.textContent = selected.length
      ? t('expertTeams.membersSelected', { count: selected.length })
      : t('expertTeams.noMembersSelected')
  }

  const moderator = page.querySelector('#group-moderator')
  if (!moderator) return
  const current = moderator.value
  const selectedSet = new Set(selected)
  moderator.innerHTML = `<option value="">${t('expertTeams.noModerator')}</option>` + state.experts
    .filter(expert => selectedSet.has(expert.id))
    .map(expert => option(expert.id, expert.name || expert.id, current))
    .join('')
  if (!selectedSet.has(current)) moderator.value = ''
  updateGroupWorkflowGuide(page)
}

function renumberSelectedMembers(picker) {
  if (!picker) return
  const selectedRows = [...picker.querySelectorAll('[data-member-row].is-selected')]
  for (const [index, row] of selectedRows.entries()) {
    const order = row.querySelector('[data-member-order]')
    if (order) order.value = String(index + 1)
    syncMemberOrderLabel(row)
  }
}

function syncMemberOrderLabel(row) {
  const input = row.querySelector('[data-member-order]')
  const label = row.querySelector('.expert-member-order-label')
  if (!input || !label) return
  const order = clampInt(input.value, 1, 1, 99)
  const text = t('expertTeams.memberOrderLabel', { order })
  label.textContent = text
  input.setAttribute('aria-label', text)
}

function addCurrent(page, state) {
  if (state.activeTab === TABS.experts) {
    state.selectedExpertId = null
    state.draftExpert = blankExpert()
  } else {
    state.selectedGroupId = null
    state.draftGroup = blankGroup()
  }
  renderList(page, state)
  renderEditor(page, state)
}

function duplicateCurrent(page, state) {
  if (state.activeTab === TABS.experts) {
    const current = currentExpert(state)
    if (!current) return
    state.selectedExpertId = null
    state.draftExpert = {
      ...structuredCloneSafe(current),
      id: `${current.id || 'expert'}-copy-${Date.now()}`,
      name: current.name ? `${current.name} Copy` : '',
      createdAt: undefined,
      updatedAt: undefined,
    }
  } else {
    const current = currentGroup(state)
    if (!current) return
    state.selectedGroupId = null
    state.draftGroup = {
      ...structuredCloneSafe(current),
      id: `${current.id || 'team'}-copy-${Date.now()}`,
      name: current.name ? `${current.name} Copy` : '',
      createdAt: undefined,
      updatedAt: undefined,
    }
  }
  renderList(page, state)
  renderEditor(page, state)
}

async function saveCurrent(page, state) {
  try {
    if (state.activeTab === TABS.experts) {
      const expert = collectExpert(page, currentExpert(state))
      const saved = await api.saveExpert(expert)
      state.draftExpert = null
      state.selectedExpertId = saved?.id || expert.id
      toast(t('expertTeams.saveSuccess'), 'success')
      await loadData(page, state)
    } else {
      const group = collectGroup(page, currentGroup(state))
      const saved = await api.saveExpertGroup(group)
      state.draftGroup = null
      state.selectedGroupId = saved?.id || group.id
      toast(t('expertTeams.saveSuccess'), 'success')
      await loadData(page, state)
    }
  } catch (e) {
    toast(humanizeError(e, t('expertTeams.saveFailed')), 'error')
  }
}

async function deleteCurrent(page, state) {
  if (state.activeTab === TABS.experts) {
    const expert = currentExpert(state)
    if (!expert) return
    if (state.draftExpert) {
      state.draftExpert = null
      state.selectedExpertId = state.experts[0]?.id || null
      renderAll(page, state)
      return
    }
    const ok = await showConfirm({
      title: t('expertTeams.deleteExpertTitle'),
      message: t('expertTeams.deleteExpertConfirm', { name: expert.name || expert.id }),
      impact: [t('expertTeams.deleteExpertImpact')],
      confirmText: t('expertTeams.delete'),
    })
    if (!ok) return
    await api.deleteExpert(expert.id)
    state.selectedExpertId = null
    await loadData(page, state)
    return
  }

  const group = currentGroup(state)
  if (!group) return
  if (state.draftGroup) {
    state.draftGroup = null
    state.selectedGroupId = state.groups[0]?.id || null
    renderAll(page, state)
    return
  }
  const ok = await showConfirm({
    title: t('expertTeams.deleteGroupTitle'),
    message: t('expertTeams.deleteGroupConfirm', { name: group.name || group.id }),
    impact: [t('expertTeams.deleteGroupImpact')],
    confirmText: t('expertTeams.delete'),
  })
  if (!ok) return
  await api.deleteExpertGroup(group.id)
  state.selectedGroupId = null
  await loadData(page, state)
}

function collectExpert(page, current = {}) {
  const id = normalizeId(valueOf(page, '#expert-id'), valueOf(page, '#expert-name'), 'expert')
  const name = valueOf(page, '#expert-name')
  if (!name) throw new Error(t('expertTeams.nameRequired'))
  if (!ID_RE.test(id)) throw new Error(t('expertTeams.idInvalid'))
  const inheritDefault = valueOf(page, '#expert-model-inherit') !== 'fixed'
  const base = { ...(current || {}) }
  delete base.boundAgentId
  return {
    ...base,
    id,
    name,
    title: valueOf(page, '#expert-title'),
    description: valueOf(page, '#expert-description'),
    color: valueOf(page, '#expert-color') || '#4f46e5',
    enabled: page.querySelector('#expert-enabled')?.checked !== false,
    systemPrompt: valueOf(page, '#expert-system-prompt'),
    model: {
      ...(current?.model && typeof current.model === 'object' ? current.model : {}),
      inheritDefault,
      modelId: valueOf(page, '#expert-model-id'),
    },
    tools: readTagPicker(page, '#expert-tools-tags'),
    skills: readTagPicker(page, '#expert-skills-tags'),
    knowledgeRefs: splitLines(valueOf(page, '#expert-knowledge')),
    outputSchema: valueOf(page, '#expert-output-schema'),
  }
}

function collectGroup(page, current = {}) {
  const id = normalizeId(valueOf(page, '#group-id'), valueOf(page, '#group-name'), 'team')
  const name = valueOf(page, '#group-name')
  if (!name) throw new Error(t('expertTeams.nameRequired'))
  if (!ID_RE.test(id)) throw new Error(t('expertTeams.idInvalid'))
  const members = [...page.querySelectorAll('[data-member-row]')]
    .map((row, index) => {
      const checkbox = row.querySelector('[data-member-toggle]')
      if (!checkbox?.checked) return null
      const rawOrder = row.querySelector('[data-member-order]')?.value
      return {
        expertId: checkbox.value,
        required: true,
        order: clampInt(rawOrder, index + 1, 1, 99),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((member, index) => ({ ...member, order: index + 1 }))
  const memberIds = new Set(members.map(member => member.expertId))
  const moderatorExpertId = valueOf(page, '#group-moderator')
  return {
    ...current,
    id,
    name,
    description: valueOf(page, '#group-description'),
    mode: valueOf(page, '#group-mode') || 'panel',
    moderatorExpertId: memberIds.has(moderatorExpertId) ? moderatorExpertId : undefined,
    members,
    maxRounds: clampInt(valueOf(page, '#group-max-rounds'), 3, 1, 10),
    maxParallel: clampInt(valueOf(page, '#group-max-parallel'), 3, 1, 8),
    approvalPolicy: valueOf(page, '#group-approval-policy') || 'none',
  }
}

function currentExpert(state) {
  return state.draftExpert || state.experts.find(item => item.id === state.selectedExpertId) || null
}

function currentGroup(state) {
  return state.draftGroup || state.groups.find(item => item.id === state.selectedGroupId) || null
}

function blankExpert() {
  return {
    id: '',
    name: '',
    title: '',
    description: '',
    color: '#4f46e5',
    enabled: true,
    systemPrompt: '',
    model: { inheritDefault: true, modelId: '' },
    tools: [],
    skills: [],
    knowledgeRefs: [],
    outputSchema: '',
  }
}

function blankGroup() {
  return {
    id: '',
    name: '',
    description: '',
    mode: 'panel',
    moderatorExpertId: '',
    members: [],
    maxRounds: 3,
    maxParallel: 3,
    approvalPolicy: 'none',
  }
}

function field(id, label, value, opts = {}) {
  const attrs = [
    `id="${escapeAttr(id)}"`,
    `class="form-input"`,
    `value="${escapeAttr(value ?? '')}"`,
    opts.type ? `type="${escapeAttr(opts.type)}"` : 'type="text"',
    opts.placeholder ? `placeholder="${escapeAttr(opts.placeholder)}"` : '',
    opts.min != null ? `min="${escapeAttr(opts.min)}"` : '',
    opts.max != null ? `max="${escapeAttr(opts.max)}"` : '',
  ].filter(Boolean).join(' ')
  return `
    <label class="form-group">
      <span class="form-label">${escapeHtml(label)}</span>
      <input ${attrs}>
    </label>
  `
}

function textarea(id, label, value, opts = {}) {
  return `
    <label class="form-group">
      <span class="form-label">${escapeHtml(label)}</span>
      <textarea class="form-input expert-textarea" id="${escapeAttr(id)}" rows="${escapeAttr(opts.rows || 4)}">${escapeHtml(value ?? '')}</textarea>
      ${opts.hint ? `<span class="form-hint">${escapeHtml(opts.hint)}</span>` : ''}
    </label>
  `
}

function option(value, label, current) {
  return `<option value="${escapeAttr(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`
}

function moderatorOptions(group, experts) {
  const selected = new Set((Array.isArray(group.members) ? group.members : []).map(member => member.expertId))
  return `<option value="">${t('expertTeams.noModerator')}</option>` + experts
    .filter(expert => selected.has(expert.id))
    .map(expert => option(expert.id, expert.name || expert.id, group.moderatorExpertId || ''))
    .join('')
}

function memberCountText(group) {
  const count = Array.isArray(group.members) ? group.members.length : 0
  return count ? t('expertTeams.membersSelected', { count }) : t('expertTeams.noMembersSelected')
}

function filterItems(items, search) {
  if (!search) return items
  return items.filter(item => JSON.stringify(item).toLowerCase().includes(search))
}

function findExpert(experts, id) {
  return experts.find(expert => expert.id === id) || null
}

function valueOf(root, selector) {
  return String(root.querySelector(selector)?.value ?? '').trim()
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function joinLines(value) {
  return Array.isArray(value) ? value.filter(Boolean).join('\n') : ''
}

function normalizeSkillOptions(skills) {
  return (Array.isArray(skills) ? skills : [])
    .map(skill => {
      const id = String(skill?.name || skill?.slug || '').trim()
      if (!id) return null
      const state = skill.disabled
        ? 'disabled'
        : skill.blockedByAllowlist
          ? 'blocked'
          : skill.eligible === false
            ? 'missing'
            : 'ready'
      const suffix = {
        ready: '',
        missing: ' · 依赖未满足',
        disabled: ' · 已禁用',
        blocked: ' · 受限',
      }[state]
      return {
        id,
        name: id,
        desc: `${skill.description || skill.source || ''}${suffix}`.trim(),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function skillOptionsForExpert(expert, state) {
  const options = [...(state.availableSkills || [])]
  const seen = new Set(options.map(item => item.id))
  for (const id of Array.isArray(expert?.skills) ? expert.skills : []) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({ id, name: id, desc: state.skillsLoadFailed ? '已选择，Skills 列表加载失败' : '已选择，当前未扫描到' })
  }
  return options
}

function readTagPicker(root, selector) {
  const tags = root.querySelectorAll(`${selector} .expert-tag-picker-tag`)
  return [...tags].map(tag => tag.dataset.value).filter(Boolean)
}

function renderTagPicker(id, label, options, selectedIds) {
  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : [])
  const count = selectedSet.size
  const normalizedOptions = mergeSelectedTagOptions(options, selectedSet)
  return `
      <div class="expert-tag-picker" id="${id}-picker" data-picker-id="${id}">
      <span class="form-label">${escapeHtml(label)}</span>
      <button type="button" class="expert-tag-picker-trigger" id="${id}-trigger" data-modal="${id}-modal">
        <span class="expert-tag-picker-count">${count ? `已选 ${count} 项` : '点击选择...'}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="expert-tag-picker-tags" id="${id}-tags">
        ${normalizedOptions.filter(o => selectedSet.has(o.id)).map(o => `
          <span class="expert-tag-picker-tag" data-value="${escapeAttr(o.id)}">${escapeHtml(o.name || o.id)}</span>
        `).join('')}
      </div>
      <div class="expert-tag-modal-overlay" id="${id}-modal" hidden>
        <div class="expert-tag-modal" role="dialog" aria-modal="true" aria-labelledby="${id}-modal-title">
          <div class="expert-tag-modal-head">
            <strong id="${id}-modal-title">${escapeHtml(label)}</strong>
            <button type="button" class="expert-tag-modal-close" data-close-modal="${id}-modal" aria-label="关闭">✕</button>
          </div>
          <div class="expert-tag-modal-search">
            <input class="form-input" id="${id}-modal-search" type="text" placeholder="搜索..." autocomplete="off">
          </div>
          <div class="expert-tag-modal-actions">
            <button type="button" class="btn btn-xs btn-ghost" data-action="select-all" data-picker="${id}">全选</button>
            <button type="button" class="btn btn-xs btn-ghost" data-action="deselect-all" data-picker="${id}">取消全选</button>
            <button type="button" class="btn btn-xs btn-ghost" data-action="invert" data-picker="${id}">反选</button>
          </div>
          <div class="expert-tag-modal-list" id="${id}-modal-list">
            ${renderModalOptions(normalizedOptions, selectedSet)}
          </div>
          <div class="expert-tag-modal-foot">
            <button type="button" class="btn btn-sm btn-secondary" data-close-modal="${id}-modal">取消</button>
            <button type="button" class="btn btn-sm btn-primary" data-confirm-modal="${id}-modal">确认</button>
          </div>
        </div>
      </div>
    </div>
  `
}

function mergeSelectedTagOptions(options, selectedSet) {
  const next = [...(Array.isArray(options) ? options : [])]
  const seen = new Set(next.map(item => item.id))
  for (const id of selectedSet) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push({ id, name: id, desc: '已选择，当前不在可选列表中' })
  }
  return next
}

function renderModalOptions(options, selectedSet) {
  return options.map(o => `
    <label class="expert-tag-modal-option" data-opt-id="${escapeAttr(o.id)}">
      <input type="checkbox" ${selectedSet.has(o.id) ? 'checked' : ''} data-check-id="${escapeAttr(o.id)}">
      <div>
        <strong>${escapeHtml(o.name || o.id)}</strong>
        <small>${escapeHtml(o.desc || '')}</small>
      </div>
    </label>
  `).join('')
}

function bindTagPickerEvents(root, id, options) {
  const picker = root.querySelector(`#${id}-picker`)
  if (!picker) return
  let pickerOptions = Array.isArray(options) ? options : []

  const modal = picker.querySelector(`#${id}-modal`)
  const trigger = picker.querySelector(`#${id}-trigger`)
  const searchEl = picker.querySelector(`#${id}-modal-search`)
  const listEl = picker.querySelector(`#${id}-modal-list`)
  const tagsEl = picker.querySelector(`#${id}-tags`)
  const countEl = picker.querySelector('.expert-tag-picker-count')

  function getSelectedFromModal() {
    const checks = modal.querySelectorAll('input[type="checkbox"]:checked')
    return [...checks].map(c => c.dataset.checkId)
  }

  function getSelectedFromTags() {
    return [...tagsEl.querySelectorAll('.expert-tag-picker-tag')]
      .map(tag => tag.dataset.value)
      .filter(Boolean)
  }

  function syncTags(selected) {
    const set = new Set(selected)
    pickerOptions = mergeSelectedTagOptions(pickerOptions, set)
    tagsEl.innerHTML = [...set].map(v => {
      const opt = pickerOptions.find(o => o.id === v)
      return `<span class="expert-tag-picker-tag" data-value="${escapeAttr(v)}">${escapeHtml(opt?.name || v)}</span>`
    }).join('')
    countEl.textContent = set.size ? `已选 ${set.size} 项` : '点击选择...'
  }

  function applySearch() {
    const q = (searchEl?.value || '').toLowerCase()
    modal.querySelectorAll('.expert-tag-modal-option').forEach(el => {
      const id = el.dataset.optId || ''
      const text = el.textContent?.toLowerCase() || ''
      el.hidden = q && !id.includes(q) && !text.includes(q)
    })
  }

  // 打开弹窗
  trigger.addEventListener('click', () => {
    // 同步当前选中状态到 modal checkbox
    const current = getSelectedFromTags()
    pickerOptions = mergeSelectedTagOptions(pickerOptions, new Set(current))
    // re-render options with current state
    listEl.innerHTML = renderModalOptions(pickerOptions, new Set(current))
    modal.hidden = false
    searchEl.value = ''
    applySearch()
    searchEl.focus()
  })

  // 关闭弹窗
  modal.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => { modal.hidden = true })
  })
  modal.querySelector('.expert-tag-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true
  })

  // 搜索
  searchEl.addEventListener('input', applySearch)

  // 全选/取消/反选
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const pickerId = btn.dataset.picker
    if (pickerId !== id) return
    const action = btn.dataset.action
    const checks = modal.querySelectorAll('input[type="checkbox"]')
    if (action === 'select-all') {
      checks.forEach(c => { c.checked = true; c.closest('.expert-tag-modal-option').hidden = false })
    } else if (action === 'deselect-all') {
      checks.forEach(c => { c.checked = false })
    } else if (action === 'invert') {
      checks.forEach(c => { c.checked = !c.checked })
    }
  })

  // 确认
  modal.querySelector('[data-confirm-modal]')?.addEventListener('click', () => {
    const selected = getSelectedFromModal()
    syncTags(selected)
    modal.hidden = true
  })
}

function normalizeId(rawId, name, prefix) {
  const raw = String(rawId || '').trim()
  if (raw) return raw
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || `${prefix}-${Date.now()}`
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function totalSelectedMembers(groups) {
  return groups.reduce((sum, group) => sum + (Array.isArray(group.members) ? group.members.length : 0), 0)
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value || {}))
}
