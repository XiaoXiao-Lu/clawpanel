import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExpertMessages, buildExpertTeamPlan, buildModeratorMessages, dedupeResumeContributions, extractChatMessageContent, isolateExpertTeamModelConfig, parseProxyBody, resolveDefaultModelSlot, resolveExpertModelSlot, resolveMaxParallel, resolveMaxRounds, resolveMembers, resumeExpertTeamRun, resumeExpertTeamSynthesis } from '../src/lib/expert-team-runner.js'

const experts = [
  {
    id: 'planner',
    name: 'Planner',
    title: 'Product Planner',
    enabled: true,
    systemPrompt: 'Plan product work.',
    tools: ['webSearch'],
    skills: ['playwright-cli'],
    knowledgeRefs: ['prd://expert-team'],
    outputSchema: 'Return bullets.',
  },
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
    expert: plan.members[0],
    previous: [{ expertName: 'Planner', content: 'Use sequential first.' }],
  })
  assert.equal(messages[0].role, 'system')
  assert.match(messages[0].content, /Communication protocol/)
  assert.match(messages[0].content, /Mode guidance: cross review/)
  assert.match(messages[0].content, /Declared capability context/)
  assert.match(messages[0].content, /webSearch/)
  assert.match(messages[0].content, /playwright-cli/)
  assert.match(messages[0].content, /prd:\/\/expert-team/)
  assert.match(messages[0].content, /Return bullets/)
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

test('chat content extraction supports reasoning and structured provider responses', () => {
  assert.equal(extractChatMessageContent({
    choices: [{ message: { reasoning_content: 'Reasoning-only answer.' } }],
  }), 'Reasoning-only answer.')

  assert.equal(extractChatMessageContent({
    choices: [{ message: { content: [{ type: 'text', text: 'Part A' }, { text: ' Part B' }] } }],
  }), 'Part A Part B')

  assert.equal(extractChatMessageContent({
    output_text: 'Responses API text.',
  }), 'Responses API text.')

  assert.equal(extractChatMessageContent({
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Nested output.' }] }],
  }), 'Nested output.')
})

test('proxy body parsing unwraps object bodies and preserves upstream errors', () => {
  const parsed = parseProxyBody({
    ok: true,
    status: 200,
    body: {
      choices: [{ message: { content: 'Wrapped body answer.' } }],
    },
  })
  assert.equal(extractChatMessageContent(parsed), 'Wrapped body answer.')

  assert.throws(
    () => parseProxyBody({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      body: { error: { message: 'invalid api key' } },
    }),
    /API error 401: invalid api key/
  )

  assert.throws(
    () => parseProxyBody({
      ok: false,
      status: 502,
      body: 'bad gateway',
    }),
    /API error 502: bad gateway/
  )
})

test('resume synthesis validates plan and existing contributions before model calls', async () => {
  await assert.rejects(
    () => resumeExpertTeamSynthesis({ plan: null, contributions: [{ content: 'Keep this.' }] }),
    /Expert team plan is required/
  )
  await assert.rejects(
    () => resumeExpertTeamSynthesis({ plan: { task: 'Pick architecture.' }, contributions: [] }),
    /No expert contributions available to resume synthesis/
  )
})

test('resume run validates source plan before model calls', async () => {
  await assert.rejects(
    () => resumeExpertTeamRun({ plan: null, contributions: [{ content: 'Keep this.' }], experts }),
    /Expert team plan is required to resume run/
  )
})

test('resume contributions are deduped by expert and sequential round', () => {
  const deduped = dedupeResumeContributions([
    { id: 'a1', expertId: 'planner', expertName: 'Planner', round: 1, content: 'First planner draft.' },
    { id: 'a2', expertId: 'planner', expertName: 'Planner', round: 1, content: 'Duplicate planner draft.' },
    { id: 'b1', expertId: 'reviewer', expertName: 'Reviewer', round: 1, content: 'Reviewer risk note.' },
    { id: 'c1', expertId: 'planner', expertName: 'Planner', round: 2, content: 'Second-round planner draft.' },
    { id: 'empty', expertId: 'empty', expertName: 'Empty', round: 1, content: '   ' },
  ], { sequential: true })

  assert.deepEqual(deduped.map(item => item.id), ['a1', 'b1', 'c1'])
  assert.deepEqual(deduped.map(item => `${item.expertId}:${item.round}`), ['planner:1', 'reviewer:1', 'planner:2'])
})

test('resume contributions are deduped by expert for parallel teams', () => {
  const deduped = dedupeResumeContributions([
    { id: 'first', expertId: 'planner', expertName: 'Planner', round: 1, content: 'Planner draft.' },
    { id: 'duplicate', expertId: 'planner', expertName: 'Planner', round: 2, content: 'Same parallel expert again.' },
    { id: 'fallback-id', expertName: 'Reviewer', content: 'Reviewer note.' },
  ])

  assert.deepEqual(deduped.map(item => item.id), ['first', 'fallback-id'])
  assert.deepEqual(deduped.map(item => item.expertId || item.expertName), ['planner', 'Reviewer'])
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

test('resolveMaxRounds clamps unsafe sequential settings', () => {
  assert.equal(resolveMaxRounds({ maxRounds: 3 }), 3)
  assert.equal(resolveMaxRounds({ maxRounds: 0 }), 1)
  assert.equal(resolveMaxRounds({ maxRounds: 99 }), 10)
  assert.equal(resolveMaxRounds({}), 1)
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
