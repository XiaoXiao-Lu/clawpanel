/**
 * Expert Teams configuration page.
 *
 * This page intentionally covers configuration only: custom expert profiles,
 * reusable expert teams, member selection, and moderator/workflow settings.
 * Runtime orchestration can consume the persisted shape in a later phase.
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'
import { humanizeError } from '../lib/humanize-error.js'
import { t } from '../lib/i18n.js'
import { icon } from '../lib/icons.js'
import { escapeHtml, escapeAttr } from '../lib/utils.js'

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
    agents: [],
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
    if (!e.target.matches('[data-member-toggle], [data-member-order]')) return
    updateGroupMemberControls(page, state)
  })
}

async function loadData(page, state, opts = {}) {
  state.loading = true
  renderAll(page, state)
  try {
    const [experts, groups, agents] = await Promise.all([
      api.listExperts(),
      api.listExpertGroups(),
      api.listAgents().catch(() => []),
    ])
    state.experts = Array.isArray(experts) ? experts : []
    state.groups = Array.isArray(groups) ? groups : []
    state.agents = Array.isArray(agents) ? agents : []
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
    <span>${icon('users', 14)} ${t('expertTeams.membersSelected', { count: totalSelectedMembers(state.groups) })}</span>
  `
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
        <small>${escapeHtml(names || group.description || group.id)}</small>
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
            <span class="form-label">${t('expertTeams.boundAgent')}</span>
            <select class="form-input" id="expert-bound-agent">
              <option value="">${t('expertTeams.noBoundAgent')}</option>
              ${state.agents.map(agent => option(agent.id, agentLabel(agent), expert.boundAgentId || '')).join('')}
            </select>
          </label>
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
          ${textarea('expert-tools', t('expertTeams.tools'), joinLines(expert.tools), { rows: 5 })}
          ${textarea('expert-skills', t('expertTeams.skills'), joinLines(expert.skills), { rows: 5 })}
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
          ${field('group-max-rounds', t('expertTeams.maxRounds'), group.maxRounds ?? 3, { type: 'number', min: 1, max: 20 })}
          ${field('group-max-parallel', t('expertTeams.maxParallel'), group.maxParallel ?? 3, { type: 'number', min: 1, max: 20 })}
          ${field('group-max-tokens', t('expertTeams.maxTokens'), group.budget?.maxTokens ?? 24000, { type: 'number', min: 1000, max: 1000000 })}
          <label class="form-group">
            <span class="form-label">${t('expertTeams.approvalPolicy')}</span>
            <select class="form-input" id="group-approval-policy">
              ${APPROVAL_POLICIES.map(([value, key]) => option(value, t(key), group.approvalPolicy || 'none')).join('')}
            </select>
          </label>
        </div>
      </section>
    </form>
  `
}

function renderMemberPicker(group, experts) {
  if (!experts.length) {
    return `<div class="expert-teams-empty">${t('expertTeams.emptyExpertsHint')}</div>`
  }
  const memberMap = new Map((Array.isArray(group.members) ? group.members : []).map(member => [member.expertId, member]))
  return experts.map((expert, index) => {
    const member = memberMap.get(expert.id)
    const checked = !!member
    const order = member?.order ?? index + 1
    return `
      <label class="expert-member-row ${checked ? 'is-selected' : ''}" data-member-row="${escapeAttr(expert.id)}">
        <input type="checkbox" data-member-toggle value="${escapeAttr(expert.id)}" ${checked ? 'checked' : ''}>
        <span class="expert-avatar" style="--expert-color:${escapeAttr(expert.color || '#4f46e5')}"></span>
        <span class="expert-member-main">
          <strong>${escapeHtml(expert.name || expert.id)}</strong>
          <small>${escapeHtml(expert.title || expert.description || expert.id)}</small>
        </span>
        <input class="form-input expert-member-order" type="number" min="1" max="99" data-member-order value="${escapeAttr(order)}" ${checked ? '' : 'disabled'} aria-label="order">
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
    if (checked) selected.push(checkbox.value)
  }

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
  return {
    ...current,
    id,
    name,
    title: valueOf(page, '#expert-title'),
    description: valueOf(page, '#expert-description'),
    color: valueOf(page, '#expert-color') || '#4f46e5',
    enabled: page.querySelector('#expert-enabled')?.checked !== false,
    systemPrompt: valueOf(page, '#expert-system-prompt'),
    boundAgentId: valueOf(page, '#expert-bound-agent') || undefined,
    model: {
      ...(current?.model && typeof current.model === 'object' ? current.model : {}),
      inheritDefault,
      modelId: valueOf(page, '#expert-model-id'),
    },
    tools: splitLines(valueOf(page, '#expert-tools')),
    skills: splitLines(valueOf(page, '#expert-skills')),
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
    maxRounds: clampInt(valueOf(page, '#group-max-rounds'), 3, 1, 20),
    maxParallel: clampInt(valueOf(page, '#group-max-parallel'), 3, 1, 20),
    budget: {
      ...(current?.budget && typeof current.budget === 'object' ? current.budget : {}),
      maxTokens: clampInt(valueOf(page, '#group-max-tokens'), 24000, 1000, 1000000),
    },
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
    budget: { maxTokens: 24000 },
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

function agentLabel(agent) {
  return agent.identityName || agent.name || agent.id || t('common.unknown')
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
