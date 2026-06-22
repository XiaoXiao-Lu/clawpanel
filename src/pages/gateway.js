/**
 * Gateway 配置页面 — 小白友好版
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { tryShowEngagement } from '../components/engagement.js'
import { t } from '../lib/i18n.js'
import { validateField } from '../lib/config-schema.js'
import { termHelpHtml, attachTermTooltips } from '../lib/term-tooltip.js'

// 兼容新版 SecretRef：token 可能是 string 或 { $env: "VAR" } / { $ref: "x/y" }
function _tokenDisplayStr(token) {
  if (!token) return ''
  if (typeof token === 'string') return token
  if (typeof token === 'object') {
    if (token.$env) return `\$env:${token.$env}`
    if (token.$ref) return `\$ref:${token.$ref}`
    return JSON.stringify(token)
  }
  return String(token)
}
function _isSecretRef(token) {
  return token && typeof token === 'object' && ('$env' in token || '$ref' in token)
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('gateway.title')}</h1>
      <p class="page-desc">${t('gateway.desc')}</p>
    </div>
    <div id="gateway-config">
      <div class="config-section"><div class="stat-card loading-placeholder" style="height:80px"></div></div>
      <div class="config-section"><div class="stat-card loading-placeholder" style="height:80px"></div></div>
      <div class="config-section"><div class="stat-card loading-placeholder" style="height:80px"></div></div>
    </div>
    <div class="gw-save-bar">
      <button class="btn btn-primary" id="btn-save-gw">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
        ${t('gateway.saveApply')}
      </button>
      <span class="gw-save-hint">${t('gateway.saveHint')}</span>
    </div>
  `

  const state = { config: null, _origToken: null }
  // 非阻塞：先返回 DOM，后台加载数据
  loadConfig(page, state)
  page.querySelector('#btn-save-gw').onclick = async () => {
    const btn = page.querySelector('#btn-save-gw')
    btn.disabled = true
    btn.classList.add('btn-loading')
    btn.textContent = t('gateway.saving')
    try {
      await saveConfig(page, state)
    } finally {
      btn.disabled = false
      btn.classList.remove('btn-loading')
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg> ${t('gateway.saveApply')}`
    }
  }
  return page
}

async function loadConfig(page, state) {
  const el = page.querySelector('#gateway-config')
  try {
    state.config = await api.readOpenclawConfig()
    state._origToken = state.config?.gateway?.auth?.token ?? null
    renderConfig(page, state)
  } catch (e) {
    el.innerHTML = '<div style="color:var(--error);padding:20px">' + t('gateway.loadFailed') + ': ' + e + '</div>'
    toast(humanizeError(e, t('gateway.loadFailed')), 'error')
  }
}

function renderConfig(page, state) {
  const el = page.querySelector('#gateway-config')
  const gw = state.config?.gateway || {}
  const session = state.config?.session || {}
  const dmScope = session.dmScope || 'main'
  const identityLinks = (session.identityLinks && typeof session.identityLinks === 'object' && !Array.isArray(session.identityLinks)) ? session.identityLinks : {}
  state._identityLinks = identityLinks

  // 端口 + 谁能访问
  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
        ${t('gateway.portTitle')}
      </div>
      <div class="form-group">
        <label class="form-label">${t('gateway.portLabel')}</label>
        <input class="form-input" id="gw-port" type="number" value="${gw.port || 18789}" min="1024" max="65535" style="max-width:200px">
        <div class="form-hint">${t('gateway.portHint')}</div>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        ${t('gateway.accessTitle')}
      </div>
      <div class="gw-option-cards">
        <label class="gw-option-card ${(gw.bind === 'lan' || gw.bind === 'all') ? '' : 'selected'}" data-bind="loopback">
          <input type="radio" name="gw-bind" value="loopback" ${(gw.bind === 'lan' || gw.bind === 'all') ? '' : 'checked'} hidden>
          <div class="gw-option-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="gw-option-text">
            <div class="gw-option-title">${t('gateway.localOnly')}</div>
            <div class="gw-option-desc">${t('gateway.localOnlyDesc')}</div>
          </div>
        </label>
        <label class="gw-option-card ${(gw.bind === 'lan' || gw.bind === 'all') ? 'selected' : ''}" data-bind="lan">
          <input type="radio" name="gw-bind" value="lan" ${(gw.bind === 'lan' || gw.bind === 'all') ? 'checked' : ''} hidden>
          <div class="gw-option-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="6" width="7" height="10" rx="1"/><rect x="9" y="3" width="6" height="14" rx="1"/><rect x="16" y="6" width="7" height="10" rx="1"/><line x1="8" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="16" y2="12"/></svg>
          </div>
          <div class="gw-option-text">
            <div class="gw-option-title">${t('gateway.lanShare')}</div>
            <div class="gw-option-desc">${t('gateway.lanShareDesc')}</div>
          </div>
        </label>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        ${t('gateway.authTitle')}
      </div>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">${t('gateway.authMode')}</label>
        <div class="gw-option-cards">
          <label class="gw-option-card ${gw.auth?.mode === 'password' ? '' : 'selected'}" data-auth="token">
            <input type="radio" name="gw-auth-mode" value="token" ${gw.auth?.mode === 'password' ? '' : 'checked'} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('gateway.authToken')}</div>
              <div class="gw-option-desc">${t('gateway.authTokenDesc')}</div>
            </div>
          </label>
          <label class="gw-option-card ${gw.auth?.mode === 'password' ? 'selected' : ''}" data-auth="password">
            <input type="radio" name="gw-auth-mode" value="password" ${gw.auth?.mode === 'password' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('gateway.authPassword')}</div>
              <div class="gw-option-desc">${t('gateway.authPasswordDesc')}</div>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group" id="gw-auth-token-group" style="${gw.auth?.mode === 'password' ? 'display:none' : ''}">
        <label class="form-label">${t('gateway.tokenLabel')}${termHelpHtml('apikey')}</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="gw-token" type="password" value="${_tokenDisplayStr(gw.auth?.token || gw.authToken)}" placeholder="${t('gateway.tokenPlaceholder')}" style="flex:1" ${_isSecretRef(gw.auth?.token) ? 'readonly' : ''}>
          <button class="btn btn-sm btn-secondary" id="btn-toggle-token">${t('gateway.show')}</button>
        </div>
        <div class="form-hint">${_isSecretRef(gw.auth?.token) ? t('gateway.tokenHintRef') : t('gateway.tokenHintNormal')}</div>
      </div>
      <div class="form-group" id="gw-auth-password-group" style="${gw.auth?.mode === 'password' ? '' : 'display:none'}">
        <label class="form-label">${t('gateway.passwordLabel')}</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="gw-password" type="password" value="${gw.auth?.password || ''}" placeholder="${t('gateway.passwordPlaceholder')}" style="flex:1">
          <button class="btn btn-sm btn-secondary" id="btn-toggle-password">${t('gateway.show')}</button>
        </div>
        <div class="form-hint">${t('gateway.passwordHint')}</div>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        ${t('gateway.toolsTitle')}
      </div>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">${t('gateway.toolsPermission')}</label>
        <div class="gw-option-cards">
          <label class="gw-option-card ${(gw.tools?.profile || 'full') === 'full' ? 'selected' : ''}" data-tools-profile="full">
            <input type="radio" name="gw-tools-profile" value="full" ${(gw.tools?.profile || 'full') === 'full' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('gateway.toolsFull')}</div>
              <div class="gw-option-desc">${t('gateway.toolsFullDesc')}</div>
            </div>
          </label>
          <label class="gw-option-card ${gw.tools?.profile === 'limited' ? 'selected' : ''}" data-tools-profile="limited">
            <input type="radio" name="gw-tools-profile" value="limited" ${gw.tools?.profile === 'limited' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('gateway.toolsLimited')}</div>
              <div class="gw-option-desc">${t('gateway.toolsLimitedDesc')}</div>
            </div>
          </label>
          <label class="gw-option-card ${gw.tools?.profile === 'none' ? 'selected' : ''}" data-tools-profile="none">
            <input type="radio" name="gw-tools-profile" value="none" ${gw.tools?.profile === 'none' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('gateway.toolsNone')}</div>
              <div class="gw-option-desc">${t('gateway.toolsNoneDesc')}</div>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('gateway.sessionsLabel')}</label>
        <select class="form-input" id="gw-sessions-visibility" style="width:auto;min-width:180px">
          <option value="all" ${(gw.tools?.sessions?.visibility || 'all') === 'all' ? 'selected' : ''}>${t('gateway.sessionsAll')}</option>
          <option value="own" ${gw.tools?.sessions?.visibility === 'own' ? 'selected' : ''}>${t('gateway.sessionsOwn')}</option>
          <option value="none" ${gw.tools?.sessions?.visibility === 'none' ? 'selected' : ''}>${t('gateway.sessionsNone')}</option>
        </select>
        <div class="form-hint">${t('gateway.sessionsHint')}</div>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        ${t('gateway.sessionTitle')}
      </div>
      <p class="config-section-desc">${t('gateway.sessionDesc')}</p>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">${t('gateway.dmScopeLabel')}</label>
        <select class="form-input" id="gw-dm-scope" style="width:auto;min-width:240px">
          <option value="main" ${dmScope === 'main' ? 'selected' : ''}>${t('gateway.dmScopeMain')} — ${t('gateway.dmScopeMainDesc')}</option>
          <option value="per-peer" ${dmScope === 'per-peer' ? 'selected' : ''}>${t('gateway.dmScopePerPeer')} — ${t('gateway.dmScopePerPeerDesc')}</option>
          <option value="per-channel-peer" ${dmScope === 'per-channel-peer' ? 'selected' : ''}>${t('gateway.dmScopePerChannelPeer')} — ${t('gateway.dmScopePerChannelPeerDesc')}</option>
          <option value="per-account-channel-peer" ${dmScope === 'per-account-channel-peer' ? 'selected' : ''}>${t('gateway.dmScopePerAccountChannelPeer')} — ${t('gateway.dmScopePerAccountChannelPeerDesc')}</option>
        </select>
        <div class="form-hint">${t('gateway.dmScopeHint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('gateway.identityLinksTitle')}</label>
        <div class="form-hint" style="margin-bottom:var(--space-sm)">${t('gateway.identityLinksDesc')}</div>
        <div id="gw-identity-links"></div>
        <button class="btn btn-sm btn-secondary" id="btn-add-identity" style="margin-top:var(--space-xs)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('gateway.addIdentity')}
        </button>
      </div>
      <div class="gw-save-bar" style="margin-top:var(--space-md)">
        <button class="btn btn-primary" id="btn-save-gw-inline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
          ${t('gateway.saveApply')}
        </button>
        <span class="gw-save-hint">${t('gateway.saveHint')}</span>
      </div>
    </div>

    <div class="gw-advanced-toggle" id="gw-advanced-toggle" role="button" tabindex="0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
      ${t('gateway.advancedToggle')}
    </div>
    <div class="gw-advanced-panel" id="gw-advanced-panel" style="display:none">
      <div class="config-section">
        <div class="config-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          ${t('gateway.tailscaleTitle')}
        </div>
        <div class="form-group">
          <label class="form-label">${t('gateway.tailscaleLabel')}</label>
          <input class="form-input" id="gw-tailscale" value="${gw.tailscale?.address || ''}" placeholder="${t('gateway.tailscalePlaceholder')}">
          <div class="form-hint">${t('gateway.tailscaleHint')}</div>
        </div>
      </div>
    </div>
  `

  bindConfigEvents(el, state)
  attachTermTooltips(el)
}

function bindConfigEvents(el, state) {
  // 密码显示/隐藏
  function bindToggle(btnId, inputId) {
    const btn = el.querySelector('#' + btnId)
    if (!btn) return
    btn.onclick = () => {
      const input = el.querySelector('#' + inputId)
      if (input.type === 'password') {
        input.type = 'text'
        btn.textContent = t('gateway.hide')
      } else {
        input.type = 'password'
        btn.textContent = t('gateway.show')
      }
    }
  }
  bindToggle('btn-toggle-token', 'gw-token')
  bindToggle('btn-toggle-password', 'gw-password')

  // 选项卡片点击高亮
  el.querySelectorAll('.gw-option-cards').forEach(group => {
    group.querySelectorAll('.gw-option-card').forEach(card => {
      card.addEventListener('click', () => {
        group.querySelectorAll('.gw-option-card').forEach(c => c.classList.remove('selected'))
        card.classList.add('selected')
      })
    })
  })

  // 认证模式切换：显示/隐藏对应输入框
  el.querySelectorAll('input[name="gw-auth-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = radio.value
      const tokenGroup = el.querySelector('#gw-auth-token-group')
      const passwordGroup = el.querySelector('#gw-auth-password-group')
      if (tokenGroup) tokenGroup.style.display = mode === 'token' ? '' : 'none'
      if (passwordGroup) passwordGroup.style.display = mode === 'password' ? '' : 'none'
    })
  })

  // 高级选项折叠
  const toggleAdvanced = () => {
    const panel = el.querySelector('#gw-advanced-panel')
    const toggle = el.querySelector('#gw-advanced-toggle')
    const visible = panel.style.display !== 'none'
    panel.style.display = visible ? 'none' : 'block'
    toggle.classList.toggle('open', !visible)
  }
  el.querySelector('#gw-advanced-toggle').onclick = toggleAdvanced
  el.querySelector('#gw-advanced-toggle').onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAdvanced() }
  }

  // 内联保存按钮：点击触发外层 #btn-save-gw
  const inlineSaveBtn = el.querySelector('#btn-save-gw-inline')
  if (inlineSaveBtn) {
    inlineSaveBtn.addEventListener('click', () => {
      const outerBtn = document.querySelector('#btn-save-gw')
      if (outerBtn) outerBtn.click()
    })
  }

  // identityLinks 编辑器 — 从已配置渠道读取选项
  const linksContainer = el.querySelector('#gw-identity-links')
  const addIdentityBtn = el.querySelector('#btn-add-identity')
  const configuredChannels = state.config?.channels ? Object.keys(state.config.channels) : []

  // 渠道获取用户ID的提示
  const channelIdHints = {
    telegram: 'Telegram: 在 @userinfobot 中发送任意消息即可获取数字 ID',
    discord: 'Discord: 右键用户头像 → 复制用户 ID（需开启开发者模式）',
    feishu: '飞书: 在飞书开放平台 → 用户管理 → 查看用户的 open_id',
    'openclaw-weixin': '微信: 发送消息后查看 Gateway 日志中的 fromUser 字段',
    qqbot: 'QQ Bot: 在 QQ 开放平台 → 应用管理 → 查看 user_openid',
    whatsapp: 'WhatsApp: 发送消息后查看日志中的 phone 数字',
    wecom: '企业微信: 在通讯录 → 成员详情中复制 UserId',
    slack: 'Slack: 右键头像 → Copy member ID',
    matrix: 'Matrix: 点击头像 → 复制 @username:domain 格式',
  }

  // 解析 "telegram:123456" 为 {channel, userId}
  function parsePeerId(raw) {
    if (!raw || !raw.includes(':')) return { channel: '', userId: String(raw || '') }
    const colonIdx = raw.indexOf(':')
    return {
      channel: raw.substring(0, colonIdx),
      userId: raw.substring(colonIdx + 1),
    }
  }

  function renderIdentityLinks() {
    const data = state._identityLinks || {}
    const keys = Object.keys(data)
    if (keys.length === 0) {
      linksContainer.innerHTML = `
        <div class="gw-idlinks-empty">${t('gateway.identityLinksEmpty')}</div>
        ${configuredChannels.length > 0 ? `<div class="gw-idlinks-hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          ${t('gateway.identityLinksHint')}
        </div>` : ''}
      `
      return
    }
    linksContainer.innerHTML = keys.map((name, idx) => {
      const peers = Array.isArray(data[name]) ? data[name] : []
      return `
        <div class="gw-idlink-entry" data-idx="${idx}">
          <div class="gw-idlink-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="flex-shrink:0;color:var(--brand-primary)"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <input class="form-input gw-idlink-name" type="text" value="${escapeAttr(name)}" placeholder="${t('gateway.identityNamePlaceholder')}" style="flex:1;min-width:120px;font-weight:500">
            <button class="btn btn-sm btn-danger gw-idlink-remove" title="${t('gateway.removeIdentity')}" aria-label="${t('gateway.removeIdentity')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
          <div class="gw-idlink-peers">
            ${peers.map((p, pi) => {
              const parsed = parsePeerId(p)
              const hintForChannel = channelIdHints[parsed.channel] || ''
              return `
              <div class="gw-idlink-peer" data-pi="${pi}">
                <div class="gw-idlink-peer-row">
                  <select class="form-input gw-idlink-channel-select" aria-label="选择渠道">
                    <option value="">— ${t('gateway.selectChannel')} —</option>
                    ${configuredChannels.map(ch => `<option value="${ch}" ${parsed.channel === ch ? 'selected' : ''}>${ch}</option>`).join('')}
                    ${!configuredChannels.includes(parsed.channel) && parsed.channel ? `<option value="${parsed.channel}" selected>✏️ ${parsed.channel} (未配置)</option>` : ''}
                  </select>
                  <input class="form-input gw-idlink-userid-input" type="text" value="${escapeAttr(parsed.userId)}" placeholder="用户 ID" style="flex:1;min-width:100px;font-family:var(--font-mono,monospace)">
                  <button class="btn btn-sm btn-secondary gw-idlink-peer-remove" title="${t('gateway.removeIdentity')}" aria-label="${t('gateway.removeIdentity')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                  </button>
                </div>
                <div class="gw-idlink-peer-hint" style="${hintForChannel ? '' : 'display:none'}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span class="gw-idlink-peer-hint-text">${hintForChannel}</span>
                </div>
              </div>
            `}).join('')}
            <button class="btn btn-sm btn-secondary gw-idlink-peer-add">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              ${t('gateway.addPeerId')}
            </button>
          </div>
        </div>
      `
    }).join('')

    // 绑定事件
    linksContainer.querySelectorAll('.gw-idlink-entry').forEach((entry, idx) => {
      const nameInput = entry.querySelector('.gw-idlink-name')
      const removeBtn = entry.querySelector('.gw-idlink-remove')
      const peerAddBtn = entry.querySelector('.gw-idlink-peer-add')

      // 名称变更
      nameInput.addEventListener('change', () => {
        const oldName = Object.keys(state._identityLinks)[idx]
        const newName = nameInput.value.trim()
        if (!newName || newName === oldName) return
        if (state._identityLinks[newName]) {
          toast(t('gateway.identityNamePlaceholder'), 'warning')
          nameInput.value = oldName
          return
        }
        const peers = state._identityLinks[oldName]
        delete state._identityLinks[oldName]
        state._identityLinks[newName] = peers
      })

      // 删除身份
      removeBtn.addEventListener('click', () => {
        const name = Object.keys(state._identityLinks)[idx]
        if (name) delete state._identityLinks[name]
        renderIdentityLinks()
      })

      // 添加 peer ID
      if (peerAddBtn) {
        peerAddBtn.addEventListener('click', () => {
          const name = Object.keys(state._identityLinks)[idx]
          if (!name) return
          if (!Array.isArray(state._identityLinks[name])) state._identityLinks[name] = []
          state._identityLinks[name].push('')
          renderIdentityLinks()
        })
      }

      // peer ID 输入和删除
      entry.querySelectorAll('.gw-idlink-peer').forEach((peerEl, pi) => {
        const channelSelect = peerEl.querySelector('.gw-idlink-channel-select')
        const userInput = peerEl.querySelector('.gw-idlink-userid-input')
        const hintEl = peerEl.querySelector('.gw-idlink-peer-hint')
        const hintTextEl = peerEl.querySelector('.gw-idlink-peer-hint-text')
        const peerRemove = peerEl.querySelector('.gw-idlink-peer-remove')

        // 渠道切换时更新提示
        function updateHint() {
          const ch = channelSelect?.value || ''
          const hintText = channelIdHints[ch] || ''
          if (hintTextEl) hintTextEl.textContent = hintText
          if (hintEl) hintEl.style.display = hintText ? '' : 'none'
        }
        if (channelSelect) {
          channelSelect.addEventListener('change', () => { updateHint(); syncPeerValue() })
          updateHint()
        }

        // 同步值到 state：组合为 "channel:userId"
        function syncPeerValue() {
          const ch = channelSelect?.value || ''
          const uid = userInput?.value.trim() || ''
          const name = Object.keys(state._identityLinks)[idx]
          if (!name || !Array.isArray(state._identityLinks[name])) return
          if (ch && uid) {
            state._identityLinks[name][pi] = `${ch}:${uid}`
          } else if (uid) {
            // 只有 userId 没有 channel，保持原格式
            state._identityLinks[name][pi] = uid
          } else {
            state._identityLinks[name][pi] = ''
          }
        }

        if (userInput) {
          userInput.addEventListener('change', syncPeerValue)
          userInput.addEventListener('input', syncPeerValue)
        }

        peerRemove.addEventListener('click', () => {
          const name = Object.keys(state._identityLinks)[idx]
          if (name && Array.isArray(state._identityLinks[name])) {
            state._identityLinks[name].splice(pi, 1)
            renderIdentityLinks()
          }
        })
      })
    })
  }

  // 初始渲染
  renderIdentityLinks()

  // 添加身份按钮
  if (addIdentityBtn) {
    addIdentityBtn.addEventListener('click', () => {
      // 自动生成唯一名
      let baseName = 'identity'
      let n = 1
      while (state._identityLinks[baseName]) {
        baseName = `identity${++n}`
      }
      state._identityLinks[baseName] = []
      renderIdentityLinks()
      // 聚焦到最后一个名称输入框
      const inputs = linksContainer.querySelectorAll('.gw-idlink-name')
      if (inputs.length) inputs[inputs.length - 1].focus()
    })
  }
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function saveConfig(page, state) {
  const port = parseInt(page.querySelector('#gw-port')?.value) || 18789

  // P1-6: 用内核 config.schema.lookup 即时校验 port（无 schema 时降级放行）
  const portCheck = await validateField('gateway.port', port)
  if (!portCheck.ok) {
    toast(portCheck.message, 'error')
    page.querySelector('#gw-port')?.focus()
    return
  }

  const bindRadio = page.querySelector('input[name="gw-bind"]:checked')
  const bind = bindRadio?.value || 'loopback'
  const mode = 'local'
  const authModeRadio = page.querySelector('input[name="gw-auth-mode"]:checked')
  const authMode = authModeRadio?.value || 'token'
  const authToken = page.querySelector('#gw-token')?.value || ''
  const authPassword = page.querySelector('#gw-password')?.value || ''
  const tailscaleAddr = page.querySelector('#gw-tailscale')?.value || ''

  // 兼容 SecretRef：如果用户没改 token 显示值，保留原始对象
  let resolvedToken = authToken
  if (_isSecretRef(state._origToken) && authToken === _tokenDisplayStr(state._origToken)) {
    resolvedToken = state._origToken
  }
  const auth = authMode === 'password'
    ? { mode: 'password', password: authPassword }
    : resolvedToken ? { mode: 'token', token: resolvedToken } : {}

  const toolsProfile = page.querySelector('input[name="gw-tools-profile"]:checked')?.value || 'full'
  const sessionsVisibility = page.querySelector('#gw-sessions-visibility')?.value || 'all'

  state.config.tools = {
    ...(state.config.tools || {}),
    profile: toolsProfile,
    sessions: { ...(state.config.tools?.sessions || {}), visibility: sessionsVisibility },
  }

  state.config.gateway = {
    ...state.config.gateway,
    port, bind, mode,
    auth,
    tailscale: tailscaleAddr.trim() ? { address: tailscaleAddr.trim() } : undefined,
  }

  // session 配置写回
  const dmScopeVal = page.querySelector('#gw-dm-scope')?.value || 'main'
  // 清理空身份名和空 peerId，只保留有效数据
  const cleanLinks = {}
  const rawLinks = state._identityLinks || {}
  for (const [name, peers] of Object.entries(rawLinks)) {
    if (!name.trim()) continue
    const cleanPeers = (Array.isArray(peers) ? peers : []).map(p => String(p).trim()).filter(p => p)
    if (cleanPeers.length > 0) {
      cleanLinks[name.trim()] = cleanPeers
    }
  }
  state.config.session = {
    ...(state.config.session || {}),
    dmScope: dmScopeVal,
    identityLinks: cleanLinks,
  }

  try {
    await api.writeOpenclawConfig(state.config)
    toast(t('gateway.configSaved'), 'info')
    try {
      await api.reloadGateway()
      toast(t('gateway.reloaded'), 'success')
      setTimeout(tryShowEngagement, 3000)
    } catch (e) {
      toast(humanizeError(e, t('gateway.savedButReloadFailed')), 'warning')
    }
  } catch (e) {
    toast(humanizeError(e, t('gateway.saveFailed')), 'error')
  }
}

export function cleanup() {}
