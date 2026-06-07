import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/expert-teams.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/style/pages/expert-teams.css', import.meta.url), 'utf8')
const api = readFileSync(new URL('../src/lib/tauri-api.js', import.meta.url), 'utf8')
const rust = readFileSync(new URL('../src-tauri/src/commands/team.rs', import.meta.url), 'utf8')
const devApi = readFileSync(new URL('../scripts/dev-api.js', import.meta.url), 'utf8')
const engine = readFileSync(new URL('../src/engines/openclaw/index.js', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/locales/index.js', import.meta.url), 'utf8')
const sidebarLocale = readFileSync(new URL('../src/locales/modules/sidebar.js', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('OpenClaw registers Expert Teams navigation and route', () => {
  assert.match(engine, /route:\s*'\/expert-teams'/)
  assert.match(engine, /path:\s*'\/expert-teams'/)
  assert.match(engine, /pages\/expert-teams\.js/)
  assert.match(sidebarLocale, /expertTeams:\s*_\(/)
  assert.match(locales, /import expertTeams/)
  assert.match(locales, /agentDetail,\s*expertTeams/)
})

test('Expert Teams API is exposed in frontend, dev API, and Tauri commands', () => {
  for (const name of [
    'listExperts',
    'saveExpert',
    'deleteExpert',
    'listExpertGroups',
    'saveExpertGroup',
    'deleteExpertGroup',
  ]) {
    assert.match(api, new RegExp(`${name}:`), `${name} should be in tauri-api`)
  }
  for (const cmd of [
    'list_experts',
    'save_expert',
    'delete_expert',
    'list_expert_groups',
    'save_expert_group',
    'delete_expert_group',
  ]) {
    assert.match(rust, new RegExp(`pub fn ${cmd}`), `${cmd} should be a Tauri command`)
    assert.match(devApi, new RegExp(`${cmd}\\(`), `${cmd} should be handled in dev-api`)
  }
})

test('Expert Teams persistence keeps expert library and group membership separate', () => {
  assert.match(rust, /experts\.json/)
  assert.match(rust, /expert-groups\.json/)
  assert.match(rust, /prune_expert_from_groups/)
  assert.match(rust, /moderatorExpertId/)
  assert.match(rust, /members/)
  assert.match(devApi, /expertProfilesPath/)
  assert.match(devApi, /expertGroupsPath/)
  assert.match(devApi, /pruneExpertFromGroups/)
})

test('Expert Teams page supports expert editing and team member selection', () => {
  for (const token of [
    'api.listExperts',
    'api.saveExpert',
    'api.deleteExpert',
    'api.listExpertGroups',
    'api.saveExpertGroup',
    'api.deleteExpertGroup',
    'expert-member-picker',
    'data-member-toggle',
    'data-member-order',
    'moderatorExpertId',
    'group-moderator',
    'expert-communication-note',
  ]) {
    assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Expert Teams styling keeps a responsive workbench layout', () => {
  assert.match(cssBlock('.expert-teams-shell'), /grid-template-columns:\s*minmax\(280px,\s*360px\)\s*minmax\(0,\s*1fr\)/)
  assert.match(cssBlock('.expert-member-picker'), /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/)
  assert.match(cssBlock('.expert-member-row'), /grid-template-columns:\s*18px\s*32px\s*minmax\(0,\s*1fr\)\s*64px/)
  assert.match(css, /@media \(max-width:\s*1120px\)[\s\S]*\.expert-teams-shell\s*\{[\s\S]*grid-template-columns:\s*1fr/)
})
