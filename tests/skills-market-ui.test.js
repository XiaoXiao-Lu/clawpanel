import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skillsPage = readFileSync(new URL('../src/pages/skills.js', import.meta.url), 'utf8')
const tauriApi = readFileSync(new URL('../src/lib/tauri-api.js', import.meta.url), 'utf8')
const devApi = readFileSync(new URL('../scripts/dev-api.js', import.meta.url), 'utf8')
const tauriSkills = readFileSync(new URL('../src-tauri/src/commands/skills.rs', import.meta.url), 'utf8')
const tauriLib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const tauriSkillhub = readFileSync(new URL('../src-tauri/src/commands/skillhub.rs', import.meta.url), 'utf8')
const pagesCss = readFileSync(new URL('../src/style/pages.css', import.meta.url), 'utf8')

test('Skills market exposes local ZIP install controls', () => {
  assert.match(skillsPage, /id="skill-zip-input"/)
  assert.match(skillsPage, /data-action="skill-install-zip"/)
  assert.match(skillsPage, /accept="\.zip,application\/zip"/)
  assert.match(skillsPage, /function handleInstallZip/)
  assert.match(skillsPage, /api\.skillsInstallZip/)
})

test('Skills market exposes selectable store source and SkillHub CN browse entry', () => {
  assert.match(skillsPage, /id="skill-store-search-source"/)
  assert.match(skillsPage, /value="all"/)
  assert.match(skillsPage, /value="skillhub"/)
  assert.match(skillsPage, /value="xiaping"/)
  assert.match(skillsPage, /value="github"/)
  assert.match(skillsPage, /https:\/\/www\.skillhub\.cn\//)
})

test('Skills market searches SkillHub remotely instead of filtering the small featured index', () => {
  const searchBody = skillsPage.slice(
    skillsPage.indexOf('async function handleStoreSearch'),
    skillsPage.indexOf('async function handleStoreInstall')
  )
  assert.match(searchBody, /api\.skillhubSearchAll\(query,\s*60\)/)
  assert.doesNotMatch(searchBody, /_storeIndex\.filter/, 'keyword search should not be capped by the featured mirror index')
  assert.doesNotMatch(searchBody, /filterStoreItemsLocally/, 'should not apply strict substring filter on API results')
})

test('Skills market presents installable skills as a scan-friendly grid', () => {
  assert.doesNotMatch(skillsPage, /id="store-preview"/)
  assert.doesNotMatch(skillsPage, /function renderStorePreview/)
  assert.doesNotMatch(skillsPage, /data-action="store-preview"/)
  assert.doesNotMatch(skillsPage, /data-action="store-select"/)
  assert.match(skillsPage, /showContentModal/)
  assert.match(skillsPage, /function showSkillPreview/)
  assert.match(skillsPage, /function renderSkillPreviewContent/)
  assert.match(skillsPage, /function showSkillHoverPreview/)
  assert.match(skillsPage, /function scheduleSkillHoverPreview/)
  assert.match(skillsPage, /skills-card-hover-preview/)
  assert.match(skillsPage, /data-action="store-info"/)
  assert.match(skillsPage, /data-action="skill-info"/)
  assert.match(skillsPage, /data-preview-kind="store"/)
  assert.match(skillsPage, /data-preview-kind="installed"/)
  assert.match(skillsPage, /data-action="store-query"/)
  assert.match(skillsPage, /skills-store-layout/)
  assert.match(skillsPage, /skills-installed-grid/)
  assert.match(skillsPage, /skills-card-icon/)
  assert.match(skillsPage, /skills-store-card-icon/)
  assert.match(skillsPage, /skills-store-add-btn/)
  assert.match(pagesCss, /\.skills-store-results\s*\{[^}]*display:\s*grid/s)
  assert.match(pagesCss, /\.skills-installed-grid\s*\{[^}]*display:\s*grid/s)
  assert.match(pagesCss, /\.skills-store-results\s*\{[^}]*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/s)
  assert.match(pagesCss, /\.clawhub-item\.store-item\s*\{[^}]*flex-direction:\s*row/s)
  assert.match(pagesCss, /\.skills-preview-modal\s*\{[^}]*display:\s*flex/s)
  assert.match(pagesCss, /\.skills-preview-stats\s*\{[^}]*display:\s*grid/s)
  assert.match(pagesCss, /\.skills-hover-preview\s*\{[^}]*position:\s*fixed/s)
  assert.match(pagesCss, /\.skills-card-hover-preview\s*\{[^}]*position:\s*absolute/s)
  assert.match(pagesCss, /\.skill-card-item:hover \.skills-card-hover-preview/s)
  assert.match(pagesCss, /\.skills-preview-info\s*\{[^}]*display:\s*grid/s)
})

test('Skills main tabs expose accessible tab semantics and keyboard navigation', () => {
  assert.match(skillsPage, /id="skills-main-tabs"[^>]*role="tablist"/)
  assert.match(skillsPage, /role="tab"[^>]*aria-selected="true"[^>]*aria-controls="skills-tab-installed"/)
  assert.match(skillsPage, /role="tab"[^>]*aria-selected="false"[^>]*aria-controls="skills-tab-store"/)
  assert.match(skillsPage, /id="skills-tab-installed"[^>]*role="tabpanel"[^>]*aria-labelledby="skills-tab-btn-installed"/)
  assert.match(skillsPage, /id="skills-tab-store"[^>]*role="tabpanel"[^>]*aria-labelledby="skills-tab-btn-store"/)
  assert.match(skillsPage, /function activateMainTab/)
  assert.match(skillsPage, /aria-selected/)
  assert.match(skillsPage, /tabIndex/)
  assert.match(skillsPage, /ArrowLeft/)
  assert.match(skillsPage, /ArrowRight/)
  assert.match(skillsPage, /Home/)
  assert.match(skillsPage, /End/)
})

test('Skills cards prefer official visual assets with safe fallbacks', () => {
  assert.match(skillsPage, /function safeExternalUrl/)
  assert.match(skillsPage, /function safeAssetUrl/)
  assert.match(skillsPage, /function iconUrls/)
  assert.match(skillsPage, /const BRAND_ICON_ASSETS/)
  assert.match(skillsPage, /const BRAND_ICON_SVG/)
  assert.match(skillsPage, /const EXACT_BRAND_ICON_HOSTS/)
  assert.match(skillsPage, /const BRAND_ICON_HOSTS/)
  assert.match(skillsPage, /const FALLBACK_SKILL_ICONS/)
  assert.match(skillsPage, /const MARKETPLACE_ICON_HOSTS/)
  assert.match(skillsPage, /function brandIconAssetUrl/)
  assert.match(skillsPage, /function renderChipIcon/)
  assert.match(skillsPage, /data:image\/svg\+xml/)
  assert.match(skillsPage, /brandAsset,\s*useHomepageIcon/s)
  assert.match(skillsPage, /const exactMatch = EXACT_BRAND_ICON_HOSTS\.find/)
  assert.match(skillsPage, /function fallbackSkillIcon/)
  assert.match(skillsPage, /function isMarketplaceIconHost/)
  assert.match(skillsPage, /item\?\.icon,\s*item\?\.logo,\s*item\?\.avatar,\s*item\?\.avatar_url,\s*item\?\.image/s)
  assert.match(skillsPage, /homepageOrigin\(item\?\.homepage\)/)
  assert.match(skillsPage, /useHomepageIcon\s*=\s*origin\s*&&\s*!isMarketplaceIconHost\(host\)/)
  assert.match(skillsPage, /icons\.duckduckgo\.com\/ip3/)
  assert.doesNotMatch(skillsPage, /\|\\bx\\b/, 'single-letter X should not be inferred from loose catalog text')
  assert.match(skillsPage, /mergeSkillCatalogData\(skill,\s*catalog\)/)
})

test('Skills ZIP install API is wired in Web and Tauri backends', () => {
  assert.match(tauriApi, /skillsInstallZip:/)
  assert.match(tauriApi, /skills_install_zip/)
  assert.match(devApi, /async skills_install_zip/)
  assert.match(tauriSkills, /pub async fn skills_install_zip/)
  assert.match(tauriLib, /skills::skills_install_zip/)
})

test('SkillHub item model preserves richer catalog metadata for grid cards', () => {
  assert.match(tauriSkillhub, /pub description_zh: Option<String>/)
  assert.match(tauriSkillhub, /pub owner_name: Option<String>/)
  assert.match(tauriSkillhub, /pub category: Option<String>/)
  assert.match(tauriSkillhub, /pub icon: Option<String>/)
  assert.match(tauriSkillhub, /pub logo: Option<String>/)
  assert.match(tauriSkillhub, /pub avatar_url: Option<String>/)
  assert.match(tauriSkillhub, /pub installs: Option<u64>/)
  assert.match(tauriSkillhub, /pub labels: Option<serde_json::Value>/)
  assert.match(tauriSkills, /copy_skill_visual_fields/)
  assert.match(tauriSkills, /\["homepage", "icon", "logo", "avatar", "avatar_url", "image"\]/)
})

test('Multi-source skill search supports SkillHub + Xiaping + GitHub', () => {
  // Rust SDK has all three search functions + aggregator
  assert.match(tauriSkillhub, /pub async fn search_xiaping/)
  assert.match(tauriSkillhub, /pub async fn search_github/)
  assert.match(tauriSkillhub, /pub async fn search_all/)
  assert.match(tauriSkillhub, /XIAPING_BASE/)
  assert.match(tauriSkillhub, /GITHUB_API_BASE/)

  // Tauri commands registered
  assert.match(tauriSkills, /pub async fn skillhub_search_all/)
  assert.match(tauriSkills, /pub async fn skillhub_search_xiaping/)
  assert.match(tauriSkills, /pub async fn skillhub_search_github/)
  assert.match(tauriLib, /skills::skillhub_search_all/)
  assert.match(tauriLib, /skills::skillhub_search_xiaping/)
  assert.match(tauriLib, /skills::skillhub_search_github/)

  // Frontend API wrappers
  assert.match(tauriApi, /skillhubSearchAll:/)
  assert.match(tauriApi, /skillhubSearchXiaping:/)
  assert.match(tauriApi, /skillhubSearchGithub:/)

  // Web/dev-api backend
  assert.match(devApi, /async skillhub_search_all/)
  assert.match(devApi, /async skillhub_search_xiaping/)
  assert.match(devApi, /async skillhub_search_github/)

  // Frontend uses multi-source search by default
  const searchBody = skillsPage.slice(
    skillsPage.indexOf('async function handleStoreSearch'),
    skillsPage.indexOf('async function handleStoreInstall')
  )
  assert.match(searchBody, /skill-store-search-source/)
  assert.match(searchBody, /source === 'all'/)
  assert.match(searchBody, /source === 'xiaping'/)
  assert.match(searchBody, /source === 'github'/)
})
