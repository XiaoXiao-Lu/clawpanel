import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExpertMessages, buildExpertTeamPlan, buildModeratorMessages, isolateExpertTeamModelConfig, resolveDefaultModelSlot, resolveExpertModelSlot, resolveMaxParallel, resolveMembers } from '../src/lib/expert-team-runner.js'

const experts = [
  { id: 'planner', name: 'Planner', title: 'Product Planner', enabled: true, systemPrompt: 'Plan product work.' },
  { id: 'reviewer', name: 'Reviewer', title: 'Risk Reviewer', enabled: true, systemPrompt: 'Review risk.' },
  { id: 'disabled', name: 'Disabled', enabled: false },
]

const group = {
  id: 'product-panel',
  name: 'Product Panel',
  mode: 'review',
  moderatorExpertId: 'reviewer',
  members: [
    { expertId: 'reviewer', order: 2 },
    { expertId: 'planner', order: 1 },
    { expertId: 'disabled', order: 3 },
  ],
}

test('expert team plan resolves ordered enabled members and moderator', () => {
  const plan = buildExpertTeamPlan({ group, experts, task: 'Design the first runtime slice.' })
  assert.deepEqual(plan.members.map(expert => expert.id), ['planner', 'reviewer'])
  assert.equal(plan.moderator.id, 'reviewer')
  assert.equal(plan.blackboard.length, 0)
})

test('expert prompts include task, role, communication protocol, and blackboard', () => {
  const plan = buildExpertTeamPlan({ group, experts, task: 'Ship expert team runtime.' })
  const messages = buildExpertMessages({
    plan,
    expert: plan.members[1],
    previous: [{ expertName: 'Planner', content: 'Use sequential first.' }],
  })
  assert.equal(messages[0].role, 'system')
  assert.match(messages[0].content, /Communication protocol/)
  assert.match(messages[1].content, /Ship expert team runtime/)
  assert.match(messages[1].content, /Shared blackboard/)
  assert.match(messages[1].content, /Use sequential first/)
})

test('moderator prompt synthesizes all expert contributions', () => {
  const plan = buildExpertTeamPlan({ group, experts, task: 'Pick architecture.' })
  const messages = buildModeratorMessages({
    plan,
    contributions: [
      { expertName: 'Planner', content: 'Start simple.' },
      { expertName: 'Reviewer', content: 'Track risks.' },
    ],
  })
  assert.match(messages[0].content, /Moderator protocol/)
  assert.match(messages[1].content, /Expert blackboard/)
  assert.match(messages[1].content, /Start simple/)
  assert.match(messages[1].content, /Track risks/)
})

test('default OpenClaw model slot resolves provider and primary model', () => {
  const slot = resolveDefaultModelSlot(modelConfig())
  assert.equal(slot.provider, 'newapi')
  assert.equal(slot.model, 'claude-opus-4-6')
  assert.equal(slot.baseUrl, 'https://example.test/v1')
})

test('expert model slot inherits default or uses fixed provider/model', () => {
  const config = modelConfig()
  const fallback = resolveDefaultModelSlot(config)
  const inherited = resolveExpertModelSlot(config, experts[0], fallback)
  const fixed = resolveExpertModelSlot(config, {
    ...experts[1],
    model: { inheritDefault: false, modelId: 'deepseek/deepseek-chat' },
  }, fallback)
  assert.equal(inherited.provider, 'newapi')
  assert.equal(inherited.source, 'default')
  assert.equal(fixed.provider, 'deepseek')
  assert.equal(fixed.model, 'deepseek-chat')
  assert.equal(fixed.source, 'expert')
  assert.equal(fixed.baseUrl, 'https://deepseek.example/v1')
})

test('expert fixed model requires provider/model', () => {
  assert.throws(() => resolveExpertModelSlot(modelConfig(), {
    ...experts[1],
    model: { inheritDefault: false, modelId: 'bad-model-name' },
  }), /provider\/model/)
})

test('expert team runtime isolates model config from channels and bindings', () => {
  const fullConfig = {
    ...modelConfig(),
    agents: {
      defaults: modelConfig().agents.defaults,
      list: [{ id: 'main', workspace: 'C:/Users/Kinnon/.openclaw/workspace' }],
    },
    bindings: [{ type: 'route', agentId: 'main', match: { channel: 'openclaw-weixin' } }],
    channels: { 'openclaw-weixin': { enabled: true } },
    session: { dmScope: 'per-channel-peer' },
  }
  const isolated = isolateExpertTeamModelConfig(fullConfig)
  assert.deepEqual(Object.keys(isolated).sort(), ['agents', 'models'])
  assert.equal(isolated.channels, undefined)
  assert.equal(isolated.bindings, undefined)
  assert.equal(isolated.session, undefined)
  assert.equal(isolated.agents.list, undefined)
  assert.equal(resolveDefaultModelSlot(isolated).model, 'claude-opus-4-6')
})

test('resolveMembers skips missing and disabled experts', () => {
  assert.deepEqual(resolveMembers(group, experts).map(expert => expert.id), ['planner', 'reviewer'])
})

test('resolveMaxParallel clamps unsafe team settings', () => {
  assert.equal(resolveMaxParallel({ maxParallel: 3 }), 3)
  assert.equal(resolveMaxParallel({ maxParallel: 0 }), 1)
  assert.equal(resolveMaxParallel({ maxParallel: 99 }), 8)
  assert.equal(resolveMaxParallel({}), 1)
})

function modelConfig() {
  return {
    agents: { defaults: { model: { primary: 'newapi/claude-opus-4-6' } } },
    models: {
      providers: {
        newapi: {
          api: 'openai-completions',
          baseUrl: 'https://example.test/v1/chat/completions',
          apiKey: 'secret',
          models: ['claude-opus-4-6'],
        },
        deepseek: {
          api: 'openai-completions',
          baseUrl: 'https://deepseek.example/v1/chat/completions',
          apiKey: 'secret',
          models: ['deepseek-chat'],
        },
      },
    },
  }
}
