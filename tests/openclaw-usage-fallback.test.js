import test from 'node:test'
import assert from 'node:assert/strict'

import { buildUsageFromSessionsList } from '../src/pages/usage.js'

test('OpenClaw usage page aggregates sessions.list fallback data', () => {
  const data = buildUsageFromSessionsList({
    sessions: [
      {
        key: 'agent:main:chat-1',
        agentId: 'main',
        model: 'openai/gpt-4.1',
        modelProvider: 'openai',
        updatedAt: '2026-07-25T10:00:00+08:00',
        usage: {
          input_tokens: 1200,
          output_tokens: 800,
          total_cost: 0.03,
          message_counts: { total: 4, user: 2, assistant: 2 },
        },
      },
      {
        key: 'agent:writer:chat-2',
        agent_id: 'writer',
        model_provider: 'deepseek',
        updated_at: '2026-07-25T11:00:00+08:00',
        usage: {
          model_usage: [{ model: 'deepseek-chat', provider: 'deepseek' }],
          inputTokens: 300,
          outputTokens: 700,
          totalCost: 0.01,
          messageCounts: { total: 2, user: 1, assistant: 1 },
        },
      },
    ],
  }, { startDate: '2026-07-25', endDate: '2026-07-25' })

  assert.equal(data.totals.input, 1500)
  assert.equal(data.totals.output, 1500)
  assert.equal(data.totals.totalTokens, 3000)
  assert.equal(data.totals.totalCost, 0.04)
  assert.equal(data.aggregates.messages.total, 6)
  assert.equal(data.aggregates.byModel[0].model, 'openai/gpt-4.1')
  assert.equal(data.aggregates.byProvider[0].provider, 'openai')
  assert.equal(data.aggregates.daily[0].date, '2026-07-25')
  assert.equal(data.aggregates.daily[0].tokens, 3000)
  assert.equal(data.sessions.length, 2)
})
