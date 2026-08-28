import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  cleanupDeletedModelReferences,
  cleanupDeletedProviderReferences,
  normalizeProviderUrls,
  normalizeMaxConcurrent,
  normalizeDefaultModelSelection,
  rotateFallbackChain,
  getSamplingConfig,
  applySamplingConfig,
} from '../src/pages/models.js'

const modelsPageSource = readFileSync(new URL('../src/pages/models.js', import.meta.url), 'utf8')
const modelsCssSource = readFileSync(new URL('../src/style/pages/models.css', import.meta.url), 'utf8')

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

test('OpenClaw model page removes deleted model references and promotes a remaining model', () => {
  const state = {
    config: {
      models: {
        providers: {
          qtcool: { models: [{ id: 'backup' }] },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'qtcool/main',
            fallbacks: ['qtcool/backup', 'qtcool/main'],
          },
        },
      },
    },
  }

  cleanupDeletedModelReferences(state, ['qtcool/main'])

  assert.equal(state.config.agents.defaults.model.primary, 'qtcool/backup')
  assert.deepEqual(state.config.agents.defaults.model.fallbacks, [])
})

test('OpenClaw model page removes deleted provider references', () => {
  const state = {
    config: {
      models: {
        providers: {
          openai: { models: [{ id: 'gpt-4o' }] },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'qtcool/main',
            fallbacks: ['qtcool/backup', 'openai/gpt-4o'],
          },
        },
      },
    },
  }

  cleanupDeletedProviderReferences(state, 'qtcool')

  assert.equal(state.config.agents.defaults.model.primary, 'openai/gpt-4o')
  assert.deepEqual(state.config.agents.defaults.model.fallbacks, [])
})

test('OpenClaw model page clamps max concurrent agent sessions', () => {
  assert.equal(normalizeMaxConcurrent('8'), 8)
  assert.equal(normalizeMaxConcurrent(0), 1)
  assert.equal(normalizeMaxConcurrent(200), 100)
  assert.equal(normalizeMaxConcurrent('not-a-number'), 4)
  assert.equal(normalizeMaxConcurrent('not-a-number', 2), 2)
})

test('OpenClaw model page preserves custom provider endpoint paths when saving', () => {
  const config = {
    models: {
      providers: {
        custom: {
          api: 'openai-completions',
          baseUrl: ' https://provider.example.com/custom/v3/chat/completions/ ',
          models: [{ id: 'chat-model' }],
        },
        anthropic: {
          api: 'anthropic-messages',
          baseUrl: 'https://proxy.example.com/messages/',
          models: [{ id: 'claude' }],
        },
      },
    },
  }

  normalizeProviderUrls(config)

  assert.equal(config.models.providers.custom.baseUrl, 'https://provider.example.com/custom/v3/chat/completions')
  assert.equal(config.models.providers.anthropic.baseUrl, 'https://proxy.example.com/messages')
})

test('OpenClaw provider tabs keep provider actions outside the horizontal scroll area', () => {
  assert.match(modelsPageSource, /models-provider-tabs-shell/)
  assert.match(modelsPageSource, /<div class="models-provider-tabs">[\s\S]*<\/div>\s*\$\{providerFilter !== 'all'/)

  const shellRule = modelsCssSource.match(/\.models-provider-tabs-shell\s*\{[^}]+\}/)?.[0] || ''
  const tabsRule = modelsCssSource.match(/\.models-provider-tabs\s*\{[^}]+\}/)?.[0] || ''
  const actionsRule = modelsCssSource.match(/\.models-provider-tab-actions\s*\{[^}]+\}/)?.[0] || ''

  assert.match(shellRule, /display:\s*flex/)
  assert.match(shellRule, /width:\s*100%/)
  assert.match(tabsRule, /flex:\s*1 1 0/)
  assert.match(tabsRule, /min-width:\s*0/)
  assert.match(actionsRule, /flex:\s*0 0 auto/)
  assert.doesNotMatch(actionsRule, /position:\s*sticky/)
})

test('OpenClaw sampling settings stay unset until explicitly filled', () => {
  const config = {
    models: { providers: { openai: { models: [{ id: 'gpt-4o' }] } } },
    agents: { defaults: { models: {} } },
  }

  assert.deepEqual(getSamplingConfig(config), { temperature: undefined, top_p: undefined, top_k: undefined })
  applySamplingConfig(config, { temperature: undefined, top_p: undefined, top_k: 0 })
  assert.deepEqual(config.agents.defaults.models, {})

  applySamplingConfig(config, { temperature: 0, top_p: 0, top_k: 12 })
  assert.deepEqual(config.agents.defaults.models['openai/gpt-4o'], { temperature: 0, top_p: 0, top_k: 12 })

  applySamplingConfig(config, { temperature: undefined, top_p: undefined, top_k: 0 })
  assert.deepEqual(config.agents.defaults.models, {})
})
