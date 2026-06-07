import { api } from './tauri-api.js'

const DEFAULT_TEMPERATURE = 0.3

export function buildExpertTeamPlan({ group, experts, task }) {
  const members = resolveMembers(group, experts)
  const moderator = resolveModerator(group, members)
  const cleanedTask = String(task || '').trim()
  if (!cleanedTask) throw new Error('Task is required')
  if (!members.length) throw new Error('Expert team has no enabled members')
  return {
    id: `run-${Date.now()}`,
    task: cleanedTask,
    group: group || {},
    members,
    moderator,
    blackboard: [],
  }
}

export async function runExpertTeam({ group, experts, task, onEvent, signal } = {}) {
  const config = await api.readOpenclawConfig()
  const defaultSlot = resolveDefaultModelSlot(config)
  const plan = buildExpertTeamPlan({ group, experts, task })
  emit(onEvent, { type: 'start', plan: summarizePlan(plan, defaultSlot, config) })

  const contributions = []
  for (const batch of chunk(plan.members, resolveMaxParallel(plan.group))) {
    throwIfAborted(signal)
    const previous = contributions.slice()
    const entries = batch.map(expert => ({
      expert,
      slot: resolveExpertModelSlot(config, expert, defaultSlot),
    }))
    for (const { expert, slot } of entries) {
      emit(onEvent, { type: 'expert_start', expertId: expert.id, expertName: expert.name || expert.id, model: summarizeSlot(slot) })
    }
    const batchResults = await Promise.all(entries.map(async ({ expert, slot }) => {
      const messages = buildExpertMessages({ plan, expert, previous })
      const content = await callChatModel(slot, messages, { maxTokens: 1800 })
      throwIfAborted(signal)
      return {
        role: 'expert',
        expertId: expert.id,
        expertName: expert.name || expert.id,
        content,
        model: summarizeSlot(slot),
        createdAt: new Date().toISOString(),
      }
    }))
    for (const contribution of batchResults) {
      contribution.id = `msg-${contributions.length + 1}`
      contributions.push(contribution)
      plan.blackboard.push(contribution)
      emit(onEvent, { type: 'expert_done', message: contribution })
    }
  }

  throwIfAborted(signal)
  const moderatorSlot = resolveExpertModelSlot(config, plan.moderator, defaultSlot)
  emit(onEvent, { type: 'moderator_start', expertId: plan.moderator?.id || '', model: summarizeSlot(moderatorSlot) })
  const finalMessages = buildModeratorMessages({ plan, contributions })
  const final = await callChatModel(moderatorSlot, finalMessages, { maxTokens: 2600 })
  throwIfAborted(signal)
  const finalMessage = {
    id: `msg-${contributions.length + 1}`,
    role: 'moderator',
    expertId: plan.moderator?.id || '',
    expertName: plan.moderator?.name || 'Moderator',
    content: final,
    model: summarizeSlot(moderatorSlot),
    createdAt: new Date().toISOString(),
  }
  plan.blackboard.push(finalMessage)
  emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard })
  return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
}

export function buildExpertMessages({ plan, expert, previous = [] }) {
  return [
    { role: 'system', content: expertSystemPrompt(plan, expert) },
    { role: 'user', content: expertUserPrompt(plan, expert, previous) },
  ]
}

export function buildModeratorMessages({ plan, contributions = [] }) {
  const moderator = plan.moderator || {}
  return [
    { role: 'system', content: moderatorSystemPrompt(plan, moderator) },
    { role: 'user', content: moderatorUserPrompt(plan, contributions) },
  ]
}

export function resolveDefaultModelSlot(config = {}) {
  const primary = config?.agents?.defaults?.model?.primary || ''
  const providers = config?.models?.providers || {}
  let providerKey = ''
  let model = ''
  if (primary.includes('/')) {
    const parts = primary.split('/')
    providerKey = parts.shift()
    model = parts.join('/')
  }
  if (!providerKey || !providers[providerKey]) {
    providerKey = Object.keys(providers)[0] || ''
    model = providerModels(providers[providerKey])[0] || model
  }
  const provider = providers[providerKey] || {}
  if (!providerKey || !provider?.baseUrl || !model) {
    throw new Error('OpenClaw default model is not configured')
  }
  return {
    provider: providerKey,
    baseUrl: cleanBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey || '',
    apiType: normalizeApiType(provider.api),
    model,
    source: 'default',
  }
}

export function resolveExpertModelSlot(config = {}, expert = {}, defaultSlot = null) {
  const fallback = defaultSlot || resolveDefaultModelSlot(config)
  const modelConfig = expert?.model && typeof expert.model === 'object' ? expert.model : {}
  const fixedRef = String(modelConfig.modelId || '').trim()
  if (modelConfig.inheritDefault !== false || !fixedRef) return { ...fallback, source: 'default' }

  const parsed = parseModelRef(fixedRef)
  if (!parsed.provider || !parsed.model) {
    throw new Error(`Expert ${expert?.name || expert?.id || ''} fixed model must use provider/model`)
  }
  const provider = config?.models?.providers?.[parsed.provider]
  if (!provider?.baseUrl) {
    throw new Error(`Expert ${expert?.name || expert?.id || ''} fixed model provider is not configured: ${parsed.provider}`)
  }
  return {
    provider: parsed.provider,
    baseUrl: cleanBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey || '',
    apiType: normalizeApiType(provider.api),
    model: parsed.model,
    source: 'expert',
  }
}

export function resolveMembers(group = {}, experts = []) {
  const byId = new Map(experts.map(expert => [expert.id, expert]))
  return (Array.isArray(group.members) ? group.members : [])
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map(member => byId.get(member.expertId))
    .filter(expert => expert && expert.enabled !== false)
}

export function resolveMaxParallel(group = {}) {
  const parsed = Number.parseInt(group.maxParallel, 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(parsed, 8))
}

function resolveModerator(group = {}, members = []) {
  return members.find(expert => expert.id === group.moderatorExpertId) || members[0] || null
}

function expertSystemPrompt(plan, expert) {
  return [
    expert.systemPrompt || `You are ${expert.name || expert.id}, ${expert.title || 'a domain expert'}.`,
    '',
    'You are participating in an expert team run.',
    'Communication protocol:',
    '1. Work independently from your role.',
    '2. Use the shared blackboard only as context.',
    '3. Produce concise, actionable output.',
    '4. Include assumptions, risks, and concrete recommendations.',
    expert.outputSchema ? `Required output format:\n${expert.outputSchema}` : '',
  ].filter(Boolean).join('\n')
}

function expertUserPrompt(plan, expert, previous) {
  return [
    `Team: ${plan.group.name || plan.group.id || 'Expert Team'}`,
    `Mode: ${plan.group.mode || 'panel'}`,
    `Task:\n${plan.task}`,
    '',
    `Your role: ${expert.name || expert.id}${expert.title ? ` (${expert.title})` : ''}`,
    previous.length ? `Shared blackboard so far:\n${formatMessages(previous)}` : 'Shared blackboard so far: empty',
    '',
    'Respond as this expert only. Do not synthesize the final answer unless you are the moderator.',
  ].join('\n')
}

function moderatorSystemPrompt(plan, moderator) {
  return [
    moderator.systemPrompt || `You are ${moderator.name || 'the moderator'}, responsible for synthesizing expert input.`,
    '',
    'Moderator protocol:',
    '1. Compare expert contributions, resolve conflicts, and preserve dissenting risks.',
    '2. Produce a final answer the user can act on.',
    '3. Be explicit about tradeoffs and next steps.',
  ].join('\n')
}

function moderatorUserPrompt(plan, contributions) {
  return [
    `Team: ${plan.group.name || plan.group.id || 'Expert Team'}`,
    `Mode: ${plan.group.mode || 'panel'}`,
    `Original task:\n${plan.task}`,
    '',
    `Expert blackboard:\n${formatMessages(contributions)}`,
    '',
    'Synthesize the final team output. Include key decisions, reasoning, risks, and concrete next actions.',
  ].join('\n')
}

function formatMessages(messages) {
  return messages.map(msg => {
    const speaker = msg.expertName || msg.expertId || msg.role || 'expert'
    return `### ${speaker}\n${msg.content || ''}`
  }).join('\n\n')
}

async function callChatModel(slot, messages, opts = {}) {
  if (slot.apiType !== 'openai-completions') {
    throw new Error(`Expert team runtime currently supports OpenAI-compatible Chat Completions only: ${slot.provider}/${slot.model}`)
  }
  const body = {
    model: slot.model,
    messages,
    temperature: DEFAULT_TEMPERATURE,
    max_tokens: opts.maxTokens || 2000,
  }
  const result = await api.modelChatCompletionsProxy(slot.baseUrl, slot.apiKey || '', slot.apiType, body)
  const parsed = parseProxyBody(result)
  const content = parsed?.choices?.[0]?.message?.content || parsed?.choices?.[0]?.text || ''
  if (!content.trim()) throw new Error('Model returned an empty expert response')
  return content.trim()
}

function parseProxyBody(result) {
  if (result && typeof result === 'object' && result.choices) return result
  const body = typeof result?.body === 'string' ? result.body : JSON.stringify(result || {})
  return JSON.parse(body)
}

function summarizePlan(plan, slot, config = {}) {
  return {
    id: plan.id,
    task: plan.task,
    groupId: plan.group.id || '',
    groupName: plan.group.name || '',
    mode: plan.group.mode || 'panel',
    maxParallel: resolveMaxParallel(plan.group),
    members: plan.members.map(expert => ({
      id: expert.id,
      name: expert.name || expert.id,
      title: expert.title || '',
      model: summarizeSlot(resolveExpertModelSlot(config, expert, slot)),
    })),
    moderator: plan.moderator ? {
      id: plan.moderator.id,
      name: plan.moderator.name || plan.moderator.id,
      model: summarizeSlot(resolveExpertModelSlot(config, plan.moderator, slot)),
    } : null,
    model: summarizeSlot(slot),
  }
}

function providerModels(provider = {}) {
  return (Array.isArray(provider.models) ? provider.models : [])
    .map(model => typeof model === 'string' ? model : model?.id)
    .filter(Boolean)
}

function normalizeApiType(raw) {
  const type = String(raw || '').trim()
  if (type === 'anthropic' || type === 'anthropic-messages') return 'anthropic-messages'
  if (type === 'google-gemini' || type === 'google-generative-ai') return 'google-generative-ai'
  if (type === 'ollama') return 'ollama'
  return 'openai-completions'
}

function cleanBaseUrl(raw) {
  let base = String(raw || '').trim().replace(/\/+$/, '')
  base = base.replace(/\/chat\/completions\/?$/, '')
  base = base.replace(/\/models\/?$/, '')
  if (/:(11434)$/i.test(base) && !base.endsWith('/v1')) return `${base}/v1`
  return base
}

function parseModelRef(raw) {
  const text = String(raw || '').trim()
  const slash = text.indexOf('/')
  if (slash <= 0 || slash === text.length - 1) return { provider: '', model: '' }
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
}

function summarizeSlot(slot = {}) {
  return {
    provider: slot.provider || '',
    model: slot.model || '',
    apiType: slot.apiType || 'openai-completions',
    source: slot.source || 'default',
  }
}

function emit(onEvent, event) {
  if (typeof onEvent === 'function') onEvent(event)
}

function chunk(items, size) {
  const batches = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw new DOMException('Expert team run stopped', 'AbortError')
}
