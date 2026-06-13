/**
 * Agent 详情页
 * 概览 / 文件 / 渠道 三个 Tab
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { showConfirm } from '../components/modal.js'
import { CHANNEL_LABELS } from '../lib/channel-labels.js'
import { t } from '../lib/i18n.js'
import { navigate } from '../router.js'
import { isTauriRuntime } from '../lib/tauri-api.js'
import { escapeHtml as esc } from '../lib/utils.js'
import { icon, statusIcon } from '../lib/icons.js'

function openChannelsBindingPage(agentId) {
  const params = new URLSearchParams()
  params.set('tab', 'agents')
  params.set('agent', agentId || 'main')
  params.set('action', 'bind')
  navigate(`/channels?${params.toString()}`)
}

export async function render() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const agentId = params.get('id') || 'main'

  const page = document.createElement('div')
  page.className = 'page agent-detail-page'

  page.innerHTML = `
    <div class="page-header agent-detail-header">
      <div class="agent-detail-heading">
        <a class="agent-back-link" href="#/agents">${t('agentDetail.back')}</a>
        <h1 class="page-title" id="agent-detail-title">Agent: ${esc(agentId)}</h1>
      </div>
      <div class="agent-detail-actions">
        <button class="btn btn-sm btn-secondary" id="btn-backup-agent">${t('agents.backup') || '备份'}</button>
      </div>
    </div>
    <div class="tab-bar" id="agent-tabs">
      <div class="tab active" data-tab="overview">${t('agentDetail.tabOverview')}</div>
      <div class="tab" data-tab="files">${t('agentDetail.tabFiles')}</div>
      <div class="tab" data-tab="channels">${t('agentDetail.tabChannels')}</div>
      <div class="tab" data-tab="tools">${t('agentDetail.tabTools')}</div>
      <div class="tab" data-tab="skills">${t('agentDetail.tabSkills')}</div>
    </div>
    <div class="page-content">
      <div id="agent-tab-content"></div>
    </div>
  `

  const state = { agentId, detail: null, files: null, models: [], skillsCatalog: [] }

  // Tab 切换
  page.querySelector('#agent-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab')
    if (!tab) return
    page.querySelectorAll('#agent-tabs .tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    switchTab(page, state, tab.dataset.tab)
  })

  // 备份按钮
  page.querySelector('#btn-backup-agent')?.addEventListener('click', () => backupAgent(state.agentId))

  // 首次加载
  loadDetail(page, state)

  return page
}

async function backupAgent(id) {
  toast(t('agents.backingUp', { id }), 'info')
  try {
    const zipPath = await api.backupAgent(id)
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      // 兼容 Windows 和 Unix 路径分隔符
      const sep = zipPath.includes('\\') ? '\\' : '/'
      const dir = zipPath.substring(0, zipPath.lastIndexOf(sep)) || zipPath
      await open(dir)
    } catch { /* fallback */ }
    const fileName = zipPath.includes('\\') ? zipPath.split('\\').pop() : zipPath.split('/').pop()
    toast(t('agents.backupDone', { file: fileName }), 'success')
  } catch (e) {
    toast(humanizeError(e, t('agents.backupFailed')), 'error')
  }
}

async function loadDetail(page, state) {
  const content = page.querySelector('#agent-tab-content')
  content.innerHTML = '<div class="skeleton" style="width:100%;height:200px;border-radius:8px"></div>'
  try {
    const [detail, config, skillsResp] = await Promise.all([
      api.getAgentDetail(state.agentId),
      api.readOpenclawConfig().catch(() => null),
      api.skillsList().catch(() => ({ skills: [] })),
    ])
    state.detail = detail
    // 解析可用模型
    state.models = parseModelList(config)
    state.skillsCatalog = Array.isArray(skillsResp?.skills) ? skillsResp.skills : []
    // 更新标题
    const title = page.querySelector('#agent-detail-title')
    const name = detail.identity?.name || detail.name || detail.id
    const emoji = detail.identity?.emoji || ''
    title.textContent = `${emoji} ${name}`.trim()
    if (detail.isDefault) {
      title.insertAdjacentHTML('beforeend', ` <span class="badge badge-success">${t('agentDetail.defaultAgent')}</span>`)
    }
    switchTab(page, state, 'overview')
  } catch (e) {
    content.innerHTML = `<div style="color:var(--error);padding:20px">${t('agentDetail.loadFailed')}: ${esc(String(e))}</div>`
  }
}

function parseModelList(config) {
  const models = []
  const providers = config?.models?.providers || {}
  for (const [pk, pv] of Object.entries(providers)) {
    for (const m of (pv.models || [])) {
      const id = typeof m === 'string' ? m : m.id
      if (id) models.push(`${pk}/${id}`)
    }
  }
  return models
}

function switchTab(page, state, tab) {
  const content = page.querySelector('#agent-tab-content')
  if (tab === 'overview') renderOverview(content, state)
  else if (tab === 'files') renderFiles(content, state)
  else if (tab === 'channels') renderChannels(content, state)
  else if (tab === 'tools') renderTools(content, state)
  else if (tab === 'skills') renderSkills(content, state)
}

// ==================== 概览 Tab ====================

function renderOverview(container, state) {
  const d = state.detail
  if (!d) { container.innerHTML = ''; return }

  // 解析模型配置
  let primaryModel = ''
  let fallbacks = []
  if (d.model) {
    if (typeof d.model === 'string') {
      primaryModel = d.model
    } else if (typeof d.model === 'object') {
      primaryModel = d.model.primary || ''
      fallbacks = Array.isArray(d.model.fallbacks) ? [...d.model.fallbacks] : []
    }
  }

  const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive']

  container.innerHTML = `
    <div class="agent-overview">
      <section class="agent-section">
        <h3 class="agent-section-title">${t('agentDetail.basicInfo')}</h3>
        <div class="agent-form-grid">
          <div class="form-group">
            <label class="form-label">${t('agentDetail.agentId')}</label>
            <input class="form-input" value="${esc(d.id)}" readonly style="opacity:0.6;cursor:not-allowed">
          </div>
          <div class="form-group">
            <label class="form-label">${t('agentDetail.name')}</label>
            <input class="form-input" id="ov-name" value="${esc(d.identity?.name || d.name || '')}" placeholder="${t('agentDetail.notSet')}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('agentDetail.emoji')}</label>
            <input class="form-input" id="ov-emoji" value="${esc(d.identity?.emoji || '')}" placeholder="🤖" style="max-width:80px">
          </div>
          <div class="form-group">
            <label class="form-label">${t('agentDetail.workspace')}</label>
            <input class="form-input" value="${esc(d.workspace || t('agentDetail.notSet'))}" readonly style="opacity:0.6;cursor:not-allowed;font-family:var(--font-mono);font-size:var(--font-size-xs)">
          </div>
        </div>
      </section>

      <section class="agent-section">
        <h3 class="agent-section-title">${t('agentDetail.modelConfig')}</h3>
        <div class="agent-form-grid">
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">${t('agentDetail.primaryModel')}</label>
            ${renderModelSelect('ov-primary-model', primaryModel, state.models)}
          </div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">${t('agentDetail.fallbackModels')}</label>
          <div id="ov-fallbacks">${renderFallbackList(fallbacks, state.models)}</div>
          <button class="btn btn-sm btn-secondary" id="btn-add-fallback" style="margin-top:8px">${t('agentDetail.addFallback')}</button>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">${t('agentDetail.thinkingLevel')}</label>
          <select class="form-input" id="ov-thinking" style="max-width:200px">
            <option value="">${t('agentDetail.notSet')}</option>
            ${thinkingLevels.map(lv => `<option value="${lv}" ${d.thinkingDefault === lv ? 'selected' : ''}>${t('agentDetail.thinking' + lv.charAt(0).toUpperCase() + lv.slice(1))}</option>`).join('')}
          </select>
        </div>
      </section>

      <div class="agent-save-bar">
        <button class="btn btn-primary" id="btn-save-overview">${t('agentDetail.saveOverview')}</button>
      </div>
    </div>
  `

  // 添加备选模型
  container.querySelector('#btn-add-fallback')?.addEventListener('click', () => {
    const list = container.querySelector('#ov-fallbacks')
    const idx = list.querySelectorAll('.fallback-row').length
    list.insertAdjacentHTML('beforeend', renderFallbackRow('', state.models, idx))
  })

  // 移除备选模型（事件代理）
  container.querySelector('#ov-fallbacks')?.addEventListener('click', (e) => {
    if (e.target.closest('.btn-remove-fallback')) {
      e.target.closest('.fallback-row').remove()
    }
  })

  // 保存
  container.querySelector('#btn-save-overview')?.addEventListener('click', () => saveOverview(container, state))
}

function renderModelSelect(id, selected, models) {
  if (!models.length) {
    return `<input class="form-input" id="${id}" value="${esc(selected)}" placeholder="provider/model">`
  }
  // 如果当前值不在列表中，添加到选项
  const opts = [...models]
  if (selected && !opts.includes(selected)) opts.unshift(selected)
  return `
    <select class="form-input" id="${id}">
      <option value="">${t('agentDetail.notSet')}</option>
      ${opts.map(m => `<option value="${esc(m)}" ${m === selected ? 'selected' : ''}>${esc(m)}</option>`).join('')}
    </select>
  `
}

function renderFallbackList(fallbacks, models) {
  if (!fallbacks.length) {
    return `<div class="agent-hint">${t('agentDetail.noFallback')}</div>`
  }
  return fallbacks.map((fb, i) => renderFallbackRow(fb, models, i)).join('')
}

function renderFallbackRow(value, models, idx) {
  const opts = [...models]
  if (value && !opts.includes(value)) opts.unshift(value)
  return `
    <div class="fallback-row" style="display:flex;gap:8px;align-items:center;margin-top:6px">
      <select class="form-input fallback-select" style="flex:1">
        <option value="">${t('agentDetail.notSet')}</option>
        ${opts.map(m => `<option value="${esc(m)}" ${m === value ? 'selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-danger btn-remove-fallback">${t('agentDetail.removeFallback')}</button>
    </div>
  `
}

async function saveOverview(container, state) {
  const btn = container.querySelector('#btn-save-overview')
  btn.disabled = true
  btn.textContent = t('agentDetail.saving')

  try {
    const name = container.querySelector('#ov-name')?.value?.trim() || ''
    const emoji = container.querySelector('#ov-emoji')?.value?.trim() || ''
    const primaryEl = container.querySelector('#ov-primary-model')
    const primary = primaryEl?.value?.trim() || ''
    const thinkingDefault = container.querySelector('#ov-thinking')?.value || ''

    // 收集备选模型
    const fallbacks = []
    container.querySelectorAll('.fallback-select').forEach(sel => {
      const v = sel.value.trim()
      if (v) fallbacks.push(v)
    })

    // 构建模型配置
    let model = primary || undefined
    if (primary && fallbacks.length > 0) {
      model = { primary, fallbacks }
    }

    await api.updateAgentConfig(state.agentId, {
      identity: { name: name || undefined, emoji: emoji || undefined },
      model,
      thinkingDefault: thinkingDefault || undefined,
    })

    // 更新本地缓存
    invalidate('list_agents', 'get_agent_detail')
    state.detail = await api.getAgentDetail(state.agentId)

    toast(t('agentDetail.saveSuccess'), 'success')
  } catch (e) {
    toast(humanizeError(e, t('agentDetail.saveFailed')), 'error')
  } finally {
    btn.disabled = false
    btn.textContent = t('agentDetail.saveOverview')
  }
}

// ==================== 工具 Tab ====================

function renderTools(container, state) {
  const tools = state.detail?.tools || {}
  const profile = tools.profile || ''
  const allow = Array.isArray(tools.allow) ? tools.allow.join(', ') : ''
  const alsoAllow = Array.isArray(tools.alsoAllow) ? tools.alsoAllow.join(', ') : ''
  const deny = Array.isArray(tools.deny) ? tools.deny.join(', ') : ''

  container.innerHTML = `
    <div class="agent-overview">
      <section class="agent-section">
        <h3 class="agent-section-title">${t('agentDetail.toolsTitle')}</h3>
        <p class="agent-section-desc">${t('agentDetail.toolsDesc')}</p>
        <div class="agent-form-grid">
          <div class="form-group">
            <label class="form-label">${t('agentDetail.toolProfile')}</label>
            <select class="form-input" id="tools-profile">
              <option value="">${t('agentDetail.notSet')}</option>
              <option value="minimal" ${profile === 'minimal' ? 'selected' : ''}>minimal</option>
              <option value="coding" ${profile === 'coding' ? 'selected' : ''}>coding</option>
              <option value="messaging" ${profile === 'messaging' ? 'selected' : ''}>messaging</option>
              <option value="full" ${profile === 'full' ? 'selected' : ''}>full</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">${t('agentDetail.toolAllow')}</label>
          <textarea class="form-input agent-multiline-input" id="tools-allow" placeholder="read_file, write_file, exec">${esc(allow)}</textarea>
          <div class="form-hint">${t('agentDetail.toolAllowHint')}</div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">${t('agentDetail.toolAlsoAllow')}</label>
          <textarea class="form-input agent-multiline-input" id="tools-also-allow" placeholder="grep_search, apply_patch">${esc(alsoAllow)}</textarea>
          <div class="form-hint">${t('agentDetail.toolAlsoAllowHint')}</div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">${t('agentDetail.toolDeny')}</label>
          <textarea class="form-input agent-multiline-input" id="tools-deny" placeholder="delete_file">${esc(deny)}</textarea>
          <div class="form-hint">${t('agentDetail.toolDenyHint')}</div>
        </div>
      </section>
      <div class="agent-save-bar">
        <button class="btn btn-primary" id="btn-save-tools">${t('agentDetail.saveTools')}</button>
      </div>
    </div>
  `

  container.querySelector('#btn-save-tools')?.addEventListener('click', () => saveTools(container, state))
}

async function saveTools(container, state) {
  const btn = container.querySelector('#btn-save-tools')
  btn.disabled = true
  btn.textContent = t('agentDetail.saving')
  try {
    const tools = {
      profile: container.querySelector('#tools-profile')?.value || undefined,
      allow: splitCsv(container.querySelector('#tools-allow')?.value),
      alsoAllow: splitCsv(container.querySelector('#tools-also-allow')?.value),
      deny: splitCsv(container.querySelector('#tools-deny')?.value),
    }
    await api.updateAgentConfig(state.agentId, { tools: compactObject(tools) })
    invalidate('get_agent_detail')
    state.detail = await api.getAgentDetail(state.agentId)
    toast(t('agentDetail.toolsSaved'), 'success')
  } catch (e) {
    toast(humanizeError(e, t('agentDetail.saveFailed')), 'error')
  } finally {
    btn.disabled = false
    btn.textContent = t('agentDetail.saveTools')
  }
}

// ==================== 技能 Tab ====================

function renderSkills(container, state) {
  const selected = new Set(Array.isArray(state.detail?.skills) ? state.detail.skills : [])
  const skills = state.skillsCatalog || []
  const selectableCount = skills.filter(skill => skill.disabled !== true).length
  const selectedCount = skills.filter(skill => skill.disabled !== true && selected.has(skill.name)).length

  container.innerHTML = `
    <div class="agent-overview">
      <section class="agent-section">
        <h3 class="agent-section-title">${t('agentDetail.skillsTitle')}</h3>
        <p class="agent-section-desc">${t('agentDetail.skillsDesc')}</p>
        ${skills.length ? `
          <div class="agent-skills-toolbar">
            <span class="agent-skills-count" id="agent-skills-count">${t('agentDetail.skillsSelectedCount', { selected: selectedCount, total: selectableCount })}</span>
            <div class="agent-skills-actions">
              <button class="btn btn-secondary btn-sm" id="btn-select-all-skills" type="button">${t('agentDetail.selectAllSkills')}</button>
              <button class="btn btn-secondary btn-sm" id="btn-clear-skills" type="button">${t('agentDetail.clearSkills')}</button>
            </div>
          </div>
          <div class="agent-skills-filter">
            <input type="text" class="form-input" id="agent-skill-filter-input" placeholder="🔍 ${t('skills.filterPlaceholder') || '搜索技能名称或描述...'}">
          </div>
          <div class="agent-skills-list">
            ${skills.map(skill => renderSkillCard(skill, selected.has(skill.name))).join('')}
          </div>
          <div class="agent-skills-empty" id="agent-skills-empty" style="display:none;padding:24px;text-align:center;color:var(--text-tertiary)">${t('skills.noResults')}</div>
        ` : `<div class="agent-skills-list"><div class="agent-hint">${t('agentDetail.noSkills')}</div></div>`}
      </section>
      <div class="agent-save-bar">
        <button class="btn btn-primary" id="btn-save-skills">${t('agentDetail.saveSkills')}</button>
      </div>
    </div>
  `

  container.querySelector('#btn-save-skills')?.addEventListener('click', () => saveSkills(container, state))
  const refreshSkillCount = () => {
    const countEl = container.querySelector('#agent-skills-count')
    if (!countEl) return
    const checked = container.querySelectorAll('.agent-skill-checkbox:not(:disabled):checked').length
    const total = container.querySelectorAll('.agent-skill-checkbox:not(:disabled)').length
    countEl.textContent = t('agentDetail.skillsSelectedCount', { selected: checked, total })
  }
  container.querySelector('#btn-select-all-skills')?.addEventListener('click', () => {
    container.querySelectorAll('.agent-skill-checkbox:not(:disabled)').forEach(input => { input.checked = true })
    refreshSkillCount()
  })
  container.querySelector('#btn-clear-skills')?.addEventListener('click', () => {
    container.querySelectorAll('.agent-skill-checkbox:not(:disabled)').forEach(input => { input.checked = false })
    refreshSkillCount()
  })
  container.querySelectorAll('.agent-skill-checkbox').forEach(input => {
    input.addEventListener('change', refreshSkillCount)
  })

  // 技能搜索过滤
  const filterInput = container.querySelector('#agent-skill-filter-input')
  const emptyEl = container.querySelector('#agent-skills-empty')
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.trim().toLowerCase()
      const list = container.querySelector('.agent-skills-list')
      let visibleCount = 0
      list.querySelectorAll('.agent-skill-card').forEach(card => {
        const name = (card.dataset.name || '').toLowerCase()
        const desc = (card.dataset.desc || '').toLowerCase()
        const match = !q || name.includes(q) || desc.includes(q)
        card.style.display = match ? '' : 'none'
        if (match) visibleCount++
      })
      if (emptyEl) {
        emptyEl.style.display = q && visibleCount === 0 ? '' : 'none'
      }
    })
  }

  // 点击技能卡片（非 checkbox）弹出预览
  container.querySelectorAll('.agent-skill-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.tagName === 'INPUT') return // 不拦截 checkbox
      const name = card.querySelector('.agent-skill-checkbox')?.dataset.skillName
      if (!name) return
      showSkillPreview(name, state.agentId)
    })
  })
}

function _buildSkillPreviewBody(body, detail, allMissing, allReqs) {
  body.style.cssText = 'padding:16px 20px'
  const description = normalizeSkillDescription(detail) || '暂无描述'
  body.replaceChildren(
    Object.assign(document.createElement('div'), { className: 'skill-preview-desc', textContent: description }),
  )
  if (allReqs.length) {
    const section = document.createElement('div')
    section.className = 'skill-preview-section'
    section.appendChild(Object.assign(document.createElement('h4'), { textContent: '所需工具' }))
    const tags = document.createElement('div')
    tags.className = 'skill-preview-tags'
    for (const r of allReqs) {
      tags.appendChild(Object.assign(document.createElement('span'), { className: 'badge badge-api-type', textContent: r }))
    }
    section.appendChild(tags)
    body.appendChild(section)
  }
  if (allMissing.length) {
    const section = document.createElement('div')
    section.className = 'skill-preview-section'
    const heading = document.createElement('h4')
    heading.appendChild(statusIcon('warn', 14))
    heading.appendChild(document.createTextNode(' 缺少依赖'))
    section.appendChild(heading)
    const tags = document.createElement('div')
    tags.className = 'skill-preview-tags'
    for (const m of allMissing) {
      tags.appendChild(Object.assign(document.createElement('span'), {
        className: 'badge',
        style: 'background:var(--error-muted);color:var(--error)',
        textContent: String(m),
      }))
    }
    section.appendChild(tags)
    body.appendChild(section)
  }
  if (detail?.homepage) {
    const section = document.createElement('div')
    section.className = 'skill-preview-section'
    const link = Object.assign(document.createElement('a'), {
      href: detail.homepage,
      target: '_blank',
      rel: 'noopener',
      textContent: '',
    })
    link.style.cssText = 'color:var(--accent);display:inline-flex;align-items:center;gap:4px'
    link.appendChild(icon('link', 14))
    link.appendChild(document.createTextNode(' 查看主页'))
    section.appendChild(link)
    body.appendChild(section)
  }
  if (detail?.source) {
    const section = document.createElement('div')
    section.className = 'skill-preview-section'
    section.style.cssText = 'color:var(--text-tertiary);font-size:12px'
    const sourceText = '来源: ' + detail.source + (detail?.version ? ' · v' + detail.version : '') + (detail?.author ? ' · ' + detail.author : '')
    section.textContent = sourceText
    body.appendChild(section)
  }
}

function showSkillPreview(name, agentId) {
  // 显示加载中弹窗
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const modal = document.createElement('div')
  modal.className = 'modal agent-skill-preview-modal'
  const titleEl = document.createElement('div')
  titleEl.className = 'modal-title'
  titleEl.appendChild(icon('puzzle', 14))
  titleEl.appendChild(document.createTextNode(' ' + name))
  const bodyEl = document.createElement('div')
  bodyEl.className = 'modal-body'
  bodyEl.style.cssText = 'padding:40px;text-align:center;color:var(--text-tertiary)'
  bodyEl.textContent = '加载中...'
  const actionsEl = document.createElement('div')
  actionsEl.className = 'modal-actions'
  const cancelBtn = Object.assign(document.createElement('button'), {
    className: 'btn btn-secondary btn-sm',
    dataset: { action: 'cancel' },
    textContent: t('common.close') || '关闭',
  })
  actionsEl.appendChild(cancelBtn)
  modal.appendChild(titleEl)
  modal.appendChild(bodyEl)
  modal.appendChild(actionsEl)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  _trackOverlay(overlay)

  const close = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  cancelBtn.addEventListener('click', close)

  // 异步加载详情
  api.skillsInfo(name, agentId).then(detail => {
    const missingInfo = detail?.missing || {}
    const reqs = detail?.requirements || {}
    const allMissing = [
      ...(missingInfo.bins || []),
      ...(missingInfo.anyBins || []),
      ...(missingInfo.env || []),
      ...(missingInfo.config || []),
    ]
    const allReqs = [
      ...(reqs.bins || []).map(b => typeof b === 'string' ? b : b.name || JSON.stringify(b)),
      ...(reqs.env || []).map(e => typeof e === 'string' ? e : e.name || JSON.stringify(e)),
    ]
    _buildSkillPreviewBody(bodyEl, detail, allMissing, allReqs)
  }).catch(e => {
    bodyEl.style.cssText = 'padding:40px;text-align:center;color:var(--error)'
    bodyEl.textContent = '加载失败: ' + esc(String(e))
  })
}

function renderSkillCard(skill, checked) {
  const emoji = skill.emoji || '🧩'
  const desc = normalizeSkillDescription(skill)
  const displayDesc = desc || '暂无描述'
  const eligible = skill.eligible !== false
  const disabled = skill.disabled === true
  return `
    <label class="agent-skill-card ${!eligible || disabled ? 'is-muted' : ''}" data-name="${esc(skill.name)}" data-desc="${esc(desc || skill.name || '')}">
      <input type="checkbox" class="agent-skill-checkbox" data-skill-name="${esc(skill.name)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <div class="agent-skill-main">
        <div class="agent-skill-head">
          <span class="agent-skill-name">${esc(emoji)} ${esc(skill.name)}</span>
          ${disabled ? `<span class="agent-skill-badge">${t('agentDetail.skillDisabled')}</span>` : ''}
          ${!eligible && !disabled ? `<span class="agent-skill-badge">${t('agentDetail.skillUnavailable')}</span>` : ''}
        </div>
        <div class="agent-skill-desc ${desc ? '' : 'is-empty'}">${esc(displayDesc)}</div>
      </div>
    </label>
  `
}

function normalizeSkillDescription(skill) {
  const raw = [skill?.description, skill?.desc, skill?.summary]
    .find(value => typeof value === 'string' && value.trim())
  const text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''

  const markdownResidue = /^[>|\\\-_*`~\s]+$/.test(text)
  const hasReadableText = /[A-Za-z0-9\u4e00-\u9fff]/.test(text)
  if (markdownResidue || (text.length <= 2 && !hasReadableText)) return ''
  return text
}

async function saveSkills(container, state) {
  const btn = container.querySelector('#btn-save-skills')
  btn.disabled = true
  btn.textContent = t('agentDetail.saving')
  try {
    const selected = []
    container.querySelectorAll('.agent-skill-checkbox:checked').forEach((el) => selected.push(el.dataset.skillName))

    // 校验技能名是否真实存在
    const catalog = state.skillsCatalog || []
    const validNames = new Set(catalog.map(s => s.name))
    const invalid = selected.filter(name => !validNames.has(name))
    if (invalid.length) {
      toast(t('agentDetail.skillNameInvalid') + ': ' + invalid.join(', '), 'warning')
      btn.disabled = false
      btn.textContent = t('agentDetail.saveSkills')
      return
    }

    await api.updateAgentConfig(state.agentId, { skills: selected })
    invalidate('get_agent_detail')
    state.detail = await api.getAgentDetail(state.agentId)
    toast(t('agentDetail.skillsSaved'), 'success')

    // 检查 Gateway 运行状态
    try {
      const services = await api.getServicesStatus()
      const gatewayRunning = Array.isArray(services) && services.some(s => s.label === 'ai.openclaw.gateway' && s.running)
      if (!gatewayRunning) {
        toast(t('agentDetail.gatewayNotRunning'), 'warning')
      }
    } catch {
      // services 状态不可用时不阻塞主流程
    }
  } catch (e) {
    toast(humanizeError(e, t('agentDetail.saveFailed')), 'error')
  } finally {
    btn.disabled = false
    btn.textContent = t('agentDetail.saveSkills')
  }
}

function splitCsv(raw) {
  if (!raw) return undefined
  const values = String(raw)
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function compactObject(obj) {
  const next = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') next[key] = value
  }
  return Object.keys(next).length ? next : undefined
}

// ==================== 文件 Tab ====================

async function renderFiles(container, state) {
  container.innerHTML = `
    <div class="agent-files-section">
      <h3 class="agent-section-title">${t('agentDetail.filesTitle')}</h3>
      <p class="agent-section-desc">${t('agentDetail.filesDesc')}</p>
      <div id="agent-files-list"><div class="skeleton" style="width:100%;height:120px;border-radius:8px"></div></div>
    </div>
  `
  try {
    const files = await api.listAgentFiles(state.agentId)
    state.files = files
    renderFileList(container, state)
  } catch (e) {
    container.querySelector('#agent-files-list').innerHTML =
      `<div style="color:var(--error)">${t('agentDetail.loadFailed')}: ${esc(String(e))}</div>`
  }
}

function renderFileList(container, state) {
  const list = container.querySelector('#agent-files-list')
  const files = state.files || []
  if (!files.length) {
    list.innerHTML = `<div style="color:var(--text-tertiary)">${t('agentDetail.noFiles')}</div>`
    return
  }

  list.innerHTML = files.map(f => {
    const statusClass = f.exists ? 'file-exists' : 'file-missing'
    const statusText = f.exists ? t('agentDetail.fileExists') : t('agentDetail.fileMissing')
    const sizeText = f.exists ? formatSize(f.size) : '-'
    const timeText = f.exists && f.mtime ? new Date(f.mtime).toLocaleString('zh-CN') : '-'
    const actionBtn = f.exists
      ? `<button class="btn btn-sm btn-secondary" data-action="edit-file" data-name="${esc(f.name)}">${t('agentDetail.fileEdit')}</button>`
      : `<button class="btn btn-sm btn-primary" data-action="create-file" data-name="${esc(f.name)}">${t('agentDetail.fileCreate')}</button>`

    return `
      <div class="agent-file-card">
        <div class="agent-file-header">
          <div class="agent-file-info">
            <span class="agent-file-name">${esc(f.name)}</span>
            <span class="agent-file-status ${statusClass}">${statusText}</span>
          </div>
          <div class="agent-file-actions">${actionBtn}</div>
        </div>
        <div class="agent-file-desc">${esc(f.desc)}</div>
        ${f.exists ? `<div class="agent-file-meta">${t('agentDetail.fileSize')}: ${sizeText} · ${t('agentDetail.fileUpdated')}: ${timeText}</div>` : ''}
      </div>
    `
  }).join('')

  // 事件代理
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const name = btn.dataset.name
    if (btn.dataset.action === 'edit-file') openFileEditor(container, state, name)
    else if (btn.dataset.action === 'create-file') openFileEditor(container, state, name, true)
  })
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

async function openFileEditor(container, state, name, isNew = false) {
  let content = ''
  if (!isNew) {
    try {
      const res = await api.readAgentFile(state.agentId, name)
      content = res.content || ''
    } catch (e) {
      toast(humanizeError(e, t('agentDetail.loadFailed')), 'error')
      return
    }
  }

  // 用弹窗编辑器
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal agent-file-editor-modal">
      <div class="modal-title">${t('agentDetail.editFileTitle', { name })}</div>
      <textarea class="agent-file-editor" id="file-editor-textarea" spellcheck="false">${esc(content)}</textarea>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">${t('common.cancel')}</button>
        <button class="btn btn-primary btn-sm" data-action="save">${t('agentDetail.saveOverview')}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  _trackOverlay(overlay)

  const textarea = overlay.querySelector('#file-editor-textarea')
  textarea.focus()

  // Tab 键支持
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end)
      textarea.selectionStart = textarea.selectionEnd = start + 2
    }
  })

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove()
  })
  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove()
  overlay.querySelector('[data-action="save"]').onclick = async () => {
    try {
      await api.writeAgentFile(state.agentId, name, textarea.value)
      toast(isNew ? t('agentDetail.fileCreated') : t('agentDetail.fileSaved'), 'success')
      overlay.remove()
      // 刷新文件列表
      renderFiles(container, state)
    } catch (e) {
      toast(humanizeError(e, t('agentDetail.fileSaveFailed')), 'error')
    }
  }

  // Ctrl+S 快捷保存
  overlay.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      overlay.querySelector('[data-action="save"]').click()
    }
    if (e.key === 'Escape') overlay.remove()
  })
}

// ==================== 渠道 Tab ====================

async function renderChannels(container, state) {
  const bindings = state.detail?.bindings || []

  container.innerHTML = `
    <div class="agent-channels-section">
      <div class="agent-section-header">
        <div>
          <h3 class="agent-section-title">${t('agentDetail.channelsTitle')}</h3>
          <p class="agent-section-desc">${t('agentDetail.channelsDesc')}</p>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-add-binding">${t('agentDetail.manageChannels')}</button>
      </div>
      <div id="agent-bindings-list"></div>
    </div>
  `

  renderBindingsList(container, state, bindings)

  container.querySelector('#btn-add-binding')?.addEventListener('click', () => {
    openChannelsBindingPage(state.agentId)
  })
}

function renderBindingsList(container, state, bindings) {
  const list = container.querySelector('#agent-bindings-list')
  if (!bindings.length) {
    list.innerHTML = `<div class="agent-hint">${t('agentDetail.noBindings')}</div>`
    return
  }

  list.innerHTML = bindings.map((b, i) => {
    const channel = b.match?.channel || ''
    const label = CHANNEL_LABELS[channel] || channel
    const accountId = b.match?.accountId || ''
    const typeLabel = b.type === 'acp' ? 'ACP' : 'Route'
    return `
      <div class="agent-binding-card">
        <div class="agent-binding-info">
          <span class="agent-binding-channel">${esc(label)}</span>
          ${accountId ? `<span class="agent-binding-account">${esc(accountId)}</span>` : ''}
          <span class="badge" style="background:var(--info-muted);color:var(--info)">${typeLabel}</span>
        </div>
        <button class="btn btn-sm btn-danger" data-action="remove-binding" data-channel="${esc(channel)}" data-account="${esc(accountId)}" data-index="${i}">${t('agentDetail.removeBinding')}</button>
      </div>
    `
  }).join('')

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="remove-binding"]')
    if (!btn) return
    const channel = btn.dataset.channel
    const account = btn.dataset.account || null
    const binding = bindings[Number(btn.dataset.index)]
    const yes = await showConfirm({
      title: t('agentDetail.removeBindingTitle'),
      message: t('agentDetail.removeBindingConfirm', { channel: CHANNEL_LABELS[channel] || channel }),
      impact: [
        t('agentDetail.removeBindingImpactAgent'),
        t('agentDetail.removeBindingImpactChannel'),
      ],
      confirmText: t('agentDetail.removeBindingBtn'),
      cancelText: t('agentDetail.removeBindingCancel'),
    })
    if (!yes) return
    try {
      await api.deleteAgentBinding(state.agentId, channel, account, binding?.match || null)
      toast(t('agentDetail.bindingRemoved'), 'success')
      invalidate('get_agent_detail')
      state.detail = await api.getAgentDetail(state.agentId)
      renderBindingsList(container, state, state.detail.bindings || [])
    } catch (e) {
      toast(humanizeError(e, t('agentDetail.bindingFailed')), 'error')
    }
  })
}

// ── 页面离开清理（移除挂在 document.body 上的孤儿模态框） ──
let _openOverlays = []
function _trackOverlay(overlay) {
  _openOverlays.push(overlay)
  const observer = new MutationObserver(() => {
    if (!overlay.isConnected) _openOverlays = _openOverlays.filter(o => o !== overlay)
  })
  observer.observe(overlay, { childList: true })
}

export function cleanup() {
  _openOverlays.forEach(o => { try { o.remove() } catch (_) {} })
  _openOverlays = []
}
