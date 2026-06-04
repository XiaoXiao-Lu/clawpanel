import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeDefaultModelSelection,
  rotateFallbackChain,
} from '../src/pages/models.js'

test('OpenClaw model page preserves JSON-edited fallback entries during normalize', () => {
  const config = {
    models: {
      providers: {
        openrouter: {
          models: [{ id: 'anthropic/claude-sonnet-4-6' }],
        },
      },
    },
    agents: {
      defaults: {
        model: {
          primary: 'manual-provider/manual-primary',
          fallbacks: [
            'manual-provider/manual-fallback',
            'openrouter/anthropic/claude-sonnet-4-6',
            'manual-provider/manual-fallback',
          ],
        },
        models: {
          'manual-provider/manual-fallback': { temperature: 0.2 },
        },
      },
    },
  }

  const result = normalizeDefaultModelSelection(config)

  assert.equal(result.primary, 'manual-provider/manual-primary')
  assert.deepEqual(config.agents.defaults.model.fallbacks, [
    'manual-provider/manual-fallback',
    'openrouter/anthropic/claude-sonnet-4-6',
  ])
  assert.deepEqual(config.agents.defaults.models['manual-provider/manual-fallback'], { temperature: 0.2 })
  assert.deepEqual(config.agents.defaults.models['manual-provider/manual-primary'], {})
})

test('OpenClaw model page keeps unknown fallbacks when changing primary model', () => {
  const state = {
    config: {
      models: {
        providers: {
          qtcool: { models: [{ id: 'new-main' }] },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'old-provider/old-main',
            fallbacks: ['manual-provider/manual-fallback', 'qtcool/new-main'],
          },
        },
      },
    },
  }

  state.config.agents.defaults.model.primary = 'qtcool/new-main'
  rotateFallbackChain(state, 'old-provider/old-main', 'qtcool/new-main')

  assert.deepEqual(state.config.agents.defaults.model.fallbacks, [
    'manual-provider/manual-fallback',
    'old-provider/old-main',
  ])
})
