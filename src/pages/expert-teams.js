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
  { id: 'system', nameKey: 'expertTeams.toolSystem', descKey: 'expertTeams.toolSystemDesc' },
  { id: 'process', nameKey: 'expertTeams.toolProcess', descKey: 'expertTeams.toolProcessDesc' },
  { id: 'interaction', nameKey: 'expertTeams.toolInteraction', descKey: 'expertTeams.toolInteractionDesc' },
  { id: 'browser', nameKey: 'expertTeams.toolBrowser', descKey: 'expertTeams.toolBrowserDesc' },
  { id: 'terminal', nameKey: 'expertTeams.toolTerminal', descKey: 'expertTeams.toolTerminalDesc' },
  { id: 'webSearch', nameKey: 'expertTeams.toolWebSearch', descKey: 'expertTeams.toolWebSearchDesc' },
  { id: 'fileOps', nameKey: 'expertTeams.toolFileOps', descKey: 'expertTeams.toolFileOpsDesc' },
  { id: 'skills', nameKey: 'expertTeams.toolSkills', descKey: 'expertTeams.toolSkillsDesc' },
  { id: 'openclaw', nameKey: 'expertTeams.toolOpenClaw', descKey: 'expertTeams.toolOpenClawDesc' },
]

const TABS = {
  experts: 'experts',
  groups: 'groups',
}

export function nextExpertTabIndex(currentIndex, tabCount, key) {
  const count = Number.parseInt(tabCount, 10)
  if (!Number.isFinite(count) || count <= 0) return -1
  const current = Math.max(0, Math.min(Number.parseInt(currentIndex, 10) || 0, count - 1))
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowLeft') return (current + count - 1) % count
  if (key === 'ArrowRight') return (current + 1) % count
  return current
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

function getModeLabel(mode) {
  return t(GROUP_MODES.find(([value]) => value === mode)?.[1] || 'expertTeams.modePanel')
}

// 模板节奏标签：sequential 显示轮次，其余显示并行数（带正确的本地化占位符）。
function templateCadenceLabel(tpl = {}) {
  const rounds = Number(tpl.maxRounds) || 0
  if (tpl.mode === 'sequential' && rounds > 1) {
    return t('expertTeams.templateMetaRounds', { count: rounds })
  }
  const parallel = Number(tpl.maxParallel) || 3
  return t('expertTeams.templateMetaParallel', { count: parallel })
}

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
      <div class="tab-bar expert-teams-tabs" id="expert-teams-tabs" role="tablist" aria-label="${escapeAttr(t('expertTeams.title'))}">
        <button class="tab active" type="button" role="tab" aria-selected="true" tabindex="0" data-expert-tab="experts">${t('expertTeams.libraryTab')} <span id="expert-count">0</span></button>
        <button class="tab" type="button" role="tab" aria-selected="false" tabindex="-1" data-expert-tab="groups">${t('expertTeams.groupsTab')} <span id="group-count">0</span></button>
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

  page.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[data-expert-tab]')
    if (!tab) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const tabs = [...page.querySelectorAll('[data-expert-tab]')]
    const currentIndex = Math.max(0, tabs.indexOf(tab))
    const nextIndex = nextExpertTabIndex(currentIndex, tabs.length, e.key)
    tabs[nextIndex]?.focus()
    tabs[nextIndex]?.click()
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
    const [experts, groups] = await Promise.all([
      api.listExperts(),
      api.listExpertGroups(),
    ])
    state.experts = Array.isArray(experts) ? experts : []
    state.groups = Array.isArray(groups) ? groups : []
    state.availableSkills = []
    state.skillsLoadFailed = false
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
    loadSkillsOptions(page, state)
  } catch (e) {
    state.loading = false
    renderAll(page, state)
    toast(humanizeError(e, t('expertTeams.loadFailed')), 'error')
  }
}

async function loadSkillsOptions(page, state) {
  try {
    const skillsResult = await api.skillsList()
    state.availableSkills = normalizeSkillOptions(skillsResult?.skills || [])
    state.skillsLoadFailed = false
  } catch {
    state.availableSkills = []
    state.skillsLoadFailed = true
  }
  if (state.activeTab === TABS.experts && !shouldDeferSkillsEditorRefresh(page, state)) {
    renderEditor(page, state)
  }
}

function shouldDeferSkillsEditorRefresh(page, state) {
  if (state.draftExpert) return true
  const form = page.querySelector('#expert-editor-form')
  if (!form) return false
  const modalOpen = !!form.querySelector('.expert-tag-modal-overlay:not([hidden])')
  if (modalOpen || form.contains(document.activeElement)) return true
  const expert = currentExpert(state)
  if (!expert) return false
  const model = expert.model && typeof expert.model === 'object' ? expert.model : {}
  const inheritDefault = model.inheritDefault !== false
  const expected = {
    '#expert-id': expert.id || '',
    '#expert-name': expert.name || '',
    '#expert-title': expert.title || '',
    '#expert-description': expert.description || '',
    '#expert-system-prompt': expert.systemPrompt || '',
    '#expert-model-inherit': inheritDefault ? 'inherit' : 'fixed',
    '#expert-model-id': model.modelId || '',
    '#expert-knowledge': joinLines(expert.knowledgeRefs),
    '#expert-output-schema': expert.outputSchema || '',
  }
  return Object.entries(expected).some(([selector, value]) => valueOf(page, selector) !== String(value).trim())
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
    tab.setAttribute('aria-selected', active ? 'true' : 'false')
    tab.tabIndex = active ? 0 : -1
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
  const isFirstVisit = items.length === 0 && !state.search
  if (!filtered.length) {
    if (isFirstVisit) {
      body.innerHTML = state.activeTab === TABS.experts
        ? renderExpertOnboarding()
        : renderGroupOnboarding()
    } else {
      body.innerHTML = `
        <div class="expert-teams-empty">
          <strong>${state.activeTab === TABS.experts ? t('expertTeams.noExperts') : t('expertTeams.noGroups')}</strong>
          <span>${state.activeTab === TABS.experts ? t('expertTeams.emptyExpertsHint') : t('expertTeams.emptyGroupsHint')}</span>
        </div>
      `
    }
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
    <button class="expert-list-item ${active ? 'is-active' : ''}" type="button" data-select-id="${escapeAttr(expert.id)}" ${active ? 'aria-current="true"' : ''}>
      <span class="expert-avatar" style="--expert-color:${escapeAttr(expert.color || 'var(--brand, #4f46e5)')}"></span>
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
    <button class="expert-list-item ${active ? 'is-active' : ''}" type="button" data-select-id="${escapeAttr(group.id)}" ${active ? 'aria-current="true"' : ''}>
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
    bindTagPickerEvents(editor, 'expert-tools', toolCategoryOptions())
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
          ${renderTagPicker('expert-tools', t('expertTeams.tools'), toolCategoryOptions(), expert.tools || [])}
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
          ${field('group-max-rounds', t('expertTeams.maxRounds'), group.maxRounds ?? 3, { type: 'number', min: 1, max: 10, mutedNote: t('expertTeams.workflowInactiveHint') })}
          ${field('group-max-parallel', t('expertTeams.maxParallel'), group.maxParallel ?? 3, { type: 'number', min: 1, max: 8, mutedNote: t('expertTeams.workflowInactiveHint') })}
          <label class="form-group">
            <span class="form-label">${t('expertTeams.approvalPolicy')} <small class="form-label-note">${t('expertTeams.approvalPolicyNote')}</small></span>
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
    ? t('expertTeams.workflowSequentialExecution', { maxRounds })
    : t('expertTeams.workflowParallelExecution', { maxParallel })
  const roundMeaning = mode === 'sequential'
    ? t('expertTeams.workflowSequentialRoundMeaning', { maxContributions: maxRounds * Math.max(1, Array.isArray(group.members) ? group.members.length : 1) })
    : t('expertTeams.workflowParallelRoundMeaning')
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
          <small>${t('expertTeams.workflowExecution')}</small>
          <strong>${escapeHtml(execution)}</strong>
        </span>
        <span>
          <small>${t('expertTeams.workflowCommunication')}</small>
          <strong>${escapeHtml(guide.communication)}</strong>
        </span>
        <span>
          <small>${t('expertTeams.workflowBestFor')}</small>
          <strong>${escapeHtml(guide.bestFor)}</strong>
        </span>
        <span>
          <small>${t('expertTeams.workflowTuning')}</small>
          <strong>${escapeHtml(guide.tuning)}</strong>
        </span>
        <span class="expert-workflow-grid-wide">
          <small>${t('expertTeams.workflowRounds')}</small>
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
      title: t('expertTeams.modePanel'),
      summary: t('expertTeams.workflowPanelSummary'),
      communication: t('expertTeams.workflowPanelCommunication'),
      bestFor: t('expertTeams.workflowPanelBestFor'),
      tuning: t('expertTeams.workflowPanelTuning'),
    },
    creation: {
      icon: 'edit',
      title: t('expertTeams.modeCreation'),
      summary: t('expertTeams.workflowCreationSummary'),
      communication: t('expertTeams.workflowCreationCommunication'),
      bestFor: t('expertTeams.workflowCreationBestFor'),
      tuning: t('expertTeams.workflowCreationTuning'),
    },
    debate: {
      icon: 'message-square',
      title: t('expertTeams.modeDebate'),
      summary: t('expertTeams.workflowDebateSummary'),
      communication: t('expertTeams.workflowDebateCommunication'),
      bestFor: t('expertTeams.workflowDebateBestFor'),
      tuning: t('expertTeams.workflowDebateTuning'),
    },
    review: {
      icon: 'shield',
      title: t('expertTeams.modeReview'),
      summary: t('expertTeams.workflowReviewSummary'),
      communication: t('expertTeams.workflowReviewCommunication'),
      bestFor: t('expertTeams.workflowReviewBestFor'),
      tuning: t('expertTeams.workflowReviewTuning'),
    },
    research: {
      icon: 'search',
      title: t('expertTeams.modeResearch'),
      summary: t('expertTeams.workflowResearchSummary'),
      communication: t('expertTeams.workflowResearchCommunication'),
      bestFor: t('expertTeams.workflowResearchBestFor'),
      tuning: t('expertTeams.workflowResearchTuning'),
    },
    sequential: {
      icon: 'refresh-cw',
      title: t('expertTeams.modeSequential'),
      summary: t('expertTeams.workflowSequentialSummary'),
      communication: t('expertTeams.workflowSequentialCommunication'),
      bestFor: t('expertTeams.workflowSequentialBestFor'),
      tuning: t('expertTeams.workflowSequentialTuning'),
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
        <span class="expert-avatar" style="--expert-color:${escapeAttr(expert.color || 'var(--brand, #4f46e5)')}"></span>
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
    renderList(page, state)
    renderEditor(page, state)
  } else {
    // 专家团：弹出模板选择器
    showGroupTemplatePicker(page, state)
  }
}

function showGroupTemplatePicker(page, state) {
  // 移除已有弹窗
  const old = page.querySelector('.expert-template-picker-overlay')
  if (old) old.remove()

  const items = GROUP_TEMPLATES.map((tpl, idx) => `
    <button class="expert-template-item" data-template-idx="${idx}" type="button">
      <strong>${icon('users', 13)} ${escapeHtml(t(tpl.labelKey))}</strong>
      <small>${escapeHtml(t(tpl.descKey))}</small>
      <span class="expert-template-meta">${getModeLabel(tpl.mode)} · ${escapeHtml(templateCadenceLabel(tpl))} · ${escapeHtml(tpl.memberRoles?.join('、') || '')}</span>
    </button>
  `).join('')

  const previousFocus = document.activeElement
  const titleId = 'expert-template-picker-title'
  const overlay = document.createElement('div')
  overlay.className = 'expert-template-picker-overlay'
  overlay.innerHTML = `
    <div class="expert-template-picker" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="expert-template-picker-head">
        <span id="${titleId}">${t('expertTeams.createFromTemplate')}</span>
        <button type="button" data-action="template-blank">${t('expertTeams.createBlank')}</button>
      </div>
      <div class="expert-template-picker-body">${items}</div>
    </div>
  `

  const close = () => {
    document.removeEventListener('keydown', onKeydown, true)
    overlay.remove()
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus() } catch {}
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  overlay.addEventListener('click', (e) => {
    const item = e.target.closest('[data-template-idx]')
    if (item) {
      const idx = Number.parseInt(item.dataset.templateIdx, 10)
      const tpl = GROUP_TEMPLATES[idx]
      if (tpl) {
        state.selectedGroupId = null
        state.draftGroup = applyGroupTemplate(tpl)
        close()
        renderList(page, state)
        renderEditor(page, state)
      }
      return
    }
    if (e.target.closest('[data-action="template-blank"]')) {
      state.selectedGroupId = null
      state.draftGroup = blankGroup()
      close()
      renderList(page, state)
      renderEditor(page, state)
      return
    }
    if (e.target === overlay) close()
  })

  document.addEventListener('keydown', onKeydown, true)
  page.appendChild(overlay)
  // 打开后把焦点移入弹窗，便于键盘操作与读屏。
  ;(overlay.querySelector('[data-template-idx]') || overlay.querySelector('[data-action="template-blank"]'))?.focus()
}

function renderExpertOnboarding() {
  const steps = [
    { icon: 'user-plus', title: t('expertTeams.onboardStep1Title'), desc: t('expertTeams.onboardStep1Desc') },
    { icon: 'settings', title: t('expertTeams.onboardStep2Title'), desc: t('expertTeams.onboardStep2Desc') },
    { icon: 'message-circle', title: t('expertTeams.onboardStep3Title'), desc: t('expertTeams.onboardStep3Desc') },
  ]
  return `
    <div class="expert-onboarding">
      <div class="expert-onboarding-head">
        ${icon('sparkles', 20)}
        <strong>${t('expertTeams.onboardExpertTitle')}</strong>
        <span>${t('expertTeams.onboardExpertDesc')}</span>
      </div>
      <ol class="expert-onboarding-steps">
        ${steps.map((s, i) => `
          <li class="expert-onboarding-step">
            <span class="expert-onboarding-step-num">${i + 1}</span>
            <div>
              <strong>${icon(s.icon, 13)} ${escapeHtml(s.title)}</strong>
              <span>${escapeHtml(s.desc)}</span>
            </div>
          </li>
        `).join('')}
      </ol>
      <button class="btn btn-primary btn-sm expert-onboarding-cta" data-action="add">${icon('plus', 13)} ${t('expertTeams.addExpert')}</button>
    </div>
  `
}

function renderGroupOnboarding() {
  const steps = [
    { icon: 'users', title: t('expertTeams.onboardGroupStep1Title'), desc: t('expertTeams.onboardGroupStep1Desc') },
    { icon: 'settings-2', title: t('expertTeams.onboardGroupStep2Title'), desc: t('expertTeams.onboardGroupStep2Desc') },
    { icon: 'play', title: t('expertTeams.onboardGroupStep3Title'), desc: t('expertTeams.onboardGroupStep3Desc') },
  ]
  return `
    <div class="expert-onboarding">
      <div class="expert-onboarding-head">
        ${icon('sparkles', 20)}
        <strong>${t('expertTeams.onboardGroupTitle')}</strong>
        <span>${t('expertTeams.onboardGroupDesc')}</span>
      </div>
      <ol class="expert-onboarding-steps">
        ${steps.map((s, i) => `
          <li class="expert-onboarding-step">
            <span class="expert-onboarding-step-num">${i + 1}</span>
            <div>
              <strong>${icon(s.icon, 13)} ${escapeHtml(s.title)}</strong>
              <span>${escapeHtml(s.desc)}</span>
            </div>
          </li>
        `).join('')}
      </ol>
      <button class="btn btn-primary btn-sm expert-onboarding-cta" data-action="add">${icon('plus', 13)} ${t('expertTeams.addGroup')}</button>
    </div>
  `
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
    try {
      await api.deleteExpert(expert.id)
      state.selectedExpertId = null
      await loadData(page, state)
    } catch (e) {
      toast(humanizeError(e, t('expertTeams.deleteFailed')), 'error')
    }
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
  try {
    await api.deleteExpertGroup(group.id)
    state.selectedGroupId = null
    await loadData(page, state)
  } catch (e) {
    toast(humanizeError(e, t('expertTeams.deleteFailed')), 'error')
  }
}

function collectExpert(page, current = {}) {
  const id = normalizeId(valueOf(page, '#expert-id'), valueOf(page, '#expert-name'), 'expert')
  const name = valueOf(page, '#expert-name')
  if (!name) throw new Error(t('expertTeams.nameRequired'))
  if (!ID_RE.test(id)) throw new Error(t('expertTeams.idInvalid'))
  const inheritDefault = valueOf(page, '#expert-model-inherit') !== 'fixed'
  const rawModelId = valueOf(page, '#expert-model-id')
  const modelId = inheritDefault ? rawModelId : normalizeProviderModelRef(rawModelId)
  if (!inheritDefault && !modelId) throw new Error(t('expertTeams.modelIdInvalid'))
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
      modelId,
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
  if (!members.length) throw new Error(t('expertTeams.groupMembersRequired'))
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

// ── 团队模板（按模式预设） ──
// label/description 使用 i18n key，运行时通过 t() 翻译
const GROUP_TEMPLATES = [
  { labelKey: 'expertTeams.tplCodeReview', mode: 'review', descKey: 'expertTeams.tplCodeReviewDesc', maxParallel: 3, memberRoles: ['安全审计', '测试工程师', '体验顾问'] },
  { labelKey: 'expertTeams.tplProductReview', mode: 'panel', descKey: 'expertTeams.tplProductReviewDesc', maxParallel: 3, maxRounds: 2, memberRoles: ['产品经理', '技术负责人', '用户研究员'] },
  { labelKey: 'expertTeams.tplContentCreation', mode: 'creation', descKey: 'expertTeams.tplContentCreationDesc', maxParallel: 4, memberRoles: ['策略', '编辑', '视觉建议'] },
  { labelKey: 'expertTeams.tplDebate', mode: 'debate', descKey: 'expertTeams.tplDebateDesc', maxParallel: 4, memberRoles: ['支持方', '反对方', '风险评估', '成本分析'] },
  { labelKey: 'expertTeams.tplResearch', mode: 'research', descKey: 'expertTeams.tplResearchDesc', maxParallel: 3, memberRoles: ['技术调研', '市场分析', '竞品调查'] },
  { labelKey: 'expertTeams.tplSequential', mode: 'sequential', descKey: 'expertTeams.tplSequentialDesc', maxRounds: 3, memberRoles: ['规划师', '执行者', '审查者'] },
]

function applyGroupTemplate(template) {
  return {
    ...blankGroup(),
    name: t(template.labelKey),
    description: t(template.descKey),
    mode: template.mode,
    maxRounds: template.maxRounds ?? 3,
    maxParallel: template.maxParallel ?? 3,
    members: [],
    _templateHint: template.memberRoles?.join('、'),
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
  const mutedNoteAttr = opts.mutedNote ? ` data-muted-note="${escapeAttr(opts.mutedNote)}"` : ''
  return `
    <label class="form-group">
      <span class="form-label"${mutedNoteAttr}>${escapeHtml(label)}</span>
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
        missing: t('expertTeams.skillMissingSuffix'),
        disabled: t('expertTeams.skillDisabledSuffix'),
        blocked: t('expertTeams.skillBlockedSuffix'),
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

function toolCategoryOptions() {
  return TOOL_CATEGORIES.map(item => ({
    id: item.id,
    name: t(item.nameKey),
    desc: t(item.descKey),
  }))
}

function skillOptionsForExpert(expert, state) {
  const options = [...(state.availableSkills || [])]
  const seen = new Set(options.map(item => item.id))
  for (const id of Array.isArray(expert?.skills) ? expert.skills : []) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({
      id,
      name: id,
      desc: state.skillsLoadFailed ? t('expertTeams.selectedSkillListFailed') : t('expertTeams.selectedSkillNotScanned'),
    })
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
        <span class="expert-tag-picker-count">${count ? t('expertTeams.tagPickerSelected', { count }) : t('expertTeams.tagPickerChoose')}</span>
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
            <button type="button" class="expert-tag-modal-close" data-close-modal="${id}-modal" aria-label="${escapeAttr(t('common.close'))}">✕</button>
          </div>
          <div class="expert-tag-modal-search">
            <input class="form-input" id="${id}-modal-search" type="text" placeholder="${escapeAttr(t('common.search'))}" autocomplete="off">
          </div>
          <div class="expert-tag-modal-actions">
            <button type="button" class="btn btn-xs btn-ghost" data-action="select-all" data-picker="${id}">${t('expertTeams.tagPickerSelectAll')}</button>
            <button type="button" class="btn btn-xs btn-ghost" data-action="deselect-all" data-picker="${id}">${t('expertTeams.tagPickerDeselectAll')}</button>
            <button type="button" class="btn btn-xs btn-ghost" data-action="invert" data-picker="${id}">${t('expertTeams.tagPickerInvert')}</button>
          </div>
          <div class="expert-tag-modal-list" id="${id}-modal-list">
            ${renderModalOptions(normalizedOptions, selectedSet)}
          </div>
          <div class="expert-tag-modal-foot">
            <button type="button" class="btn btn-sm btn-secondary" data-close-modal="${id}-modal">${t('common.cancel')}</button>
            <button type="button" class="btn btn-sm btn-primary" data-confirm-modal="${id}-modal">${t('common.confirm')}</button>
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
    next.push({ id, name: id, desc: t('expertTeams.selectedTagNotAvailable') })
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
    countEl.textContent = set.size ? t('expertTeams.tagPickerSelected', { count: set.size }) : t('expertTeams.tagPickerChoose')
  }

  function applySearch() {
    const q = (searchEl?.value || '').toLowerCase()
    modal.querySelectorAll('.expert-tag-modal-option').forEach(el => {
      const id = el.dataset.optId || ''
      const text = el.textContent?.toLowerCase() || ''
      el.hidden = q && !id.includes(q) && !text.includes(q)
    })
  }

  function closeModal({ restoreFocus = false } = {}) {
    modal.hidden = true
    if (restoreFocus) trigger.focus()
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
    btn.addEventListener('click', () => closeModal({ restoreFocus: true }))
  })
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal({ restoreFocus: true })
  })
  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    closeModal({ restoreFocus: true })
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
    closeModal({ restoreFocus: true })
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

function isProviderModelRef(value) {
  return !!normalizeProviderModelRef(value)
}

function normalizeProviderModelRef(value) {
  const text = String(value || '').trim()
  const slash = text.indexOf('/')
  if (slash <= 0 || slash === text.length - 1) return ''
  const provider = text.slice(0, slash).trim()
  const model = text.slice(slash + 1).trim()
  if (!provider || !model || /\s/.test(provider) || /\s/.test(model)) return ''
  return `${provider}/${model}`
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
