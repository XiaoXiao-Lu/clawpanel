import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/expert-teams.js', import.meta.url), 'utf8')
const locale = readFileSync(new URL('../src/locales/modules/expertTeams.js', import.meta.url), 'utf8')

test('Expert Teams tool domains render from locale keys', () => {
  const toolBlock = page.slice(page.indexOf('const TOOL_CATEGORIES'), page.indexOf('const TABS'))
  for (const token of [
    'nameKey',
    'descKey',
    'expertTeams.toolSystem',
    'expertTeams.toolProcess',
    'expertTeams.toolInteraction',
    'expertTeams.toolBrowser',
    'expertTeams.toolTerminal',
    'expertTeams.toolWebSearch',
    'expertTeams.toolFileOps',
    'expertTeams.toolSkills',
    'expertTeams.toolOpenClaw',
  ]) {
    assert.match(toolBlock, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const hardcoded of ['系统工具', '流程控制', '交互工具', '浏览器', '联网搜索', '文件操作', '技能管理']) {
    assert.doesNotMatch(toolBlock, new RegExp(hardcoded))
  }
  assert.match(page, /function toolCategoryOptions\(\)[\s\S]*name:\s*t\(item\.nameKey\)[\s\S]*desc:\s*t\(item\.descKey\)/)
  assert.match(page, /renderTagPicker\('expert-tools',\s*t\('expertTeams\.tools'\),\s*toolCategoryOptions\(\)/)
  assert.doesNotMatch(page, /renderTagPicker\('expert-tools',\s*t\('expertTeams\.tools'\),\s*TOOL_CATEGORIES/)
})

test('Expert Teams locale defines every tool domain label and description', () => {
  for (const key of [
    'toolSystem',
    'toolSystemDesc',
    'toolProcess',
    'toolProcessDesc',
    'toolInteraction',
    'toolInteractionDesc',
    'toolBrowser',
    'toolBrowserDesc',
    'toolTerminal',
    'toolTerminalDesc',
    'toolWebSearch',
    'toolWebSearchDesc',
    'toolFileOps',
    'toolFileOpsDesc',
    'toolSkills',
    'toolSkillsDesc',
    'toolOpenClaw',
    'toolOpenClawDesc',
  ]) {
    assert.match(locale, new RegExp(`${key}:\\s*_\\(`), `${key} should be translated`)
  }
})
