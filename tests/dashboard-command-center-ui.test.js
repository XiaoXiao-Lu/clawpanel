import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { countMcpServers } from '../src/lib/mcp-config.js'

const dashboardJs = readFileSync(new URL('../src/pages/dashboard.js', import.meta.url), 'utf8')
const pagesCss = readFileSync(new URL('../src/style/pages.css', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return pagesCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('dashboard renders the command center before stat cards', () => {
  const commandCenterIndex = dashboardJs.indexOf('id="dashboard-command-center"')
  const statCardsIndex = dashboardJs.indexOf('id="stat-cards"')
  assert.ok(commandCenterIndex > 0, 'Dashboard should include a command center mount')
  assert.ok(statCardsIndex > commandCenterIndex, 'Command center should appear before detailed stat cards')
  assert.match(dashboardJs, /function renderCommandCenter/, 'Dashboard should render a synthesized health summary')
})

test('dashboard next action keeps mobile touch target size', () => {
  const block = cssBlock('.dashboard-next-action')
  assert.match(block, /min-height:\s*46px/, 'Primary next action should be at least 44px tall')
  assert.match(block, /width:\s*100%/, 'Primary next action should use the available touch area')
})

test('dashboard mobile controls preserve 44px touch targets', () => {
  assert.match(pagesCss, /\.dashboard-next-action,\s*\n\s*\.quick-actions \.btn\s*\{[^}]*min-height:\s*44px/s)
})

test('dashboard counts common MCP config shapes', () => {
  assert.equal(countMcpServers({ mcpServers: { fs: {}, git: {} } }), 2)
  assert.equal(countMcpServers({ servers: { fs: {}, git: {}, time: {} } }), 3)
  assert.equal(countMcpServers({ fs: { command: 'uvx' }, git: { url: 'https://example.com' }, note: 'ignore' }), 2)
  assert.equal(countMcpServers(null), 0)
})
