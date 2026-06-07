/**
 * Skills 页面
 * 本地扫描已安装 Skills + SkillHub SDK 技能商店
 * 现代化 UI：Hero 统计、Pill 标签、骨架屏、状态色卡片
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { showConfirm, showContentModal } from '../components/modal.js'
import { t } from '../lib/i18n.js'
import { wsClient } from '../lib/ws-client.js'

let _loadSeq = 0
let _selectedAgentId = null
let _storeIndex = null
let _storeItems = []
let _installedNames = new Set()
let _installedItems = new Map()
let _storeIndexPromise = null
let _hoverPreviewTimer = null
let _hoverPreviewEl = null
let _hoverPreviewCard = null

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

const EXACT_BRAND_ICON_HOSTS = [
  [/(^|[\s_-])x($|[\s_-])|twitter|tweet/i, 'https://x.com/'],
  [/(^|[\s_-])gog($|[\s_-])/i, 'https://www.gog.com/'],
]

const BRAND_ICON_HOSTS = [
  [/1password|op\s*cli/i, 'https://1password.com/'],
  [/github|git\b|gh\b/i, 'https://github.com/'],
  [/xiaohongshu|rednote|小红书/i, 'https://www.xiaohongshu.com/'],
  [/\btwitter\b|tweet/i, 'https://x.com/'],
  [/reddit/i, 'https://www.reddit.com/'],
  [/youtube|yt-dlp/i, 'https://www.youtube.com/'],
  [/bilibili|b站/i, 'https://www.bilibili.com/'],
  [/notion/i, 'https://www.notion.so/'],
  [/slack/i, 'https://slack.com/'],
  [/discord/i, 'https://discord.com/'],
  [/linear/i, 'https://linear.app/'],
  [/jira|atlassian/i, 'https://www.atlassian.com/'],
  [/figma/i, 'https://www.figma.com/'],
  [/todoist/i, 'https://todoist.com/'],
  [/gmail|google|drive|calendar/i, 'https://www.google.com/'],
  [/apple|notes|reminders/i, 'https://www.apple.com/'],
  [/chrome|browser|playwright/i, 'https://www.chromium.org/'],
  [/openai|chatgpt/i, 'https://openai.com/'],
  [/claude|anthropic/i, 'https://www.anthropic.com/'],
  [/perplexity/i, 'https://www.perplexity.ai/'],
  [/tavily/i, 'https://tavily.com/'],
  [/obsidian/i, 'https://obsidian.md/'],
  [/whisper/i, 'https://openai.com/'],
  [/gog/i, 'https://www.gog.com/'],
  [/google\s*workspace|workspace/i, 'https://workspace.google.com/'],
]

const BRAND_ICON_ASSETS = [
  [/github|git\b|gh\b/i, 'github'],
  [/openai|chatgpt|whisper/i, 'openai'],
  [/gmail|google|drive|calendar|google\s*workspace|workspace/i, 'google'],
  [/xiaohongshu|rednote|小红书/i, 'xiaohongshu'],
  [/\btwitter\b|tweet|(^|[\s_-])x($|[\s_-])/i, 'x'],
  [/notion/i, 'notion'],
  [/slack/i, 'slack'],
  [/youtube|yt-dlp/i, 'youtube'],
  [/tavily|search/i, 'search'],
  [/browser|playwright|chrome|web|网页/i, 'browser'],
  [/data|csv|sheet|excel|sql|database/i, 'data'],
  [/social|reddit|discord/i, 'social'],
]

const MARKETPLACE_ICON_HOSTS = new Set([
  'clawhub.ai',
  'skillhub.ai',
  'skillhub.cn',
  'skillhub.club',
])

const FALLBACK_SKILL_ICONS = [
  [/1password|secret|token|password|credential/i, '🔐'],
  [/browser|playwright|chrome|web|网页/i, '🌐'],
  [/agent|assistant|bot|助手/i, '✦'],
  [/github|git\b|repo|pull request/i, '⌘'],
  [/search|tavily|perplexity|google/i, '🔎'],
  [/note|memory|reminder|todo/i, '✎'],
  [/data|csv|sheet|excel|sql|database/i, '▦'],
  [/image|photo|figma|design/i, '◈'],
  [/video|youtube|bilibili|media/i, '▶'],
  [/social|xiao|rednote|reddit|twitter|discord|slack/i, '◌'],
  [/automation|workflow|cron|schedule/i, '⚙'],
  [/cli|shell|terminal|command|tool/i, '⌁'],
  [/email|mail|gmail/i, '✉'],
  [/calendar|event|schedule/i, '◷'],
  [/file|pdf|doc|markdown|zip/i, '▤'],
]

const BRAND_ICON_SVG = {
  github: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#fff"/><path fill="#181717" d="M20 6.5c-7.46 0-13.5 6.04-13.5 13.5 0 5.96 3.86 11.02 9.22 12.8.67.12.92-.29.92-.65v-2.28c-3.75.82-4.54-1.8-4.54-1.8-.61-1.56-1.5-1.98-1.5-1.98-1.23-.84.09-.82.09-.82 1.35.1 2.07 1.4 2.07 1.4 1.2 2.06 3.15 1.47 3.92 1.12.12-.88.47-1.47.86-1.8-3-.34-6.14-1.5-6.14-6.67 0-1.47.53-2.68 1.39-3.62-.14-.34-.6-1.71.13-3.57 0 0 1.13-.36 3.71 1.38a12.8 12.8 0 0 1 6.75 0c2.57-1.74 3.7-1.38 3.7-1.38.74 1.86.28 3.23.14 3.57.87.94 1.39 2.15 1.39 3.62 0 5.18-3.15 6.32-6.15 6.66.48.42.91 1.24.91 2.5v3.7c0 .36.24.78.92.65A13.5 13.5 0 0 0 33.5 20c0-7.46-6.04-13.5-13.5-13.5Z"/></svg>`,
  openai: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#10a37f"/><text x="20" y="25" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="13" font-weight="800" fill="#fff">AI</text></svg>`,
  google: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#fff"/><path fill="#4285f4" d="M31.6 20.3c0-.9-.1-1.7-.2-2.5H20v4.7h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.6-5.2 3.6-8.9Z"/><path fill="#34a853" d="M20 32c3.2 0 6-1.1 8-2.9l-3.9-3a7.3 7.3 0 0 1-10.9-3.8h-4v3.1A12 12 0 0 0 20 32Z"/><path fill="#fbbc05" d="M13.2 22.3a7.2 7.2 0 0 1 0-4.6v-3.1h-4a12 12 0 0 0 0 10.8l4-3.1Z"/><path fill="#ea4335" d="M20 12.5c1.8 0 3.4.6 4.7 1.8l3.5-3.5A12 12 0 0 0 9.2 14.6l4 3.1a7.2 7.2 0 0 1 6.8-5.2Z"/></svg>`,
  xiaohongshu: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#ff2442"/><text x="20" y="24" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="800" fill="#fff">RED</text></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#050505"/><path fill="#fff" d="M22.7 18.2 31.5 8h-2.1l-7.6 8.8L15.7 8h-7l9.2 13.4L8.7 32h2.1l8-9.3 6.4 9.3h7l-9.5-13.8Zm-2.8 3.3-.9-1.3-7.4-10.6h3.1l6 8.6.9 1.3 7.8 11.1h-3.1l-6.4-9.1Z"/></svg>`,
  notion: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#fff"/><rect x="9" y="8" width="22" height="24" rx="2" fill="none" stroke="#111" stroke-width="2"/><path fill="#111" d="M14 15h3.6l7 10.2V15H28v2h-1.3v11H23l-7-10.3V26H18v2h-4v-2h1.3v-9H14v-2Z"/></svg>`,
  slack: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#fff"/><path fill="#36c5f0" d="M15 9a3 3 0 0 1 3 3v7h-3a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z"/><path fill="#2eb67d" d="M28 15a3 3 0 0 1-3 3h-7v-3a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3Z"/><path fill="#ecb22e" d="M25 31a3 3 0 0 1-3-3v-7h3a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3Z"/><path fill="#e01e5a" d="M12 25a3 3 0 0 1 3-3h7v3a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3Z"/></svg>`,
  youtube: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#ff0000"/><path fill="#fff" d="M29.7 15.1a3 3 0 0 0-2.1-2.1C25.7 12.5 20 12.5 20 12.5s-5.7 0-7.6.5a3 3 0 0 0-2.1 2.1c-.5 1.9-.5 4.9-.5 4.9s0 3 .5 4.9a3 3 0 0 0 2.1 2.1c1.9.5 7.6.5 7.6.5s5.7 0 7.6-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-4.9.5-4.9s0-3-.5-4.9ZM18 23.4v-6.8l5.9 3.4-5.9 3.4Z"/></svg>`,
  featured: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#fff7ed"/><path fill="#f59e0b" d="m20 7 2.6 8.2 8.4-2.1-5.8 6.4 5.8 6.4-8.4-2.1L20 32l-2.6-8.2L9 25.9l5.8-6.4L9 13.1l8.4 2.1L20 7Z"/><circle cx="20" cy="19.5" r="4" fill="#111827"/></svg>`,
  browser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#e0f2fe"/><circle cx="20" cy="20" r="11" fill="#0ea5e9"/><path fill="#fff" d="M9.6 17h20.8a10.9 10.9 0 0 0-20.8 0Z"/><path fill="#22c55e" d="M19.5 31a11 11 0 0 0 9.9-15H17.8l-5.6 9.6A11 11 0 0 0 19.5 31Z"/><circle cx="20" cy="20" r="4.2" fill="#fff"/></svg>`,
  search: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#ecfeff"/><circle cx="18" cy="18" r="8" fill="none" stroke="#0891b2" stroke-width="4"/><path stroke="#0f172a" stroke-linecap="round" stroke-width="4" d="m24 24 6 6"/></svg>`,
  data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#f0fdf4"/><rect x="10" y="12" width="20" height="18" rx="2" fill="#fff" stroke="#16a34a" stroke-width="2"/><path stroke="#16a34a" stroke-width="2" d="M10 18h20M16 12v18M23 12v18"/></svg>`,
  social: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#f5f3ff"/><path fill="#7c3aed" d="M12 13h16a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8l-5 4v-4h-3a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Z"/></svg>`,
}

function inferredBrandHomepage(item) {
  const exactHay = [
    item?.slug,
    item?.name,
    item?.display_name,
    item?.displayName,
  ].filter(Boolean).join(' ')
  const exactMatch = EXACT_BRAND_ICON_HOSTS.find(([pattern]) => pattern.test(exactHay))
  if (exactMatch) return exactMatch[1]

  const hay = [
    exactHay,
    item?.category,
    ...(item?.categories || []),
    ...(item?.tags || []),
    item?.description,
    item?.summary,
    item?.description_zh,
  ].filter(Boolean).join(' ')
  const match = BRAND_ICON_HOSTS.find(([pattern]) => pattern.test(hay))
  return match?.[1] || ''
}

function inferredBrandIconKey(item) {
  const hay = [
    item?.slug,
    item?.name,
    item?.display_name,
    item?.displayName,
    item?.category,
    ...(item?.categories || []),
    ...(item?.tags || []),
    item?.description,
    item?.summary,
    item?.description_zh,
  ].filter(Boolean).join(' ')
  const match = BRAND_ICON_ASSETS.find(([pattern]) => pattern.test(hay))
  return match?.[1] || ''
}

function svgDataUri(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function brandIconAssetUrl(item) {
  const key = inferredBrandIconKey(item)
  return key && BRAND_ICON_SVG[key] ? svgDataUri(BRAND_ICON_SVG[key]) : ''
}

function fallbackSkillIcon(item) {
  const hay = [
    item?.slug,
    item?.name,
    item?.display_name,
    item?.displayName,
    item?.category,
    ...(item?.categories || []),
    ...(item?.tags || []),
    item?.description,
    item?.summary,
    item?.description_zh,
  ].filter(Boolean).join(' ')
  const match = FALLBACK_SKILL_ICONS.find(([pattern]) => pattern.test(hay))
  return match?.[1] || '🧩'
}

function safeExternalUrl(value) {
  if (!value || typeof value !== 'string') return ''
  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function safeAssetUrl(value, homepage) {
  const absolute = safeExternalUrl(value)
  if (absolute) return absolute
  const base = safeExternalUrl(homepage)
  if (!base || !value || typeof value !== 'string') return ''
  try {
    const url = new URL(value.trim(), base)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function isStoreItemInstalled(item) {
  return [item?.slug, item?.name, item?.display_name, item?.displayName]
    .some(v => _installedNames.has(skillKey(v)))
}

async function ensureStoreIndex() {
  if (_storeIndex) return _storeIndex
  if (!_storeIndexPromise) {
    _storeIndexPromise = api.skillhubIndex()
      .then(items => {
        _storeIndex = Array.isArray(items) ? items : []
        return _storeIndex
      })
      .finally(() => { _storeIndexPromise = null })
  }
  return _storeIndexPromise
}

function formatCount(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function homepageOrigin(homepage) {
  homepage = safeExternalUrl(homepage)
  if (!homepage) return ''
  try {
    const url = new URL(homepage)
    return url.hostname ? url.origin : ''
  } catch {
    return ''
  }
}

function isMarketplaceIconHost(host) {
  const normalized = String(host || '').toLowerCase().replace(/^www\./, '')
  return MARKETPLACE_ICON_HOSTS.has(normalized)
}

function iconUrls(item) {
  const explicit = [item?.icon, item?.logo, item?.avatar, item?.avatar_url, item?.image]
    .map(value => safeAssetUrl(value, item?.homepage))
    .filter(v => typeof v === 'string' && v.trim())
  const brandAsset = brandIconAssetUrl(item)
  const origin = homepageOrigin(item?.homepage)
  const inferredOrigin = homepageOrigin(inferredBrandHomepage(item))
  const host = origin ? new URL(origin).hostname : ''
  const inferredHost = inferredOrigin ? new URL(inferredOrigin).hostname : ''
  const useHomepageIcon = origin && !isMarketplaceIconHost(host)
  return [
    ...explicit,
    brandAsset,
    useHomepageIcon ? `${origin}/favicon.ico` : '',
    useHomepageIcon && host ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico` : '',
    inferredHost && inferredHost !== host ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(inferredHost)}.ico` : '',
    inferredOrigin && inferredOrigin !== origin ? `${inferredOrigin}/favicon.ico` : '',
  ].filter(Boolean)
}

function iconFallbackText(item) {
  if (item?.emoji && String(item.emoji).trim()) return String(item.emoji).trim().slice(0, 2)
  return fallbackSkillIcon(item)
}

function renderSkillIcon(item, className = 'skills-card-icon') {
  const fallback = iconFallbackText(item)
  const urls = iconUrls(item).slice(0, 3)
  const primary = urls[0] || ''
  const fallbacks = esc(JSON.stringify(urls.slice(1)))
  const onError = `const urls=JSON.parse(this.dataset.fallbacks||'[]');const next=urls.shift();this.dataset.fallbacks=JSON.stringify(urls);if(next){this.src=next}else{this.style.display='none'}`
  return `
    <div class="${className}" aria-hidden="true">
      <span>${esc(fallback)}</span>
      ${primary ? `<img src="${esc(primary)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallbacks="${fallbacks}" onerror="${esc(onError)}">` : ''}
    </div>`
}

function renderChipIcon(key) {
  const svg = BRAND_ICON_SVG[key] || BRAND_ICON_SVG.featured
  return `<span class="chip-icon chip-icon--svg" aria-hidden="true">${svg}</span>`
}

function renderPreviewStats(stats) {
  const rows = stats.filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!rows.length) return ''
  return `
    <div class="skills-preview-stats">
      ${rows.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}
    </div>`
}

function renderPreviewInfoRows(rows, compact = false) {
  const filtered = rows.filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!filtered.length) return ''
  const visibleRows = compact ? filtered.slice(0, 4) : filtered
  return `
    <div class="skills-preview-info">
      ${visibleRows.map(([label, value]) => `<div><span>${esc(label)}</span><code>${esc(value)}</code></div>`).join('')}
    </div>`
}

function mergeSkillCatalogData(skill, catalog) {
  if (!catalog) return skill
  const merged = { ...catalog, ...skill }
  for (const key of ['description', 'homepage', 'icon', 'logo', 'avatar', 'avatar_url', 'image', 'author', 'owner_name', 'category', 'version']) {
    merged[key] = skill?.[key] || catalog?.[key]
  }
  merged.tags = (skill?.tags?.length ? skill.tags : catalog?.tags) || []
  merged.categories = (skill?.categories?.length ? skill.categories : catalog?.categories) || []
  merged.downloads = skill?.downloads || catalog?.downloads
  merged.installs = skill?.installs || catalog?.installs
  merged.stars = skill?.stars || catalog?.stars
  return merged
}

function previewData(item, options = {}) {
  const name = options.name || storeItemName(item) || item?.name || ''
  const desc = options.desc ?? storeItemDesc(item) ?? item?.description ?? ''
  const source = options.source || item?.source || item?.category || ''
  const slug = item?.slug || ''
  const category = storeItemCategory(item)
  const homepage = safeExternalUrl(item?.homepage)
  const path = item?.fullPath || item?.filePath || item?.path || ''
  const reqs = item?.requirements || {}
  const miss = item?.missing || {}
  const missingDeps = item?.missingDeps || []
  const dependencies = item?.dependencies || []
  const tags = [...(item?.tags || []), item?.category, ...(item?.categories || [])].filter(Boolean)
  const stats = [
    [t('skills.detailSource'), source],
    [t('skills.author'), item?.author || item?.owner_name],
    ['Version', item?.version ? `v${item.version}` : ''],
    [t('skills.downloads'), formatCount(item?.downloads || item?.installs)],
    [t('skills.stars'), formatCount(item?.stars)],
    [t('skills.detailPath'), path],
  ]
  const reqHtml = [
    ...(reqs.bins || []).map(v => [t('skills.reqBins'), v, (miss.bins || []).includes(v)]),
    ...(reqs.env || []).map(v => [t('skills.reqEnv'), v, (miss.env || []).includes(v)]),
    ...(reqs.config || []).map(v => [t('skills.missingConfig'), v, (miss.config || []).includes(v)]),
    ...missingDeps.map(v => [t('skills.missingDeps'), v, true]),
    ...dependencies.slice(0, 12).map(v => [t('skills.requirements'), v, false]),
  ]
  const infoRows = [
    ['Slug', slug],
    [t('skills.tags'), category],
    [t('skills.detailSource'), source],
    [t('skills.author'), item?.author || item?.owner_name],
    ['Version', item?.version ? `v${item.version}` : ''],
    [t('skills.detailPath'), path],
    [t('skills.openHomepage'), homepage],
  ]
  return { name, desc, source, homepage, tags, stats, reqHtml, infoRows, item }
}

function renderSkillPreviewContent(item, options = {}) {
  const data = previewData(item, options)
  const compact = options.compact === true
  const statRows = compact
    ? data.stats.filter(([label, value]) => value && [t('skills.downloads'), t('skills.stars')].includes(label))
    : data.stats
  const reqRows = compact ? data.reqHtml.slice(0, 5) : data.reqHtml
  const tagRows = compact ? data.tags.slice(0, 5) : data.tags.slice(0, 10)
  return `
      <div class="skills-preview-modal ${compact ? 'skills-preview-modal--compact' : ''}">
        <div class="skills-preview-modal-head">
          ${renderSkillIcon({ ...data.item, name: data.name }, 'skills-preview-modal-icon')}
          <div>
            <div class="skills-preview-modal-title">${esc(data.name)}</div>
            ${data.source ? `<div class="skills-preview-modal-subtitle">${esc(data.source)}</div>` : ''}
          </div>
        </div>
        <div class="skills-preview-modal-desc">${esc(data.desc || t('skills.noDescription'))}</div>
        ${renderPreviewStats(statRows)}
        ${renderPreviewInfoRows(data.infoRows, compact)}
        ${tagRows.length ? `<div class="skills-store-tags">${tagRows.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
        ${reqRows.length ? `
          <div class="skills-preview-requirements">
            ${reqRows.map(([label, value, missing]) => `<div class="${missing ? 'missing' : ''}"><span>${esc(label)}</span><code>${missing ? '✗' : '✓'} ${esc(value)}</code></div>`).join('')}
            ${compact && data.reqHtml.length > reqRows.length ? `<div><span>${t('skills.requirements')}</span><code>+${data.reqHtml.length - reqRows.length}</code></div>` : ''}
          </div>` : ''}
        ${data.homepage && !compact ? `<a class="btn btn-secondary btn-sm" href="${esc(data.homepage)}" target="_blank" rel="noopener">🔗 ${t('skills.openHomepage')}</a>` : ''}
      </div>`
}

function showSkillPreview(item, options = {}) {
  const data = previewData(item, options)
  showContentModal({
    title: esc(data.name || t('skills.preview')),
    width: 680,
    content: renderSkillPreviewContent(item, options),
  })
}

function cacheInstalledSkill(skill) {
  for (const key of [skill?.name, skill?.slug, skill?.display_name, skill?.displayName]) {
    const normalized = skillKey(key)
    if (normalized) _installedItems.set(normalized, skill)
  }
}

function findInstalledSkill(name) {
  return _installedItems.get(skillKey(name)) || null
}

function findStoreItemBySlug(slug) {
  return _storeItems.find(i => i.slug === slug) || _storeIndex?.find?.(i => i.slug === slug) || null
}

function resolvePreviewItem(card) {
  if (!card) return null
  if (card.dataset.previewKind === 'store') {
    return findStoreItemBySlug(card.dataset.previewKey)
  }
  const skill = findInstalledSkill(card.dataset.previewKey) || { name: card.dataset.previewKey }
  return mergeSkillCatalogData(skill, findStoreItemForSkill(skill))
}

function hideSkillHoverPreview(delay = 0) {
  clearTimeout(_hoverPreviewTimer)
  _hoverPreviewTimer = setTimeout(() => {
    _hoverPreviewEl?.remove()
    _hoverPreviewEl = null
    _hoverPreviewCard = null
  }, delay)
}

function showSkillHoverPreview(card) {
  const item = resolvePreviewItem(card)
  if (!item) return
  clearTimeout(_hoverPreviewTimer)
  _hoverPreviewEl?.remove()

  const rect = card.getBoundingClientRect()
  const pop = document.createElement('div')
  pop.className = 'skills-hover-preview'
  pop.innerHTML = renderSkillPreviewContent(item, { compact: true, name: card.dataset.name })
  document.body.appendChild(pop)

  const width = Math.min(380, window.innerWidth - 24)
  pop.style.width = `${width}px`
  const popHeight = Math.min(pop.offsetHeight || 320, window.innerHeight - 24)
  let left = rect.right + 12
  if (left + width > window.innerWidth - 12) left = rect.left - width - 12
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
  let top = rect.top
  if (top + popHeight > window.innerHeight - 12) top = window.innerHeight - popHeight - 12
  top = Math.max(12, top)

  pop.style.left = `${left}px`
  pop.style.top = `${top}px`
  pop.addEventListener('mouseenter', () => clearTimeout(_hoverPreviewTimer))
  pop.addEventListener('mouseleave', () => hideSkillHoverPreview(120))
  _hoverPreviewEl = pop
  _hoverPreviewCard = card
}

function scheduleSkillHoverPreview(card) {
  if (_hoverPreviewCard === card && _hoverPreviewEl) return
  clearTimeout(_hoverPreviewTimer)
  _hoverPreviewTimer = setTimeout(() => showSkillHoverPreview(card), 180)
}

function handlePreviewEnter(page, e) {
  const card = e.target.closest('.skill-card-item, .store-item')
  if (!card || !page.contains(card)) return
  if (e.relatedTarget && card.contains(e.relatedTarget)) return
  scheduleSkillHoverPreview(card)
}

function handlePreviewLeave(e) {
  const card = e.target.closest('.skill-card-item, .store-item')
  if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return
  if (e.relatedTarget && _hoverPreviewEl?.contains(e.relatedTarget)) return
  hideSkillHoverPreview(120)
}

// 骨架屏 HTML
function skeletonHtml(count = 5) {
  let html = '<div class="skills-skeleton">'
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skills-skeleton-item">
        <div class="skills-skeleton-emoji"></div>
        <div class="skills-skeleton-body">
          <div class="skills-skeleton-line skills-skeleton-line--short"></div>
          <div class="skills-skeleton-line skills-skeleton-line--mid"></div>
        </div>
        <div class="skills-skeleton-btn"></div>
      </div>`
  }
  html += '</div>'
  return html
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
    ? `<div class="skills-agent-selector">
        <label>${t('skills.agentLabel')}</label>
        <select id="skills-agent-select">
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
    <!-- Hero 统计栏 -->
    <div class="skills-hero">
      <div class="skills-hero-left">
        <div class="skills-hero-icon">🧩</div>
        <div>
          <div class="skills-hero-title">${t('skills.title')}</div>
          <div class="skills-hero-subtitle">${t('skills.desc')}</div>
        </div>
      </div>
      <div class="skills-hero-stats" id="skills-hero-stats">
        <div class="skills-stat-item">
          <span class="skills-stat-value" id="stat-total">--</span>
          <span class="skills-stat-label">${t('skills.tabInstalled')}</span>
        </div>
        <div class="skills-stat-item">
          <span class="skills-stat-value skills-stat-value--success" id="stat-eligible">--</span>
          <span class="skills-stat-label">${t('skills.eligible')}</span>
        </div>
        <div class="skills-stat-item">
          <span class="skills-stat-value skills-stat-value--warning" id="stat-missing">--</span>
          <span class="skills-stat-label">${t('skills.missingDeps')}</span>
        </div>
      </div>
    </div>

    ${agentOptions}

    <!-- Pill 风格 Tab -->
    <div class="skills-tab-nav" id="skills-main-tabs">
      <button class="skills-tab-btn active" data-main-tab="installed">
        📋 ${t('skills.tabInstalled')}
        <span class="skills-tab-count" id="tab-count-installed">--</span>
      </button>
      <button class="skills-tab-btn" data-main-tab="store">
        🛒 ${t('skills.tabStore')}
      </button>
    </div>

    <!-- 已安装面板 -->
    <div id="skills-tab-installed" class="config-section">
      ${skeletonHtml(6)}
    </div>

    <!-- 商店面板 -->
    <div id="skills-tab-store" class="config-section" style="display:none">
      <div class="skills-store-header">
        <div class="skills-store-hero">
          <div class="skills-store-hero-icon">🛒</div>
          <div>
            <div class="skills-store-title">${t('skills.storeTitle')}</div>
            <div class="skills-store-subtitle">${t('skills.storeSubtitle')}</div>
          </div>
        </div>
        <div class="skills-store-header-actions">
          <input type="file" id="skill-zip-input" accept=".zip,application/zip" style="display:none">
          <button class="btn btn-secondary btn-sm" data-action="skill-install-zip">📦 ${t('skills.installZip')}</button>
          <a class="btn btn-secondary btn-sm" id="skill-store-browse" href="https://www.skillhub.cn/" target="_blank" rel="noopener">🔗 ${t('skills.browseCn')}</a>
        </div>
      </div>

      <div class="skills-store-searchbar">
        <input class="input clawhub-search-input" id="skill-store-search" placeholder="${t('skills.searchPlaceholder')}" type="text">
        <button class="btn btn-primary btn-sm" data-action="store-search">🔍 ${t('skills.search')}</button>
      </div>

      <div class="skills-store-filters">
        <button class="skills-chip active" data-action="store-query" data-query="">${renderChipIcon('featured')}${t('skills.featured')}</button>
        <button class="skills-chip" data-action="store-query" data-query="github">${renderChipIcon('github')}GitHub</button>
        <button class="skills-chip" data-action="store-query" data-query="browser">${renderChipIcon('browser')}Browser</button>
        <button class="skills-chip" data-action="store-query" data-query="search">${renderChipIcon('search')}Search</button>
        <button class="skills-chip" data-action="store-query" data-query="data">${renderChipIcon('data')}Data</button>
        <button class="skills-chip" data-action="store-query" data-query="social">${renderChipIcon('social')}Social</button>
      </div>

      <div class="skills-store-meta" id="skill-store-meta">
        <span class="meta-dot"></span>${t('skills.storeLoading')}
      </div>

      <div class="skills-store-layout">
        <div id="store-results" class="clawhub-list skills-store-results">
          ${skeletonHtml(8)}
        </div>
      </div>

      <div class="skills-store-footer">
        <span>⚡ ${t('skills.storeSourceHint')}</span>
        <select class="input" id="skill-store-source">
          <option value="skillhubcn">🌏 ${t('skills.sourceCn')}</option>
          <option value="cos">🚀 ${t('skills.sourceMirror')}</option>
          <option value="official">🌍 ${t('skills.sourceOfficial')}</option>
        </select>
      </div>
    </div>
  `

  bindEvents(page)
  loadSkills(page)

  const agentSelect = page.querySelector('#skills-agent-select')
  if (agentSelect) {
    agentSelect.addEventListener('change', () => {
      const val = agentSelect.value
      _selectedAgentId = (val === 'main') ? null : val
      _installedNames = new Set()
      loadSkills(page)
    })
  }

  return page
}

// ===== 加载已安装 Skills =====
async function loadSkills(page) {
  const el = page.querySelector('#skills-tab-installed')
  if (!el) return
  const seq = ++_loadSeq

  el.innerHTML = `
    <div class="skills-loading-panel">
      ${skeletonHtml(6)}
      <div class="form-hint" style="margin-top:var(--space-md);text-align:center">${t('skills.loading')}</div>
    </div>`

  try {
    const data = await api.skillsList(_selectedAgentId)
    if (seq !== _loadSeq) return
    renderSkills(el, data)
    updateHeroStats(page, data)
    if (!_storeIndex) {
      ensureStoreIndex()
        .then(() => {
          if (seq === _loadSeq) renderSkills(el, data)
        })
        .catch(() => {})
    }
  } catch (e) {
    if (seq !== _loadSeq) return
    el.innerHTML = `
      <div class="skills-load-error">
        <div class="skills-empty-state">
          <div class="skills-empty-icon">⚠️</div>
          <div class="skills-empty-title">${t('skills.loadFailed')}</div>
          <div class="skills-empty-desc">${esc(e?.message || e)}</div>
          <button class="btn btn-primary btn-sm" data-action="skill-retry">🔄 ${t('skills.retry')}</button>
        </div>
      </div>`
  }
}

function updateHeroStats(page, data) {
  const skills = data?.skills || []
  const eligible = skills.filter(s => s.eligible && !s.disabled)
  const missing = skills.filter(s => !s.eligible && !s.disabled && !s.blockedByAllowlist)

  const totalEl = page.querySelector('#stat-total')
  const eligibleEl = page.querySelector('#stat-eligible')
  const missingEl = page.querySelector('#stat-missing')
  const tabCount = page.querySelector('#tab-count-installed')

  if (totalEl) totalEl.textContent = skills.length
  if (eligibleEl) eligibleEl.textContent = eligible.length
  if (missingEl) missingEl.textContent = missing.length
  if (tabCount) tabCount.textContent = skills.length
}

function renderSkills(el, data) {
  const skills = data?.skills || []
  _installedItems = new Map()
  skills.forEach(cacheInstalledSkill)
  const eligible = skills.filter(s => s.eligible && !s.disabled)
  const missing = skills.filter(s => !s.eligible && !s.disabled && !s.blockedByAllowlist)
  const disabled = skills.filter(s => s.disabled)
  const blocked = skills.filter(s => s.blockedByAllowlist && !s.disabled)

  const summary = t('skills.summaryDetail', { eligible: eligible.length, missing: missing.length, disabled: disabled.length })

  el.innerHTML = `
    <div class="clawhub-toolbar">
      <input class="input clawhub-search-input" id="skill-filter-input" placeholder="${t('skills.filterPlaceholder')}" type="text">
      <button class="btn btn-secondary btn-sm" data-action="skill-retry">🔄 ${t('skills.refresh')}</button>
    </div>

    <div class="skills-summary" style="margin-bottom:var(--space-lg);color:var(--text-secondary);font-size:var(--font-size-sm)">
      ${t('skills.summary', { total: skills.length, detail: summary })}
    </div>

    ${eligible.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--success)">
        <span class="panel-icon" style="background:var(--success-muted);color:var(--success)">✓</span>
        ${t('skills.eligibleGroup')}
        <span class="panel-count">${eligible.length}</span>
      </div>
      <div class="skills-installed-grid skills-scroll-area skills-trending-scroll" id="skills-eligible">
        ${eligible.map(s => renderSkillCard(s, 'eligible')).join('')}
      </div>
    </div>` : ''}

    ${missing.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--warning)">
        <span class="panel-icon" style="background:var(--warning-muted);color:var(--warning)">⚠</span>
        ${t('skills.missingGroup')}
        <span class="panel-count">${missing.length}</span>
        <button class="btn btn-secondary btn-sm" data-action="skill-ai-fix" style="margin-left:auto;font-size:var(--font-size-xs);padding:3px 10px">🤖 ${t('skills.aiFixBtn')}</button>
      </div>
      <div class="skills-installed-grid skills-scroll-area skills-installed-scroll" id="skills-missing">
        ${missing.map(s => renderSkillCard(s, 'missing')).join('')}
      </div>
    </div>` : ''}

    ${disabled.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--text-tertiary)">
        <span class="panel-icon" style="background:color-mix(in srgb, var(--text-tertiary) 12%, transparent)">⏸</span>
        ${t('skills.disabledGroup')}
        <span class="panel-count">${disabled.length}</span>
      </div>
      <div class="skills-installed-grid skills-scroll-area skills-search-scroll" id="skills-disabled">
        ${disabled.map(s => renderSkillCard(s, 'disabled')).join('')}
      </div>
    </div>` : ''}

    ${blocked.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--error)">
        <span class="panel-icon" style="background:var(--error-muted);color:var(--error)">🚫</span>
        ${t('skills.blockedGroup')}
        <span class="panel-count">${blocked.length}</span>
      </div>
      <div class="skills-installed-grid">
        ${blocked.map(s => renderSkillCard(s, 'blocked')).join('')}
      </div>
    </div>` : ''}

    ${!skills.length ? `
    <div class="clawhub-panel">
      <div class="skills-empty-state">
        <div class="skills-empty-icon">🛠️</div>
        <div class="skills-empty-title">${t('skills.noSkills')}</div>
        <div class="skills-empty-desc">${t('skills.noSkillsHint')}</div>
        <button class="btn btn-primary" data-empty-cta="go-store">🛒 ${t('skills.tabStore')}</button>
      </div>
    </div>` : ''}

  `

  // 实时过滤
  const input = el.querySelector('#skill-filter-input')
  if (input) {
    const filterEmptyEl = document.createElement('div')
    filterEmptyEl.id = 'skills-filter-empty'
    filterEmptyEl.style.cssText = 'display:none;padding:40px;text-align:center;color:var(--text-tertiary)'
    el.querySelector('.skills-summary')?.after(filterEmptyEl)

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase()
      let visibleCount = 0
      el.querySelectorAll('.skill-card-item').forEach(card => {
        const name = (card.dataset.name || '').toLowerCase()
        const desc = (card.dataset.desc || '').toLowerCase()
        const source = (card.dataset.source || '').toLowerCase()
        const match = !q || name.includes(q) || desc.includes(q) || source.includes(q)
        card.style.display = match ? '' : 'none'
        if (match) visibleCount++
      })

      if (q && visibleCount === 0) {
        filterEmptyEl.textContent = t('skills.noResults')
        filterEmptyEl.style.display = ''
      } else {
        filterEmptyEl.style.display = 'none'
      }
    })
  }

  el.querySelector('[data-empty-cta="go-store"]')?.addEventListener('click', () => {
    const page = el.closest('.page')
    page?.querySelector('.skills-tab-btn[data-main-tab="store"]')?.click()
  })
}

function renderSkillCard(skill, status) {
  const name = skill.name || ''
  const desc = skill.description || ''
  const catalog = findStoreItemForSkill(skill)
  const iconSource = mergeSkillCatalogData(skill, catalog)
  const source = skill.bundled ? t('skills.bundled') : (skill.source || t('skills.custom'))
  const missingBins = skill.missing?.bins || []
  const missingEnv = skill.missing?.env || []
  const missingConfig = skill.missing?.config || []
  const installOpts = skill.install || []

  // 状态对应的 CSS 类和 badge
  const statusClassMap = {
    eligible: 'clawhub-item--eligible',
    missing: 'clawhub-item--missing',
    disabled: 'clawhub-item--disabled',
    blocked: 'clawhub-item--blocked',
  }
  const statusBadgeMap = {
    eligible: `<span class="clawhub-badge installed">${t('skills.eligible')}</span>`,
    missing: `<span class="clawhub-badge clawhub-badge--warning">${t('skills.missingDeps')}</span>`,
    disabled: `<span class="clawhub-badge clawhub-badge--muted">${t('skills.disabled')}</span>`,
    blocked: `<span class="clawhub-badge clawhub-badge--error">${t('skills.blocked')}</span>`,
  }

  let missingHtml = ''
  if (missingBins.length) missingHtml += `<div class="clawhub-item-meta">📦 ${t('skills.missingCmd')}: ${missingBins.map(b => `<code>${esc(b)}</code>`).join(', ')}</div>`
  if (missingEnv.length) missingHtml += `<div class="clawhub-item-meta">🔑 ${t('skills.missingEnv')}: ${missingEnv.map(e => `<code>${esc(e)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:11px">${t('skills.missingEnvHint')}</span></div>`
  if (missingConfig.length) missingHtml += `<div class="clawhub-item-meta">⚙️ ${t('skills.missingConfig')}: ${missingConfig.map(c => `<code>${esc(c)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:11px">${t('skills.missingConfigHint')}</span></div>`

  let installHtml = ''
  if (status === 'missing') {
    if (installOpts.length) {
      installHtml = `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">${installOpts.map(opt =>
        `<button class="btn btn-primary btn-sm" data-action="skill-install-dep" data-kind="${esc(opt.kind)}" data-install='${esc(JSON.stringify(opt))}' data-skill-name="${esc(name)}">⬇ ${esc(opt.label)}</button>`
      ).join('')}</div>`
    } else if (missingBins.length && !missingEnv.length && !missingConfig.length) {
      installHtml = `<div style="margin-top:6px;color:var(--text-tertiary);font-size:11px">💡 ${t('skills.noAutoInstall')}: ${missingBins.map(b => `<code>brew install ${esc(b)}</code> / <code>npm i -g ${esc(b)}</code>`).join(' / ')}</div>`
    }
  }

  return `
    <div class="clawhub-item skill-card-item ${statusClassMap[status] || ''}" data-action="skill-info" data-preview-kind="installed" data-preview-key="${esc(name)}" data-name="${esc(name)}" data-desc="${esc(desc)}" data-source="${esc(source)}">
      ${renderSkillIcon(iconSource)}
      <div class="clawhub-item-main">
        <div class="clawhub-item-title">${esc(name)}</div>
        <div class="clawhub-item-meta">${esc(source)}</div>
        ${desc ? `<div class="clawhub-item-desc">${esc(desc)}</div>` : ''}
        ${missingHtml}
        ${installHtml}
      </div>
      <div class="clawhub-item-actions">
        <button class="btn btn-secondary btn-sm skills-preview-btn" data-action="skill-info" data-name="${esc(name)}" title="${t('skills.preview')}">👁</button>
        ${!skill.bundled ? `<button class="btn btn-secondary btn-sm skills-remove-btn" data-action="skill-uninstall" data-name="${esc(name)}" title="${t('skills.uninstall')}">×</button>` : ''}
        ${statusBadgeMap[status] || ''}
      </div>
      <div class="skills-card-hover-preview" aria-hidden="true">
        ${renderSkillPreviewContent(iconSource, { compact: true, name })}
      </div>
    </div>
  `
}

function findStoreItemForSkill(skill) {
  if (!_storeIndex?.length) return null
  const keys = [skill?.name, skill?.slug, skill?.display_name, skill?.displayName].map(skillKey).filter(Boolean)
  if (!keys.length) return null
  return _storeIndex.find(item => [item?.slug, item?.name, item?.display_name, item?.displayName].some(v => keys.includes(skillKey(v)))) || null
}

// ===== Skill 详情 =====
async function handleInfo(page, name) {
  try {
    let skill = null
    if (wsClient.connected && wsClient.gatewayReady) {
      try { skill = await wsClient.skillsDetail(name) } catch {}
    }
    if (!skill) skill = await api.skillsInfo(name, _selectedAgentId)
    if (!_storeIndex) {
      try { await ensureStoreIndex() } catch {}
    }
    showSkillPreview(mergeSkillCatalogData(skill || { name }, findStoreItemForSkill(skill || { name })), { name })
  } catch (e) {
    toast(`${t('skills.detailLoadFailed')}: ${e?.message || e}`, 'error')
  }
}

// ===== 依赖安装 =====
async function handleInstallDep(page, btn) {
  const kind = btn.dataset.kind
  let spec
  try { spec = JSON.parse(btn.dataset.install) } catch { spec = {} }
  const skillName = btn.dataset.skillName || ''
  btn.disabled = true
  btn.textContent = '⏳ ' + t('skills.installing')
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

// ===== 商店相关 =====
async function loadStore(page) {
  const results = page.querySelector('#store-results')
  const meta = page.querySelector('#skill-store-meta')
  if (!results) return
  updateStoreSourceUi(page)
  results.innerHTML = skeletonHtml(8)
  if (meta) meta.innerHTML = '<span class="meta-dot"></span>' + t('skills.storeLoading')

  try {
    try {
      const data = await api.skillsList(_selectedAgentId)
      _installedNames = new Set((data?.skills || []).flatMap(s => [s.name, s.slug]).map(skillKey).filter(Boolean))
    } catch { _installedNames = new Set() }
    _storeIndex = await ensureStoreIndex()
    _storeItems = Array.isArray(_storeIndex) ? _storeIndex : []
    if (meta) meta.innerHTML = `<span class="meta-dot"></span>${t('skills.featuredMeta', { count: _storeItems.length })}`
    renderStoreItems(results, _storeIndex)
  } catch (e) {
    results.innerHTML = `<div class="skills-empty-state"><div class="skills-empty-icon">🌐</div><div class="skills-empty-title">${t('skills.storeLoadFailed')}</div><div class="skills-empty-desc">${esc(e?.message || e)}</div></div>`
  }
}

function updateStoreSourceUi(page) {
  const select = page.querySelector('#skill-store-source')
  const browse = page.querySelector('#skill-store-browse')
  if (!select || !browse) return
  const source = select.value || 'cos'
  if (source === 'official') {
    browse.href = 'https://www.skillhub.club/'
    browse.textContent = '🔗 ' + t('skills.browseOfficial')
  } else if (source === 'skillhubcn') {
    browse.href = 'https://www.skillhub.cn/'
    browse.textContent = '🔗 ' + t('skills.browseCn')
  } else {
    browse.href = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json'
    browse.textContent = '🔗 ' + t('skills.browseMirror')
  }
}

function renderStoreItems(el, items) {
  if (!items?.length) {
    el.innerHTML = `<div class="skills-empty-state"><div class="skills-empty-icon">🔍</div><div class="skills-empty-title">${t('skills.noResults')}</div></div>`
    return
  }
  _storeItems = items
  el.innerHTML = items.map(item => {
    const slug = item.slug || ''
    const name = storeItemName(item)
    const desc = storeItemDesc(item)
    const category = storeItemCategory(item)
    const installed = isStoreItemInstalled(item)
    const stats = [
      item.version ? `v${item.version}` : '',
      item.author || item.owner_name || '',
      formatCount(item.downloads || item.installs) ? `⬇ ${formatCount(item.downloads || item.installs)}` : '',
      formatCount(item.stars) ? `⭐ ${formatCount(item.stars)}` : '',
    ].filter(Boolean).join(' · ')
    return `
      <div class="clawhub-item store-item" data-action="store-info" data-preview-kind="store" data-preview-key="${esc(slug)}" data-slug="${esc(slug)}" data-name="${esc(name)}" data-desc="${esc(desc)}">
        ${renderSkillIcon(item, 'skills-store-card-icon')}
        <div class="clawhub-item-main">
          <div class="clawhub-item-title">${esc(name)}</div>
          ${desc ? `<div class="clawhub-item-desc">${esc(desc)}</div>` : ''}
          ${stats || category ? `<div class="clawhub-item-meta">${[category, stats].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        </div>
        <div class="clawhub-item-actions">
          <button class="btn btn-secondary btn-sm skills-preview-btn" data-action="store-info" data-slug="${esc(slug)}" title="${t('skills.preview')}">👁</button>
          ${installed
            ? `<span class="clawhub-badge installed">${t('skills.installed')}</span>`
            : `<button class="btn btn-secondary btn-sm skills-store-add-btn" data-action="store-install" data-slug="${esc(slug)}" title="${t('skills.install')}">+</button>`
          }
        </div>
        <div class="skills-card-hover-preview" aria-hidden="true">
          ${renderSkillPreviewContent(item, { compact: true, name })}
        </div>
      </div>
    `
  }).join('')
}

async function handleStoreSearch(page) {
  const input = page.querySelector('#skill-store-search')
  const results = page.querySelector('#store-results')
  const meta = page.querySelector('#skill-store-meta')
  if (!input || !results) return
  const q = input.value.trim()

  // 有全量索引 → 本地过滤（更快，零网络延迟）
  if (_storeIndex && _storeIndex.length) {
    let items = _storeIndex
    if (q) {
      const lq = q.toLowerCase()
      items = _storeIndex.filter(item => {
        const name = storeItemName(item).toLowerCase()
        const desc = storeItemDesc(item).toLowerCase()
        const slug = (item.slug || '').toLowerCase()
        const category = storeItemCategory(item).toLowerCase()
        return name.includes(lq) || desc.includes(lq) || slug.includes(lq) || category.includes(lq)
      })
    }
    if (meta) {
      if (q && items.length === 0) {
        meta.innerHTML = `<span class="meta-dot"></span>未找到匹配「${q}」的技能`
      } else if (q) {
        meta.innerHTML = `<span class="meta-dot"></span>本地匹配 ${items.length} 个技能（← 输入可实时过滤）`
      } else {
        meta.innerHTML = `<span class="meta-dot"></span>${t('skills.featuredMeta', { count: items.length })}`
      }
    }
    renderStoreItems(results, items)
    return
  }

  // 没有全量索引 → 回退远端 API 搜索
  if (!q) return
  results.innerHTML = skeletonHtml(4)
  if (meta) meta.innerHTML = '<span class="meta-dot"></span>' + t('skills.searching')

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
    if (meta) meta.innerHTML = `<span class="meta-dot"></span>${t('skills.searchMeta', { count: items?.length || 0, query: q })}`
    renderStoreItems(results, items)
  } catch (e) {
    results.innerHTML = `<div class="skills-empty-state"><div class="skills-empty-icon">⚠️</div><div class="skills-empty-title">${t('skills.searchFailed')}</div><div class="skills-empty-desc">${esc(e?.message || e)}</div></div>`
  }
}

async function handleStoreInstall(page, btn) {
  const slug = btn.dataset.slug
  btn.disabled = true
  btn.textContent = '…'
  try {
    await api.skillhubInstall(slug, _selectedAgentId)
    toast(t('skills.skillInstalled', { name: slug }), 'success')
    btn.textContent = '✓'
    btn.classList.remove('btn-primary')
    btn.classList.add('btn-secondary')
    _installedNames.add(skillKey(slug))
    const item = _storeItems.find(i => i.slug === slug)
    if (item) [item.name, item.display_name, item.displayName].forEach(v => { if (v) _installedNames.add(skillKey(v)) })
    const storeResults = page.querySelector('#store-results')
    if (storeResults) renderStoreItems(storeResults, _storeItems)
    loadSkills(page).catch(() => {})
  } catch (e) {
    toast(humanizeError(e, t('skills.installFailed')), 'error')
    btn.disabled = false
    btn.textContent = '+'
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
  btn.textContent = '⏳ ' + t('skills.uninstalling')
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

// ===== 事件绑定 =====
function bindEvents(page) {
  // 主 Tab 切换（Pill 风格）
  page.querySelectorAll('#skills-main-tabs .skills-tab-btn').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('#skills-main-tabs .skills-tab-btn').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const key = tab.dataset.mainTab
      const installedTab = page.querySelector('#skills-tab-installed')
      const storeTab = page.querySelector('#skills-tab-store')
      if (installedTab) installedTab.style.display = key === 'installed' ? '' : 'none'
      if (storeTab) storeTab.style.display = key === 'store' ? '' : 'none'
      if (key === 'store') loadStore(page)
    }
  })

  page.addEventListener('pointerover', (e) => handlePreviewEnter(page, e))

  page.addEventListener('pointerout', handlePreviewLeave)

  page.addEventListener('scroll', () => hideSkillHoverPreview(0), true)

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    hideSkillHoverPreview(0)
    e.stopPropagation()
    switch (btn.dataset.action) {
      case 'skill-retry':
        await loadSkills(page)
        break
      case 'skill-info':
        await handleInfo(page, btn.dataset.name)
        break
      case 'store-info': {
        const item = _storeItems.find(i => i.slug === btn.dataset.slug)
        if (item) showSkillPreview(item)
        break
      }
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

export function cleanup() {
  clearTimeout(_hoverPreviewTimer)
  _hoverPreviewEl?.remove()
  _hoverPreviewEl = null
  _hoverPreviewCard = null
  _hoverPreviewTimer = null
  _storeIndex = null
  _storeItems = []
  _installedNames = new Set()
  _installedItems = new Map()
  _storeIndexPromise = null
}
