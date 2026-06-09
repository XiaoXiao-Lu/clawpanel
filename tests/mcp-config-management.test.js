import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMcpConfigWithServers,
  getMcpConfigShape,
  normalizeMcpServers,
  summarizeMcpConfig,
  validateMcpServer,
} from '../src/lib/mcp-config.js'

test('MCP config manager normalizes common wrapper shapes', () => {
  const wrapped = normalizeMcpServers({
    mcpServers: {
      fs: { command: 'npx', args: ['-y', 'server-filesystem'] },
      remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
    },
  })
  assert.equal(wrapped.length, 2)
  assert.equal(wrapped.find(s => s.id === 'fs').transport, 'stdio')
  assert.equal(wrapped.find(s => s.id === 'remote').transport, 'http')
  assert.equal(wrapped.find(s => s.id === 'remote').secretCount, 1)

  const topLevel = normalizeMcpServers({
    fs: { command: 'uvx' },
    note: 'ignored',
  })
  assert.deepEqual(topLevel.map(s => s.id), ['fs'])
})

test('MCP config manager validates server safety and shape issues', () => {
  assert.deepEqual(validateMcpServer('bad id', { command: '' }).issues, ['invalid_id', 'unknown_transport'])
  assert.deepEqual(validateMcpServer('remote', { url: 'not a url' }).issues, ['invalid_url'])
  assert.deepEqual(validateMcpServer('fs', { command: 'npx', args: '--bad' }).issues, ['invalid_args'])
  assert.deepEqual(validateMcpServer('ok', { command: 'npx', args: ['-y'] }).issues, [])
})

test('MCP config manager preserves mcpServers wrapper and unknown root fields', () => {
  const base = {
    version: 1,
    mcpServers: {
      fs: { command: 'npx', args: ['old'], metadata: { owner: 'ops' } },
    },
  }
  const shape = getMcpConfigShape(base)
  const next = buildMcpConfigWithServers(base, [
    { id: 'fs', raw: { command: 'npx', args: ['new'], metadata: { owner: 'ops' } } },
    { id: 'git', raw: { command: 'uvx', disabled: true } },
  ], shape)
  assert.equal(next.version, 1)
  assert.ok(next.mcpServers)
  assert.deepEqual(Object.keys(next.mcpServers), ['fs', 'git'])
  assert.deepEqual(next.mcpServers.fs.metadata, { owner: 'ops' })
})

test('MCP config manager preserves top-level server map shape', () => {
  const base = {
    fs: { command: 'npx' },
    git: { command: 'uvx' },
    note: 'keep me',
  }
  const next = buildMcpConfigWithServers(base, [
    { id: 'git', raw: { command: 'uvx', args: ['mcp-server-git'] } },
  ], getMcpConfigShape(base))
  assert.equal(next.note, 'keep me')
  assert.equal(next.fs, undefined)
  assert.deepEqual(next.git.args, ['mcp-server-git'])
  assert.equal(next.mcpServers, undefined)
})

test('MCP config summary tracks enabled, review, transport, and secret counts', () => {
  const summary = summarizeMcpConfig({
    mcpServers: {
      fs: { command: 'npx' },
      remote: { url: 'ftp://example.com/mcp', headers: { Authorization: 'Bearer x' } },
      disabled: { command: 'uvx', disabled: true },
    },
  })
  assert.equal(summary.total, 3)
  assert.equal(summary.enabled, 2)
  assert.equal(summary.disabled, 1)
  assert.equal(summary.stdio, 2)
  assert.equal(summary.http, 1)
  assert.equal(summary.needsReview, 1)
  assert.equal(summary.secrets, 1)
})
