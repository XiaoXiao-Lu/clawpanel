/**
 * Skills 页面
 * 本地扫描已安装 Skills + SkillHub SDK 技能商店
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { showConfirm } from '../components/modal.js'
import { t } from '../lib/i18n.js'
import { wsClient } from '../lib/ws-client.js'

let _loadSeq = 0
let _selectedAgentId = null // null = default (main)
let _storeIndex = null // featured SkillHub index
let _storeItems = []
let _selectedStoreSlug = null
let _installedNames = new Set() // installed skill keys

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function skillKey(value) {
  return String(value || '').trim().toLowerCase()
}

function storeItemName(item) {
  return item?.display_name || item?.displayName || item?.name || item?.slug || ''
}

function storeItemDesc(item) {
  return item?.description_zh || item?.summary || item?.description || ''
}

function storeItemCategory(item) {
  return item?.category || item?.categories?.[0] || ''
}

function isStoreItemInstalled(item) {
  return [item?.slug, item?.name, item?.display_name, item?.displayName]
    .some(v => _installedNames.has(skillKey(v)))
}

function formatCount(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  // 加载 Agent 列表
  let agents = []
  try {
    const list = await api.listAgents()
    if (Array.isArray(list)) agents = list
  } catch {}

  const agentOptions = agents.length > 1
    ? `<div class="skills-agent-selector" style="display:flex;align-items:center;gap:var(--space-xs);margin-bottom:var(--space-sm)">
        <label style="font-size:var(--font-size-sm);color:var(--text-secondary);white-space:nowrap">${t('skills.agentLabel')}</label>
        <select id="skills-agent-select" class="input" style="max-width:220px;font-size:var(--font-size-sm);padding:4px 8px">
          ${agents.map(a => {
            const id = a.id || 'main'
            const name = a.name || a.id || 'main'
            const isDefault = a.default ? ` (${t('skills.allAgents').split('(')[0].trim()})` : ''
            return `<option value="${esc(id)}"${id === (_selectedAgentId || 'main') ? ' selected' : ''}>${esc(name)}${isDefault}</option>`
          }).join('')}
        </select>
      </div>`
    : ''

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('skills.title')}</h1>
      <p class="page-desc">${t('skills.desc')}</p>
    </div>
    ${agentOptions}
    <div class="tab-bar" id="skills-main-tabs">
      <div class="tab active" data-main-tab="installed">${t('skills.tabInstalled')}</div>
      <div class="tab" data-main-tab="store">${t('skills.tabStore')}</div>
    </div>
    <div id="skills-tab-installed" class="config-section">
      <div class="stat-card loading-placeholder" style="height:96px"></div>
    </div>
    <div id="skills-tab-store" class="config-section" style="display:none">
      <div class="skills-store-header">
        <div>
          <div class="skills-store-title">${t('skills.storeTitle')}</div>
          <div class="skills-store-subtitle">${t('skills.storeSubtitle')}</div>
        </div>
        <div class="skills-store-header-actions">
          <input type="file" id="skill-zip-input" accept=".zip,application/zip" style="display:none">
          <button class="btn btn-secondary btn-sm" data-action="skill-install-zip">${t('skills.installZip')}</button>
          <a class="btn btn-secondary btn-sm" id="skill-store-browse" href="https://www.skillhub.cn/" target="_blank" rel="noopener">${t('skills.browseCn')}</a>
        </div>
      </div>
      <div class="skills-store-searchbar">
        <input class="input clawhub-search-input" id="skill-store-search" placeholder="${t('skills.searchPlaceholder')}" type="text">
        <button class="btn btn-primary btn-sm" data-action="store-search">${t('skills.search')}</button>
      </div>
      <div class="skills-store-filters">
        <button class="skills-chip active" data-action="store-query" data-query="">${t('skills.featured')}</button>
        <button class="skills-chip" data-action="store-query" data-query="github">GitHub</button>
        <button class="skills-chip" data-action="store-query" data-query="browser">Browser</button>
        <button class="skills-chip" data-action="store-query" data-query="search">Search</button>
        <button class="skills-chip" data-action="store-query" data-query="data">Data</button>
        <button class="skills-chip" data-action="store-query" data-query="social">Social</button>
      </div>
      <div class="skills-store-meta" id="skill-store-meta">${t('skills.storeLoading')}</div>
      <div class="skills-store-layout">
        <div id="store-results" class="clawhub-list skills-store-results">
          <div class="form-hint" style="padding:var(--space-xl);text-align:center">${t('skills.storeLoading')}</div>
        </div>
        <div id="store-preview" class="skills-store-preview">
          <div class="skills-preview-empty">${t('skills.previewEmpty')}</div>
        </div>
      </div>
      <div class="skills-store-footer">
        <span>${t('skills.storeSourceHint')}</span>
        <select class="input" id="skill-store-source">
          <option value="skillhubcn">${t('skills.sourceCn')}</option>
          <option value="cos">${t('skills.sourceMirror')}</option>
          <option value="official">${t('skills.sourceOfficial')}</option>
        </select>
      </div>
    </div>
  `
  bindEvents(page)
  loadSkills(page)

  // Agent 选择器变化时刷新
  const agentSelect = page.querySelector('#skills-agent-select')
  if (agentSelect) {
    agentSelect.addEventListener('change', () => {
      const val = agentSelect.value
      _selectedAgentId = (val === 'main') ? null : val
      _storeIndex = null // 清除商店缓存
      _installedNames = new Set()
      loadSkills(page)
    })
  }

  return page
}

async function loadSkills(page) {
  const el = page.querySelector('#skills-tab-installed')
  if (!el) return
  const seq = ++_loadSeq

  el.innerHTML = `<div class="skills-loading-panel">
    <div class="stat-card loading-placeholder" style="height:96px"></div>
    <div class="form-hint" style="margin-top:8px">${t('skills.loading')}</div>
  </div>`

  try {
    const data = await api.skillsList(_selectedAgentId)
    if (seq !== _loadSeq) return
    renderSkills(el, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    el.innerHTML = `<div class="skills-load-error">
      <div style="color:var(--error);margin-bottom:8px">${t('skills.loadFailed')}: ${esc(e?.message || e)}</div>
      <div class="form-hint" style="margin-bottom:10px">${t('skills.loadFailedHint')}</div>
      <button class="btn btn-secondary btn-sm" data-action="skill-retry">${t('skills.retry')}</button>
    </div>`
  }
}

function renderSkills(el, data) {
  const skills = data?.skills || []
  const cliAvailable = data?.cliAvailable !== false
  const source = data?.source || ''
  const cliDiag = data?.diagnostic?.cli || null
  const eligible = skills.filter(s => s.eligible && !s.disabled)
  const missing = skills.filter(s => !s.eligible && !s.disabled && !s.blockedByAllowlist)
  const disabled = skills.filter(s => s.disabled)
  const blocked = skills.filter(s => s.blockedByAllowlist && !s.disabled)

  const summary = t('skills.summaryDetail', { eligible: eligible.length, missing: missing.length, disabled: disabled.length })

  el.innerHTML = `
    <div class="clawhub-toolbar">
      <input class="input clawhub-search-input" id="skill-filter-input" placeholder="${t('skills.filterPlaceholder')}" type="text">
      <button class="btn btn-secondary btn-sm" data-action="skill-retry">${t('skills.refresh')}</button>
    </div>

    <div class="skills-summary" style="margin-bottom:var(--space-lg);color:var(--text-secondary);font-size:var(--font-size-sm)">
      ${t('skills.summary', { total: skills.length, detail: summary })}
    </div>

    ${eligible.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--success)">${t('skills.eligibleGroup')} (${eligible.length})</div>
      <div class="clawhub-list skills-scroll-area skills-trending-scroll" id="skills-eligible">
        ${eligible.map(s => renderSkillCard(s, 'eligible')).join('')}
      </div>
    </div>` : ''}

    ${missing.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--warning);display:flex;align-items:center;gap:var(--space-sm)">
        <span>${t('skills.missingGroup')} (${missing.length})</span>
        <button class="btn btn-secondary btn-sm" data-action="skill-ai-fix" style="font-size:var(--font-size-xs);padding:2px 8px">${t('skills.aiFixBtn')}</button>
      </div>
      <div class="clawhub-list skills-scroll-area skills-installed-scroll" id="skills-missing">
        ${missing.map(s => renderSkillCard(s, 'missing')).join('')}
      </div>
    </div>` : ''}

    ${disabled.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--text-tertiary)">${t('skills.disabledGroup')} (${disabled.length})</div>
      <div class="clawhub-list skills-scroll-area skills-search-scroll" id="skills-disabled">
        ${disabled.map(s => renderSkillCard(s, 'disabled')).join('')}
      </div>
    </div>` : ''}

    ${blocked.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--text-tertiary)">${t('skills.blockedGroup')} (${blocked.length})</div>
      <div class="clawhub-list">
        ${blocked.map(s => renderSkillCard(s, 'blocked')).join('')}
      </div>
    </div>` : ''}

    ${!skills.length ? `
    <div class="clawhub-panel">
      <div class="empty-state">
        <div class="empty-icon">🛠️</div>
        <div class="empty-title">${t('skills.noSkills')}</div>
        <div class="empty-desc">${t('skills.noSkillsHint')}</div>
        <div class="empty-cta"><button class="btn btn-primary" data-empty-cta="go-store">${t('skills.tabStore')}</button></div>
      </div>
    </div>` : ''}

    <div id="skill-detail-area"></div>
  `

  // 实时过滤
  const input = el.querySelector('#skill-filter-input')
  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase()
      el.querySelectorAll('.skill-card-item').forEach(card => {
        const name = (card.dataset.name || '').toLowerCase()
        const desc = (card.dataset.desc || '').toLowerCase()
        card.style.display = (!q || name.includes(q) || desc.includes(q)) ? '' : 'none'
      })
    })
  }
  // 空状态 CTA：切到「技能商店」主 Tab
  el.querySelector('[data-empty-cta="go-store"]')?.addEventListener('click', () => {
    const page = el.closest('.page')
    page?.querySelector('#skills-main-tabs .tab[data-main-tab="store"]')?.click()
  })
}

function renderSkillCard(skill, status) {
  const emoji = skill.emoji || '📦'
  const name = skill.name || ''
  const desc = skill.description || ''
  const source = skill.bundled ? t('skills.bundled') : (skill.source || t('skills.custom'))
  const missingBins = skill.missing?.bins || []
  const missingEnv = skill.missing?.env || []
  const missingConfig = skill.missing?.config || []
  const installOpts = skill.install || []

  let statusBadge = ''
  if (status === 'eligible') statusBadge = `<span class="clawhub-badge installed">${t('skills.eligible')}</span>`
  else if (status === 'missing') statusBadge = `<span class="clawhub-badge" style="background:rgba(245,158,11,0.14);color:#d97706">${t('skills.missingDeps')}</span>`
  else if (status === 'disabled') statusBadge = `<span class="clawhub-badge" style="background:rgba(107,114,128,0.14);color:#6b7280">${t('skills.disabled')}</span>`
  else if (status === 'blocked') statusBadge = `<span class="clawhub-badge" style="background:rgba(239,68,68,0.14);color:#ef4444">${t('skills.blocked')}</span>`

  let missingHtml = ''
  if (missingBins.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('skills.missingCmd')}: ${missingBins.map(b => `<code>${esc(b)}</code>`).join(', ')}</div>`
  if (missingEnv.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('skills.missingEnv')}: ${missingEnv.map(e => `<code>${esc(e)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('skills.missingEnvHint')}</span></div>`
  if (missingConfig.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('skills.missingConfig')}: ${missingConfig.map(c => `<code>${esc(c)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('skills.missingConfigHint')}</span></div>`

  let installHtml = ''
  if (status === 'missing') {
    if (installOpts.length) {
      installHtml = `<div style="margin-top:6px">${installOpts.map(opt =>
        `<button class="btn btn-primary btn-sm" style="margin-right:6px;margin-top:4px" data-action="skill-install-dep" data-kind="${esc(opt.kind)}" data-install='${esc(JSON.stringify(opt))}' data-skill-name="${esc(name)}">${esc(opt.label)}</button>`
      ).join('')}</div>`
    } else if (missingBins.length && !missingEnv.length && !missingConfig.length) {
      installHtml = `<div class="form-hint" style="margin-top:6px;color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('skills.noAutoInstall')}: ${missingBins.map(b => `<code>brew install ${esc(b)}</code> / <code>npm i -g ${esc(b)}</code>`).join(' / ')}</div>`
    }
  }

  return `
    <div class="clawhub-item skill-card-item" data-name="${esc(name)}" data-desc="${esc(desc)}">
      <div class="clawhub-item-main">
        <div class="clawhub-item-title">${emoji} ${esc(name)}</div>
        <div class="clawhub-item-meta">${esc(source)}${skill.homepage ? ` · <a href="${esc(skill.homepage)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(skill.homepage)}</a>` : ''}</div>
        <div class="clawhub-item-desc">${esc(desc)}</div>
        ${missingHtml}
        ${installHtml}
      </div>
      <div class="clawhub-item-actions">
        <button class="btn btn-secondary btn-sm" data-action="skill-info" data-name="${esc(name)}">${t('skills.detail')}</button>
        ${!skill.bundled ? `<button class="btn btn-sm" style="color:var(--error);border:1px solid var(--error);background:transparent;font-size:var(--font-size-xs)" data-action="skill-uninstall" data-name="${esc(name)}">${t('skills.uninstall')}</button>` : ''}
        ${statusBadge}
      </div>
    </div>
  `
}

async function handleInfo(page, name) {
  const detail = page.querySelector('#skill-detail-area')
  if (!detail) return
  detail.innerHTML = `<div class="form-hint" style="margin-top:var(--space-md)">${t('skills.loadingDetail')}</div>`
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  try {
    let skill = null
    // 优先 Gateway RPC（可获取 ClawHub 远程详情），回退 Tauri 本地
    if (wsClient.connected && wsClient.gatewayReady) {
      try { skill = await wsClient.skillsDetail(name) } catch {}
    }
    if (!skill) skill = await api.skillsInfo(name, _selectedAgentId)
    const s = skill || {}
    const reqs = s.requirements || {}
    const miss = s.missing || {}

    let reqsHtml = ''
    if (reqs.bins?.length) {
      reqsHtml += `<div style="margin-top:8px"><strong>${t('skills.reqBins')}:</strong> ${reqs.bins.map(b => {
        const ok = !(miss.bins || []).includes(b)
        return `<code style="color:var(--${ok ? 'success' : 'error'})">${ok ? '✓' : '✗'} ${esc(b)}</code>`
      }).join(' ')}</div>`
    }
    if (reqs.env?.length) {
      reqsHtml += `<div style="margin-top:4px"><strong>${t('skills.reqEnv')}:</strong> ${reqs.env.map(e => {
        const ok = !(miss.env || []).includes(e)
        return `<code style="color:var(--${ok ? 'success' : 'error'})">${ok ? '✓' : '✗'} ${esc(e)}</code>`
      }).join(' ')}</div>`
    }

    detail.innerHTML = `
      <div class="clawhub-detail-card">
        <div class="clawhub-detail-title">${esc(s.emoji || '📦')} ${esc(s.name || name)}</div>
        <div class="clawhub-detail-meta">
          ${t('skills.detailSource')}: ${esc(s.source || '')} · ${t('skills.detailPath')}: <code>${esc(s.filePath || '')}</code>
          ${s.homepage ? ` · <a href="${esc(s.homepage)}" target="_blank" rel="noopener">${esc(s.homepage)}</a>` : ''}
        </div>
        <div class="clawhub-detail-desc" style="margin-top:8px">${esc(s.description || '')}</div>
        ${reqsHtml}
        ${(s.install || []).length && !s.eligible ? `<div style="margin-top:8px"><strong>${t('skills.installOptions')}:</strong> ${s.install.map(i => `<span class="form-hint">→ ${esc(i.label)}</span>`).join(' ')}</div>` : ''}
      </div>
    `
  } catch (e) {
    detail.innerHTML = `<div style="color:var(--error);margin-top:var(--space-md)">${t('skills.detailLoadFailed')}: ${esc(e?.message || e)}</div>`
  }
}

async function handleInstallDep(page, btn) {
  const kind = btn.dataset.kind
  let spec
  try { spec = JSON.parse(btn.dataset.install) } catch { spec = {} }
  const skillName = btn.dataset.skillName || ''
  btn.disabled = true
  btn.textContent = t('skills.installing')
  try {
    await api.skillsInstallDep(kind, spec)
    toast(t('skills.depInstalled', { name: skillName }), 'success')
    await loadSkills(page)
  } catch (e) {
    toast(humanizeError(e, t('skills.installFailed')), 'error')
    btn.disabled = false
    btn.textContent = spec.label || t('skills.retry')
  }
}

async function loadStore(page) {
  const results = page.querySelector('#store-results')
  const meta = page.querySelector('#skill-store-meta')
  if (!results) return
  updateStoreSourceUi(page)
  results.innerHTML = `<div class="form-hint" style="padding:var(--space-xl);text-align:center">${t('skills.storeLoading')}</div>`
  if (meta) meta.textContent = t('skills.storeLoading')
  try {
    // 获取已安装列表用于标记
    try {
      const data = await api.skillsList(_selectedAgentId)
      _installedNames = new Set((data?.skills || []).flatMap(s => [s.name, s.slug]).map(skillKey).filter(Boolean))
    } catch { _installedNames = new Set() }
    _storeIndex = await api.skillhubIndex()
    _storeItems = Array.isArray(_storeIndex) ? _storeIndex : []
    _selectedStoreSlug = _storeItems[0]?.slug || null
    if (meta) meta.textContent = t('skills.featuredMeta', { count: _storeItems.length })
    renderStoreItems(results, _storeIndex)
    renderStorePreview(page)
  } catch (e) {
    results.innerHTML = `<div style="color:var(--error);padding:var(--space-lg);text-align:center">${t('skills.storeLoadFailed')}: ${esc(e?.message || e)}</div>`
    renderStorePreview(page, null)
  }
}

function updateStoreSourceUi(page) {
  const select = page.querySelector('#skill-store-source')
  const browse = page.querySelector('#skill-store-browse')
  if (!select || !browse) return
  const source = select.value || 'cos'
  if (source === 'official') {
    browse.href = 'https://www.skillhub.club/'
    browse.textContent = t('skills.browseOfficial')
  } else if (source === 'skillhubcn') {
    browse.href = 'https://www.skillhub.cn/'
    browse.textContent = t('skills.browseCn')
  } else {
    browse.href = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json'
    browse.textContent = t('skills.browseMirror')
  }
}

function renderStoreItems(el, items) {
  if (!items?.length) {
    el.innerHTML = `<div class="clawhub-empty" style="padding:var(--space-xl);text-align:center">${t('skills.noResults')}</div>`
    return
  }
  _storeItems = items
  if (!_selectedStoreSlug || !items.some(item => item.slug === _selectedStoreSlug)) {
    _selectedStoreSlug = items[0]?.slug || null
  }
  el.innerHTML = items.map(item => {
    const slug = item.slug || ''
    const name = storeItemName(item)
    const desc = storeItemDesc(item)
    const category = storeItemCategory(item)
    const installed = isStoreItemInstalled(item)
    const stats = [
      item.version ? `v${item.version}` : '',
      item.author || item.owner_name || '',
      formatCount(item.downloads || item.installs) ? `${formatCount(item.downloads || item.installs)} ${t('skills.downloads')}` : '',
      formatCount(item.stars) ? `${formatCount(item.stars)} ${t('skills.stars')}` : '',
    ].filter(Boolean).map(esc).join(' · ')
    const tags = [...(item.tags || []), category].filter(Boolean).slice(0, 4)
    return `
      <div class="clawhub-item store-item ${slug === _selectedStoreSlug ? 'active' : ''}" data-action="store-select" data-slug="${esc(slug)}" data-name="${esc(name)}" data-desc="${esc(desc)}">
        <div class="clawhub-item-main">
          <div class="clawhub-item-title">📦 ${esc(name)}</div>
          ${stats ? `<div class="clawhub-item-meta">${stats}</div>` : ''}
          <div class="clawhub-item-desc">${esc(desc)}</div>
          ${tags.length ? `<div class="skills-store-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="clawhub-item-actions">
          <button class="btn btn-secondary btn-sm" data-action="store-preview" data-slug="${esc(slug)}">${t('skills.preview')}</button>
          ${installed
            ? `<span class="clawhub-badge installed">${t('skills.installed')}</span>`
            : `<button class="btn btn-primary btn-sm" data-action="store-install" data-slug="${esc(slug)}">${t('skills.install')}</button>`
          }
        </div>
      </div>
    `
  }).join('')
}

function renderStorePreview(page, explicitItem) {
  const preview = page.querySelector('#store-preview')
  if (!preview) return
  const item = explicitItem || _storeItems.find(i => i.slug === _selectedStoreSlug)
  if (!item) {
    preview.innerHTML = `<div class="skills-preview-empty">${t('skills.previewEmpty')}</div>`
    return
  }
  const slug = item.slug || ''
  const name = storeItemName(item)
  const desc = storeItemDesc(item)
  const category = storeItemCategory(item)
  const installed = isStoreItemInstalled(item)
  const homepage = item.homepage || ''
  const labels = item.labels && typeof item.labels === 'object' ? Object.entries(item.labels) : []
  const tags = [...(item.tags || []), category].filter(Boolean)
  const stats = [
    item.version ? ['Version', item.version] : null,
    item.author || item.owner_name ? [t('skills.author'), item.author || item.owner_name] : null,
    formatCount(item.downloads || item.installs) ? [t('skills.downloads'), formatCount(item.downloads || item.installs)] : null,
    formatCount(item.stars) ? [t('skills.stars'), formatCount(item.stars)] : null,
  ].filter(Boolean)
  preview.innerHTML = `
    <div class="skills-preview-head">
      <div>
        <div class="skills-preview-title">📦 ${esc(name)}</div>
        <div class="skills-preview-slug">${esc(slug)}</div>
      </div>
      ${installed ? `<span class="clawhub-badge installed">${t('skills.installed')}</span>` : ''}
    </div>
    <div class="skills-preview-actions">
      ${installed
        ? `<button class="btn btn-secondary btn-sm" disabled>${t('skills.installed')}</button>`
        : `<button class="btn btn-primary btn-sm" data-action="store-install" data-slug="${esc(slug)}">${t('skills.install')}</button>`}
      ${homepage ? `<a class="btn btn-secondary btn-sm" href="${esc(homepage)}" target="_blank" rel="noopener">${t('skills.openHomepage')}</a>` : ''}
    </div>
    <div class="skills-preview-section">
      <div class="skills-preview-label">${t('skills.previewUse')}</div>
      <div class="skills-preview-desc">${esc(desc || t('skills.noDescription'))}</div>
    </div>
    ${stats.length ? `<div class="skills-preview-stats">${stats.map(([k, v]) => `<div><strong>${esc(v)}</strong><span>${esc(k)}</span></div>`).join('')}</div>` : ''}
    ${tags.length ? `<div class="skills-preview-section"><div class="skills-preview-label">${t('skills.tags')}</div><div class="skills-store-tags">${tags.slice(0, 10).map(tag => `<span>${esc(tag)}</span>`).join('')}</div></div>` : ''}
    ${labels.length ? `<div class="skills-preview-section"><div class="skills-preview-label">${t('skills.requirements')}</div><div class="skills-label-grid">${labels.slice(0, 8).map(([k, v]) => `<div><span>${esc(k)}</span><code>${esc(v)}</code></div>`).join('')}</div></div>` : ''}
  `
}

async function handleStoreSearch(page) {
  const input = page.querySelector('#skill-store-search')
  const results = page.querySelector('#store-results')
  const meta = page.querySelector('#skill-store-meta')
  if (!input || !results) return
  const q = input.value.trim()
  if (!q && _storeIndex) {
    _selectedStoreSlug = _storeIndex[0]?.slug || null
    if (meta) meta.textContent = t('skills.featuredMeta', { count: _storeIndex.length })
    renderStoreItems(results, _storeIndex)
    renderStorePreview(page)
    return
  }
  if (!q) return
  results.innerHTML = `<div class="form-hint" style="padding:var(--space-sm)">${t('skills.searching')}</div>`
  if (meta) meta.textContent = t('skills.searching')
  try {
    let items
    if (wsClient.connected && wsClient.gatewayReady) {
      try {
        const res = await wsClient.skillsSearch(q, 60)
        items = res?.results || []
      } catch {
        items = await api.skillhubSearch(q, 60)
      }
    } else {
      items = await api.skillhubSearch(q, 60)
    }
    _selectedStoreSlug = items?.[0]?.slug || null
    if (meta) meta.textContent = t('skills.searchMeta', { count: items?.length || 0, query: q })
    renderStoreItems(results, items)
    renderStorePreview(page)
  } catch (e) {
    results.innerHTML = `<div style="color:var(--error);padding:var(--space-sm)">${t('skills.searchFailed')}: ${esc(e?.message || e)}</div>`
    renderStorePreview(page, null)
  }
}

async function handleStoreInstall(page, btn) {
  const slug = btn.dataset.slug
  btn.disabled = true
  btn.textContent = t('skills.installing')
  try {
    await api.skillhubInstall(slug, _selectedAgentId)
    toast(t('skills.skillInstalled', { name: slug }), 'success')
    btn.textContent = t('skills.installed')
    btn.classList.remove('btn-primary')
    btn.classList.add('btn-secondary')
    _installedNames.add(skillKey(slug))
    const item = _storeItems.find(i => i.slug === slug)
    if (item) [item.name, item.display_name, item.displayName].forEach(v => { if (v) _installedNames.add(skillKey(v)) })
    const storeResults = page.querySelector('#store-results')
    if (storeResults) renderStoreItems(storeResults, _storeItems)
    renderStorePreview(page)
    loadSkills(page).catch(() => {})
  } catch (e) {
    toast(humanizeError(e, t('skills.installFailed')), 'error')
    btn.disabled = false
    btn.textContent = t('skills.install')
  }
}

async function handleInstallZip(page) {
  const input = page.querySelector('#skill-zip-input')
  if (!input) return
  input.value = ''
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (!/\.zip$/i.test(file.name)) {
      toast(t('skills.zipOnly'), 'warning')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      await api.skillsInstallZip(file.name, dataUrl, _selectedAgentId)
      const name = file.name.replace(/\.zip$/i, '')
      toast(t('skills.zipInstalled', { name }), 'success')
      _installedNames.add(skillKey(name))
      await loadSkills(page)
      const storeResults = page.querySelector('#store-results')
      if (storeResults && _storeIndex) renderStoreItems(storeResults, _storeIndex)
      renderStorePreview(page)
    } catch (e) {
      toast(humanizeError(e, t('skills.installFailed')), 'error')
    }
  }
  input.click()
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

async function handleSkillUninstall(page, btn) {
  const name = btn.dataset.name
  if (!name) return
  const ok = await showConfirm(t('skills.confirmUninstall', { name }))
  if (!ok) return
  btn.disabled = true
  btn.textContent = t('skills.uninstalling')
  try {
    await api.skillsUninstall(name, _selectedAgentId)
    toast(t('skills.uninstalled', { name }), 'success')
    await loadSkills(page)
  } catch (e) {
    toast(humanizeError(e, t('skills.uninstallFailed')), 'error')
    btn.disabled = false
    btn.textContent = t('skills.uninstall')
  }
}

function bindEvents(page) {
  // 主 Tab 切换（已安装 / 搜索安装）
  page.querySelectorAll('#skills-main-tabs .tab').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('#skills-main-tabs .tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const key = tab.dataset.mainTab
      page.querySelector('#skills-tab-installed').style.display = key === 'installed' ? '' : 'none'
      page.querySelector('#skills-tab-store').style.display = key === 'store' ? '' : 'none'
      // 切到商店 tab 时加载全量索引
      if (key === 'store') loadStore(page)
    }
  })

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    if (btn.dataset.action !== 'store-select') e.stopPropagation()
    switch (btn.dataset.action) {
      case 'skill-retry':
        await loadSkills(page)
        break
      case 'skill-info':
        await handleInfo(page, btn.dataset.name)
        break
      case 'skill-install-dep':
        await handleInstallDep(page, btn)
        break
      case 'store-search':
        page.querySelectorAll('.skills-chip').forEach(chip => chip.classList.remove('active'))
        await handleStoreSearch(page)
        break
      case 'store-query':
        page.querySelectorAll('.skills-chip').forEach(chip => chip.classList.toggle('active', chip === btn))
        page.querySelector('#skill-store-search').value = btn.dataset.query || ''
        await handleStoreSearch(page)
        break
      case 'store-select':
      case 'store-preview':
        _selectedStoreSlug = btn.dataset.slug
        renderStoreItems(page.querySelector('#store-results'), _storeItems)
        renderStorePreview(page)
        break
      case 'store-install':
        await handleStoreInstall(page, btn)
        break
      case 'skill-install-zip':
        await handleInstallZip(page)
        break
      case 'skill-uninstall':
        await handleSkillUninstall(page, btn)
        break
      case 'skill-ai-fix':
        window.location.hash = '#/assistant'
        setTimeout(() => {
          const skillBtn = document.querySelector('.ast-skill-card[data-skill="skills-manager"]')
          if (skillBtn) skillBtn.click()
        }, 500)
        break
    }
  })

  page.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.target?.id === 'skill-store-search') {
      e.preventDefault()
      page.querySelectorAll('.skills-chip').forEach(chip => chip.classList.remove('active'))
      await handleStoreSearch(page)
    }
  })

  page.addEventListener('change', (e) => {
    if (e.target?.id === 'skill-store-source') {
      updateStoreSourceUi(page)
    }
  })
}
