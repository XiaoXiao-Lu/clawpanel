import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skillsPage = readFileSync(new URL('../src/pages/skills.js', import.meta.url), 'utf8')
const tauriApi = readFileSync(new URL('../src/lib/tauri-api.js', import.meta.url), 'utf8')
const devApi = readFileSync(new URL('../scripts/dev-api.js', import.meta.url), 'utf8')
const tauriSkills = readFileSync(new URL('../src-tauri/src/commands/skills.rs', import.meta.url), 'utf8')
const tauriLib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const tauriSkillhub = readFileSync(new URL('../src-tauri/src/commands/skillhub.rs', import.meta.url), 'utf8')

test('Skills market exposes local ZIP install controls', () => {
  assert.match(skillsPage, /id="skill-zip-input"/)
  assert.match(skillsPage, /data-action="skill-install-zip"/)
  assert.match(skillsPage, /accept="\.zip,application\/zip"/)
  assert.match(skillsPage, /function handleInstallZip/)
  assert.match(skillsPage, /api\.skillsInstallZip/)
})

test('Skills market exposes selectable store source and SkillHub CN browse entry', () => {
  assert.match(skillsPage, /id="skill-store-source"/)
  assert.match(skillsPage, /value="skillhubcn"/)
  assert.match(skillsPage, /https:\/\/www\.skillhub\.cn\//)
  assert.match(skillsPage, /function updateStoreSourceUi/)
})

test('Skills market searches SkillHub remotely instead of filtering the small featured index', () => {
  const searchBody = skillsPage.slice(
    skillsPage.indexOf('async function handleStoreSearch'),
    skillsPage.indexOf('async function handleStoreInstall')
  )
  assert.match(searchBody, /api\.skillhubSearch\(q,\s*60\)/)
  assert.doesNotMatch(searchBody, /_storeIndex\.filter/, 'keyword search should not be capped by the featured mirror index')
})

test('Skills market provides preview-first install interactions', () => {
  assert.match(skillsPage, /id="store-preview"/)
  assert.match(skillsPage, /function renderStorePreview/)
  assert.match(skillsPage, /data-action="store-preview"/)
  assert.match(skillsPage, /data-action="store-query"/)
  assert.match(skillsPage, /skills-store-layout/)
})

test('Skills ZIP install API is wired in Web and Tauri backends', () => {
  assert.match(tauriApi, /skillsInstallZip:/)
  assert.match(tauriApi, /skills_install_zip/)
  assert.match(devApi, /async skills_install_zip/)
  assert.match(tauriSkills, /pub async fn skills_install_zip/)
  assert.match(tauriLib, /skills::skills_install_zip/)
})

test('SkillHub item model preserves richer catalog metadata for previews', () => {
  assert.match(tauriSkillhub, /pub description_zh: Option<String>/)
  assert.match(tauriSkillhub, /pub owner_name: Option<String>/)
  assert.match(tauriSkillhub, /pub category: Option<String>/)
  assert.match(tauriSkillhub, /pub installs: Option<u64>/)
  assert.match(tauriSkillhub, /pub labels: Option<serde_json::Value>/)
})
