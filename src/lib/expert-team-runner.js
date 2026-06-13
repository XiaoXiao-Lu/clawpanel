import { api } from './tauri-api.js'

const DEFAULT_TEMPERATURE = 0.3
const DEFAULT_RETRY_ATTEMPTS = 1
const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes per expert call
const ALL_EXPERTS_EMPTY_LABEL = '专家团没有收到可用的专家回复'

// 独立 ID 计数器，避免依赖 blackboard.length 导致 ID 不连续
let _msgSeq = 0
function nextMsgId(prefix = 'msg') {
  return `${prefix}-${++_msgSeq}`
}

const COLLABORATION_GUIDANCE = {
  panel: [
    'Mode guidance: expert panel consultation.',
    '- Provide a focused diagnosis from your discipline.',
    '- Make uncertainties and recommended checks explicit.',
  ],
  creation: [
    'Mode guidance: team creation.',
    '- Contribute concrete ideas, structure, examples, or implementation details.',
    '- Prefer useful draft material over abstract commentary.',
  ],
  debate: [
    'Mode guidance: debate review.',
    '- Challenge weak assumptions and name the strongest counterargument.',
    '- Keep disagreement evidence-based and constructive.',
  ],
  review: [
    'Mode guidance: cross review.',
    '- Prioritize defects, regressions, edge cases, and missing validation.',
    '- Separate must-fix risks from polish suggestions.',
  ],
  research: [
    'Mode guidance: parallel research.',
    '- Summarize findings with source needs, confidence, and open questions.',
    '- Distinguish observed facts from inference.',
  ],
  sequential: [
    'Mode guidance: sequential chain.',
    '- Advance the previous expert output instead of restarting.',
    '- Preserve useful context and hand off a clear next step.',
  ],
}

export function buildExpertTeamPlan({ group, experts, task, images }) {
  const members = resolveMembers(group, experts)
  const moderator = resolveModerator(group, members)
  const cleanedTask = String(task || '').trim()
  if (!cleanedTask) throw new Error('Task is required')
  if (!members.length) throw new Error('Expert team has no enabled members')
  return {
    id: `run-${Date.now()}`,
    task: cleanedTask,
    images: Array.isArray(images) && images.length ? images : undefined,
    group: group || {},
    members,
    moderator,
    blackboard: [],
  }
}

export async function runExpertTeam({ group, experts, task, images, onEvent, signal, externalSlot, tools, executeTool } = {}) {
  const { config, defaultSlot } = await resolveRunModelContext(externalSlot)
  const plan = buildExpertTeamPlan({ group, experts, task, images })
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
      emit(onEvent, buildExpertRunEvent('expert_start', expert, slot))
    }
    const batchResults = await Promise.allSettled(entries.map(async ({ expert, slot }) => {
      const messages = buildExpertMessages({ plan, expert, previous })
      const content = await callChatModelWithRetry(slot, messages, {
        maxTokens: expertMaxTokens(plan.group, 1800),
        signal,
        ...toolRuntimeOptions({ tools, executeTool, onEvent, owner: 'expert', expert, slot }),
        onDelta: (delta) => emit(onEvent, { ...buildExpertRunEvent('expert_delta', expert, slot), delta }),
        onRetry: (retry) => emit(onEvent, { ...buildExpertRunEvent('expert_retry', expert, slot), ...retry }),
      })
      throwIfAborted(signal)
      return buildExpertContribution({ expert, content, slot })
    }))
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i]
      const { expert, slot } = entries[i]
      if (result.status !== 'fulfilled') {
        throwIfAborted(signal)
        const failure = buildExpertFailure({ expert, slot, error: result.reason })
        plan.blackboard.push(failure)
        emit(onEvent, { type: 'expert_error', message: failure })
        continue
      }
      const contribution = result.value
      contribution.id = nextMsgId('msg')
      contributions.push(contribution)
      plan.blackboard.push(contribution)
      emit(onEvent, { type: 'expert_done', message: contribution })
    }
  }

  throwIfAborted(signal)
  if (!contributions.length) {
    const finalMessage = buildNoExpertResponseFallback({
      plan,
      slot: resolveExpertModelSlot(config, plan.moderator, defaultSlot),
    })
    plan.blackboard.push(finalMessage)
    emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard })
    return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
  }
  const moderatorSlot = resolveExpertModelSlot(config, plan.moderator, defaultSlot)
  emit(onEvent, buildExpertRunEvent('moderator_start', plan.moderator, moderatorSlot))
  const finalMessages = buildModeratorMessages({ plan, contributions })
  const finalMessage = await buildModeratorFinalOrFallback({ plan, contributions, slot: moderatorSlot, messages: finalMessages, signal, onEvent, tools, executeTool })
  plan.blackboard.push(finalMessage)
  emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard })
  return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
}

export async function runExpertTeamSequential({ group, experts, task, images, onEvent, signal, externalSlot, maxRounds, tools, executeTool } = {}) {
  const { config, defaultSlot } = await resolveRunModelContext(externalSlot)

  const runtimeGroup = maxRounds == null ? group : { ...(group || {}), maxRounds }
  const plan = buildExpertTeamPlan({ group: runtimeGroup, experts, task, images })
  emit(onEvent, { type: 'start', plan: summarizePlan(plan, defaultSlot, config) })

  const rounds = resolveMaxRounds(plan.group)
  const contributions = []
  const chainContext = [`## 原始任务\n${plan.task}`]

  for (let round = 0; round < rounds; round++) {
    throwIfAborted(signal)
    if (rounds > 1) {
      emit(onEvent, { type: 'round_start', round: round + 1, total: rounds })
    }

    for (let i = 0; i < plan.members.length; i++) {
      throwIfAborted(signal)
      const expert = plan.members[i]
      const previous = contributions.length ? chainContext[chainContext.length - 1] : plan.task
      const slot = resolveExpertModelSlot(config, expert, defaultSlot)

      emit(onEvent, { ...buildExpertRunEvent('expert_start', expert, slot), round: round + 1 })

      const historyText = chainContext.length > 1 ? chainContext.slice(1).join('\n\n') : ''
      const messages = buildSequentialMessages({ plan, expert, previous, historyText, round, rounds })
      let content
      try {
        content = await callChatModelWithRetry(slot, messages, {
          maxTokens: expertMaxTokens(plan.group, 2000),
          signal,
          ...toolRuntimeOptions({ tools, executeTool, onEvent, owner: 'expert', expert, slot, round: round + 1 }),
          onDelta: (delta) => emit(onEvent, { ...buildExpertRunEvent('expert_delta', expert, slot), round: round + 1, delta }),
          onRetry: (retry) => emit(onEvent, { ...buildExpertRunEvent('expert_retry', expert, slot), round: round + 1, ...retry }),
        })
        throwIfAborted(signal)
      } catch (error) {
        throwIfAborted(signal)
        const failure = buildExpertFailure({ expert, slot, error, round: rounds > 1 ? round + 1 : 1 })
        plan.blackboard.push(failure)
        emit(onEvent, { type: 'expert_error', message: failure })
        continue
      }

      const contribution = buildExpertContribution({
        expert,
        content,
        slot,
        id: `seq-${++_msgSeq}`,
        round: rounds > 1 ? round + 1 : 1,
      })
      contributions.push(contribution)
      plan.blackboard.push(contribution)
      chainContext.push(`## ${expert.name || expert.id} 的发言 (第${round + 1}轮)\n${content}`)
      emit(onEvent, { type: 'expert_done', message: contribution })
    }
  }

  throwIfAborted(signal)
  if (!contributions.length) {
    const finalMessage = buildNoExpertResponseFallback({
      plan,
      slot: resolveExpertModelSlot(config, plan.moderator, defaultSlot),
    })
    plan.blackboard.push(finalMessage)
    emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard })
    return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
  }
  // 主持综合（如果有主持专家）
  const moderator = plan.moderator
  let finalMessage = contributions[contributions.length - 1]

  if (moderator) {
    const moderatorSlot = resolveExpertModelSlot(config, moderator, defaultSlot)
    emit(onEvent, buildExpertRunEvent('moderator_start', moderator, moderatorSlot))
    const finalMessages = buildModeratorMessages({ plan, contributions })
    finalMessage = await buildModeratorFinalOrFallback({ plan, contributions, slot: moderatorSlot, messages: finalMessages, signal, onEvent, tools, executeTool, id: 'seq-final' })
    plan.blackboard.push(finalMessage)
  }

  emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard })
  return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
}

export async function resumeExpertTeamSynthesis({ plan: sourcePlan, contributions = [], onEvent, signal, externalSlot, tools, executeTool } = {}) {
  if (!sourcePlan?.task) throw new Error('Expert team plan is required to resume synthesis')
  const sequential = sourcePlan?.group?.mode === 'sequential' || sourcePlan?.mode === 'sequential'
  const usableContributions = dedupeResumeContributions(contributions, { sequential })
  if (!usableContributions.length) throw new Error('No expert contributions available to resume synthesis')

  const { config, defaultSlot } = await resolveRunModelContext(externalSlot)
  const plan = normalizeResumePlan(sourcePlan, usableContributions)
  const moderatorSlot = resolveExpertModelSlot(config, plan.moderator, defaultSlot)
  emit(onEvent, { type: 'resume_start', plan: summarizePlan(plan, defaultSlot, config), contributionCount: usableContributions.length })
  emit(onEvent, { ...buildExpertRunEvent('moderator_start', plan.moderator, moderatorSlot), resumed: true })

  const finalMessages = buildModeratorMessages({ plan, contributions: usableContributions })
  const finalMessage = await buildModeratorFinalOrFallback({
    plan,
    contributions: usableContributions,
    slot: moderatorSlot,
    messages: finalMessages,
    signal,
    onEvent,
    tools,
    executeTool,
    id: `resume-final-${Date.now()}`,
  })
  plan.blackboard.push(finalMessage)
  emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard, resumed: true })
  return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
}

export async function resumeExpertTeamRun({ plan: sourcePlan, contributions = [], experts = [], onEvent, signal, externalSlot, tools, executeTool } = {}) {
  if (!sourcePlan?.task) throw new Error('Expert team plan is required to resume run')

  const { config, defaultSlot } = await resolveRunModelContext(externalSlot)
  const sequential = sourcePlan?.group?.mode === 'sequential' || sourcePlan?.mode === 'sequential'
  const usableContributions = dedupeResumeContributions(contributions, { sequential })
  const plan = normalizeResumePlan(sourcePlan, usableContributions, experts)
  const remaining = getResumeRemainingWork(plan, usableContributions)
  emit(onEvent, {
    type: 'resume_start',
    plan: summarizePlan(plan, defaultSlot, config),
    contributionCount: usableContributions.length,
    remainingCount: remaining.length,
    resumeMode: 'experts',
  })

  const nextContributions = [...usableContributions]
  if (remaining.length) {
    if (plan.group.mode === 'sequential') {
      await resumeSequentialExperts({ plan, remaining, contributions: nextContributions, config, defaultSlot, signal, onEvent, tools, executeTool })
    } else {
      await resumeParallelExperts({ plan, remaining, contributions: nextContributions, config, defaultSlot, signal, onEvent, tools, executeTool })
    }
  }

  throwIfAborted(signal)
  if (!nextContributions.length) {
    const finalMessage = buildNoExpertResponseFallback({
      plan,
      slot: resolveExpertModelSlot(config, plan.moderator, defaultSlot),
    })
    plan.blackboard.push(finalMessage)
    emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard, resumed: true })
    return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
  }
  const moderator = plan.moderator
  let finalMessage = nextContributions[nextContributions.length - 1]
  if (moderator) {
    const moderatorSlot = resolveExpertModelSlot(config, moderator, defaultSlot)
    emit(onEvent, { ...buildExpertRunEvent('moderator_start', moderator, moderatorSlot), resumed: true })
    const finalMessages = buildModeratorMessages({ plan, contributions: nextContributions })
    finalMessage = await buildModeratorFinalOrFallback({
      plan,
      contributions: nextContributions,
      slot: moderatorSlot,
      messages: finalMessages,
      signal,
      onEvent,
      tools,
      executeTool,
      id: `resume-final-${Date.now()}`,
    })
    plan.blackboard.push(finalMessage)
  }

  emit(onEvent, { type: 'done', final: finalMessage, transcript: plan.blackboard, resumed: true })
  return { plan: summarizePlan(plan, defaultSlot, config), transcript: plan.blackboard, final: finalMessage }
}

function buildSequentialMessages({ plan, expert, previous, historyText, round, rounds }) {
  const prevText = typeof previous === 'string' ? previous : JSON.stringify(previous)
  const history = historyText || ''

  return [
    { role: 'system', content: sequentialSystemPrompt(plan, expert, rounds) },
    {
      role: 'user',
      content: [
        `## 任务`,
        plan.task,
        history ? `\n## 此前的讨论\n${history}` : '',
        `\n## 当前阶段：${expert.name || expert.id} (第${round + 1}/${rounds}轮)`,
        prevText !== plan.task ? `\n## 上一位专家的输出\n${prevText}\n\n请基于以上信息，从你的专业角度给出分析和建议。` : '\n请从你的专业角度分析这个任务，给出你的建议。',
      ].filter(Boolean).join('\n'),
    },
  ]
}

function normalizeResumePlan(sourcePlan, contributions, experts = []) {
  const group = sourcePlan.group && typeof sourcePlan.group === 'object'
    ? sourcePlan.group
    : {
        id: sourcePlan.groupId || '',
        name: sourcePlan.groupName || '',
        mode: sourcePlan.mode || 'panel',
        approvalPolicy: sourcePlan.approvalPolicy || 'none',
        maxParallel: sourcePlan.maxParallel || 1,
        maxRounds: sourcePlan.maxRounds || 1,
        budget: clonePlainObject(sourcePlan.budget),
      }
  const sourceMembers = Array.isArray(sourcePlan.members) && sourcePlan.members.length
    ? sourcePlan.members
    : contributions.map(item => ({
        id: item.expertId || item.expertName || 'expert',
        name: item.expertName || item.expertId || 'Expert',
      }))
  const expertById = new Map((Array.isArray(experts) ? experts : []).filter(item => item?.id).map(item => [item.id, item]))
  const members = sourceMembers.map(member => {
    const id = member.id || member.expertId || ''
    return expertById.get(id) || { ...member, id }
  }).filter(member => member.id)
  const moderatorId = sourcePlan.moderator?.id || sourcePlan.moderatorExpertId || group.moderatorExpertId || ''
  const moderator = expertById.get(moderatorId) || sourcePlan.moderator || members[0] || { id: 'moderator', name: 'Moderator' }
  return {
    id: sourcePlan.id || `resume-${Date.now()}`,
    task: String(sourcePlan.task || '').trim(),
    group,
    members,
    moderator,
    blackboard: [...contributions],
  }
}

function getResumeRemainingWork(plan, contributions = []) {
  const sequential = plan.group.mode === 'sequential'
  const doneKeys = new Set(dedupeResumeContributions(contributions, { sequential }).map(item => resumeContributionKey(item.expertId || item.expertName, sequential ? (item.round || 1) : 0)))
  const rounds = plan.group.mode === 'sequential' ? resolveMaxRounds(plan.group) : 1
  const work = []
  for (let round = 0; round < rounds; round++) {
    const publicRound = plan.group.mode === 'sequential' ? round + 1 : 0
    for (const expert of plan.members || []) {
      if (!expert?.id) continue
      const key = resumeContributionKey(expert.id, publicRound)
      if (!doneKeys.has(key)) work.push({ expert, round: publicRound, index: work.length })
    }
  }
  return work
}

function resumeContributionKey(expertId, round = 0) {
  return `${expertId || ''}::${round || 0}`
}

export function dedupeResumeContributions(contributions = [], { sequential = false } = {}) {
  if (!Array.isArray(contributions)) return []
  const seen = new Set()
  const result = []
  for (const item of contributions) {
    if (!item || !String(item.content || '').trim()) continue
    const expertId = item.expertId || item.expertName || ''
    if (!expertId) continue
    const round = sequential ? (item.round || 1) : 0
    const key = resumeContributionKey(expertId, round)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      ...item,
      expertId,
      round,
    })
  }
  return result
}

async function resumeParallelExperts({ plan, remaining, contributions, config, defaultSlot, signal, onEvent, tools, executeTool }) {
  for (const batch of chunk(remaining, resolveMaxParallel(plan.group))) {
    throwIfAborted(signal)
    const previous = contributions.slice()
    const entries = batch.map(item => ({
      ...item,
      slot: resolveExpertModelSlot(config, item.expert, defaultSlot),
    }))
    for (const { expert, slot } of entries) {
      emit(onEvent, { ...buildExpertRunEvent('expert_start', expert, slot), resumed: true })
    }
    const batchResults = await Promise.allSettled(entries.map(async ({ expert, slot }) => {
      const messages = buildExpertMessages({ plan, expert, previous })
      const content = await callChatModelWithRetry(slot, messages, {
        maxTokens: expertMaxTokens(plan.group, 1800),
        signal,
        ...toolRuntimeOptions({ tools, executeTool, onEvent, owner: 'expert', expert, slot }),
        onDelta: (delta) => emit(onEvent, { ...buildExpertRunEvent('expert_delta', expert, slot), delta }),
        onRetry: (retry) => emit(onEvent, { ...buildExpertRunEvent('expert_retry', expert, slot), ...retry }),
      })
      throwIfAborted(signal)
      return buildExpertContribution({ expert, content, slot })
    }))
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i]
      const { expert, slot } = entries[i]
      if (result.status !== 'fulfilled') {
        throwIfAborted(signal)
        const failure = buildExpertFailure({ expert, slot, error: result.reason })
        plan.blackboard.push(failure)
        emit(onEvent, { type: 'expert_error', message: failure })
        continue
      }
      const contribution = result.value
      contribution.id = nextMsgId('resume')
      contributions.push(contribution)
      plan.blackboard.push(contribution)
      emit(onEvent, { type: 'expert_done', message: contribution })
    }
  }
}

async function resumeSequentialExperts({ plan, remaining, contributions, config, defaultSlot, signal, onEvent, tools, executeTool }) {
  const rounds = resolveMaxRounds(plan.group)
  let lastRound = null
  // chainContext 初始值从现有 contributions 构建，后续每次追加新发言
  const chainContext = [
    `## 原始任务\n${plan.task}`,
    ...contributions.map(item => `## ${item.expertName || item.expertId} 的发言${item.round ? ` (第${item.round}轮)` : ''}\n${item.content}`),
  ]
  for (const item of remaining) {
    throwIfAborted(signal)
    const { expert, round } = item
    if (round && rounds > 1 && round !== lastRound) {
      emit(onEvent, { type: 'round_start', round, total: rounds, resumed: true })
      lastRound = round
    }
    const slot = resolveExpertModelSlot(config, expert, defaultSlot)
    emit(onEvent, { ...buildExpertRunEvent('expert_start', expert, slot), round, resumed: true })
    // previous 取自 contributions 末尾内容（无 markdown 头），避免与 history 分离导致上下文不一致
    const previous = contributions.length > 0
      ? contributions[contributions.length - 1].content
      : plan.task
    const historyText = chainContext.length > 1 ? chainContext.slice(1).join('\n\n') : ''
    try {
      const content = await callChatModelWithRetry(slot, buildSequentialMessages({
        plan,
        expert,
        previous,
        historyText,
        round: Math.max(0, (round || 1) - 1),
        rounds,
      }), {
        maxTokens: expertMaxTokens(plan.group, 2000),
        signal,
        ...toolRuntimeOptions({ tools, executeTool, onEvent, owner: 'expert', expert, slot, round }),
        onDelta: (delta) => emit(onEvent, { ...buildExpertRunEvent('expert_delta', expert, slot), round, delta }),
        onRetry: (retry) => emit(onEvent, { ...buildExpertRunEvent('expert_retry', expert, slot), round, ...retry }),
      })
      throwIfAborted(signal)
      const contribution = buildExpertContribution({
        expert,
        content,
        slot,
        id: nextMsgId('resume-seq'),
        round: round || 1,
      })
      contributions.push(contribution)
      plan.blackboard.push(contribution)
      // chainContext 随 contributions 增长同步更新，确保后续专家看到完整历史
      chainContext.push(`## ${expert.name || expert.id} 的发言${round ? ` (第${round}轮)` : ''}\n${content}`)
      emit(onEvent, { type: 'expert_done', message: contribution })
    } catch (error) {
      throwIfAborted(signal)
      const failure = buildExpertFailure({ expert, slot, error, round: round || 1 })
      plan.blackboard.push(failure)
      emit(onEvent, { type: 'expert_error', message: failure })
    }
  }
}

function sequentialSystemPrompt(plan, expert, rounds) {
  const roleName = expert.name || expert.id
  const roleTitle = expert.title || ''
  return [
    `你是一位${roleTitle ? roleTitle + ' ' : ''}专家「${roleName}」。`,
    expert.systemPrompt || '',
    '',
    `你正在参与一个串联式专家评审流程。`,
    collaborationGuidanceText(plan),
    declaredCapabilityContext(expert),
    runConstraintContext(plan.group),
    `- 你会看到前面专家的输出，需要基于它们的结论推进思考`,
    `- 不要简单重复前人的观点，要提供增量价值`,
    `- 如果发现前人有遗漏或错误，礼貌地指出并补充`,
    rounds > 1 ? `- 这是第N轮讨论（共${rounds}轮），请在前一轮的基础上深化分析` : '',
    `- 输出简洁专业，聚焦核心观点`,
    expert.outputSchema ? `输出格式要求:\n${expert.outputSchema}` : '',
  ].filter(Boolean).join('\n')
}

export function resolveMaxRounds(group = {}) {
  const parsed = Number.parseInt(group.maxRounds, 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(parsed, 10))
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

export function isolateExpertTeamModelConfig(config = {}) {
  return {
    agents: {
      defaults: {
        model: clonePlainObject(config?.agents?.defaults?.model),
      },
    },
    models: {
      providers: clonePlainObject(config?.models?.providers),
    },
  }
}

async function resolveRunModelContext(externalSlot) {
  if (externalSlot) {
    return {
      config: { _external: true },
      defaultSlot: {
        provider: externalSlot.provider || 'external',
        baseUrl: cleanBaseUrl(externalSlot.baseUrl || ''),
        apiKey: externalSlot.apiKey || '',
        apiType: normalizeApiType(externalSlot.apiType || 'openai-completions'),
        model: externalSlot.model || '',
        source: 'assistant',
      },
    }
  }
  const config = isolateExpertTeamModelConfig(await api.readOpenclawConfig())
  return { config, defaultSlot: resolveDefaultModelSlot(config) }
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
  if (config._external) return { ...fallback, source: 'assistant' }  // 外部模式：所有专家使用同一配置
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
  const byId = new Map(experts.filter(expert => expert?.id).map(expert => [expert.id, expert]))
  const seen = new Set()
  return (Array.isArray(group.members) ? group.members : [])
    .slice()
    .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0))
    .map(member => byId.get(member?.expertId))
    .filter(expert => {
      if (!expert || expert.enabled === false || seen.has(expert.id)) return false
      seen.add(expert.id)
      return true
    })
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
    collaborationGuidanceText(plan),
    declaredCapabilityContext(expert),
    runConstraintContext(plan.group),
    'Communication protocol:',
    '1. Work independently from your role.',
    '2. Use the shared blackboard only as context.',
    '3. Produce concise, actionable output.',
    '4. Include assumptions, risks, and concrete recommendations.',
    expert.outputSchema ? `Required output format:\n${expert.outputSchema}` : '',
  ].filter(Boolean).join('\n')
}

function expertUserPrompt(plan, expert, previous) {
  const textParts = [
    `Team: ${plan.group.name || plan.group.id || 'Expert Team'}`,
    `Mode: ${plan.group.mode || 'panel'}`,
    `Task:\n${plan.task}`,
    '',
    `Your role: ${expert.name || expert.id}${expert.title ? ` (${expert.title})` : ''}`,
    expert.description ? `Role description: ${expert.description}` : '',
    previous.length ? `Shared blackboard so far:\n${formatMessages(previous)}` : 'Shared blackboard so far: empty',
    '',
    'Respond as this expert only. Do not synthesize the final answer unless you are the moderator.',
  ].filter(Boolean).join('\n')

  // 多模态：用户上传了图片，构建支持的 content 数组
  if (Array.isArray(plan.images) && plan.images.length) {
    const imageBlocks = plan.images.map(img => ({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    }))
    return [
      { type: 'text', text: `The user attached ${plan.images.length} image(s). Analyze them together with the task below.\n\n${textParts}` },
      ...imageBlocks,
    ]
  }

  return textParts
}

function moderatorSystemPrompt(plan, moderator) {
  return [
    moderator.systemPrompt || `You are ${moderator.name || 'the moderator'}, responsible for synthesizing expert input.`,
    '',
    collaborationGuidanceText(plan),
    runConstraintContext(plan.group),
    'Moderator protocol:',
    '1. Compare expert contributions, resolve conflicts, and preserve dissenting risks.',
    '2. Produce a final answer the user can act on.',
    '3. Be explicit about tradeoffs and next steps.',
    '4. End with a compact closeout report: decision, deliverables, risks, validation, next actions.',
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
    moderatorInstruction(plan.group),
  ].join('\n')
}

function collaborationGuidanceText(plan) {
  const mode = plan?.group?.mode || 'panel'
  return (COLLABORATION_GUIDANCE[mode] || COLLABORATION_GUIDANCE.panel).join('\n')
}

function declaredCapabilityContext(expert = {}) {
  const lines = []
  const tools = normalizeList(expert.tools)
  const skills = normalizeList(expert.skills)
  const knowledgeRefs = normalizeList(expert.knowledgeRefs)
  if (tools.length) lines.push(`Declared tool domains: ${tools.join(', ')}`)
  if (skills.length) lines.push(`Declared skills: ${skills.join(', ')}`)
  if (knowledgeRefs.length) lines.push(`Knowledge references to consider: ${knowledgeRefs.join(', ')}`)
  if (!lines.length) return ''
  return [
    'Declared capability context (these describe your expertise; do not claim to have executed unavailable tools):',
    ...lines.map(line => `- ${line}`),
  ].join('\n')
}

function runConstraintContext(group = {}) {
  const parts = []
  if (group.approvalPolicy && group.approvalPolicy !== 'none') parts.push(`Human approval policy: ${group.approvalPolicy}`)
  if (!parts.length) return ''
  return [
    'Run constraints:',
    ...parts.map(part => `- ${part}`),
  ].join('\n')
}

function moderatorInstruction(group = {}) {
  const mode = group.mode || 'panel'
  const base = [
    'Synthesize the final team output.',
    'Use a closeout structure with: final decision, deliverables, assumptions, risks, validation checks, and next actions.',
    'Keep expert disagreement visible when it affects the recommendation.',
  ].join(' ')
  if (mode === 'creation') return `${base} Produce a polished usable draft or implementation direction.`
  if (mode === 'debate') return `${base} Preserve the strongest disagreements and explain how to decide between them.`
  if (mode === 'review') return `${base} Lead with must-fix issues and validation steps.`
  if (mode === 'research') return `${base} Call out confidence, missing sources, and follow-up research needs.`
  if (mode === 'sequential') return `${base} Highlight how the chain evolved and what the final handoff should be.`
  return base
}

function buildExpertContribution({ expert, content, slot, id, round }) {
  return {
    role: 'expert',
    id,
    expertId: expert.id,
    expertName: expert.name || expert.id,
    expertTitle: expert.title || '',
    content,
    model: summarizeSlot(slot),
    ...(round ? { round } : {}),
    createdAt: new Date().toISOString(),
  }
}

function buildExpertFailure({ expert, slot, error, round }) {
  return {
    role: 'expert',
    status: 'error',
    id: `err-${expert.id || 'expert'}-${Date.now()}`,
    expertId: expert.id,
    expertName: expert.name || expert.id,
    expertTitle: expert.title || '',
    content: '',
    error: normalizeRunError(error),
    model: summarizeSlot(slot),
    ...(round ? { round } : {}),
    createdAt: new Date().toISOString(),
  }
}

async function buildModeratorFinalOrFallback({ plan, contributions, slot, messages, signal, onEvent, id, tools, executeTool }) {
  try {
    const final = await callChatModelWithRetry(slot, messages, {
      maxTokens: moderatorMaxTokens(plan.group, 2600),
      signal,
      emptyResponseLabel: 'moderator synthesis',
      ...moderatorToolRuntimeOptions({ tools, executeTool, onEvent, plan, slot }),
      onDelta: (delta) => emit(onEvent, { ...buildExpertRunEvent('moderator_delta', plan.moderator, slot), delta }),
      onRetry: (retry) => emit(onEvent, { ...buildExpertRunEvent('moderator_retry', plan.moderator, slot), ...retry }),
    })
    throwIfAborted(signal)
    return {
      id: id || `msg-${plan.blackboard.length + 1}`,
      role: 'moderator',
      expertId: plan.moderator?.id || '',
      expertName: plan.moderator?.name || 'Moderator',
      expertTitle: plan.moderator?.title || '',
      content: final,
      model: summarizeSlot(slot),
      createdAt: new Date().toISOString(),
    }
  } catch (error) {
    throwIfAborted(signal)
    const failure = {
      role: 'moderator',
      status: 'error',
      id: `err-moderator-${Date.now()}`,
      expertId: plan.moderator?.id || '',
      expertName: plan.moderator?.name || 'Moderator',
      expertTitle: plan.moderator?.title || '',
      content: '',
      error: normalizeRunError(error),
      model: summarizeSlot(slot),
      createdAt: new Date().toISOString(),
    }
    plan.blackboard.push(failure)
    emit(onEvent, { type: 'moderator_error', message: failure })
    return {
      id: id || `msg-${plan.blackboard.length + 1}`,
      role: 'moderator',
      status: 'fallback',
      expertId: plan.moderator?.id || '',
      expertName: plan.moderator?.name || 'Moderator',
      expertTitle: plan.moderator?.title || '',
      content: buildFallbackSynthesis(plan, contributions, failure.error),
      model: summarizeSlot(slot),
      createdAt: new Date().toISOString(),
    }
  }
}

function buildFallbackSynthesis(plan, contributions, moderatorError) {
  const usefulContributions = contributions.filter(msg => String(msg?.content || '').trim())
  const expertNames = usefulContributions.map(msg => msg.expertName || msg.expertId || '专家').filter(Boolean)
  const reason = moderatorFallbackReason(moderatorError)
  return [
    '主持专家这一步没有返回可用的综合结论，系统已根据已完成的专家意见整理临时交付。',
    '',
    '## 当前状态',
    `- 已完成专家：${expertNames.length ? expertNames.join('、') : '暂无'}`,
    `- 主持综合状态：模型未返回有效内容，已自动降级整理`,
    `- 可选下一步：点击“继续综合”让主持专家重新整理，或基于“完整过程”查看每位专家的完整发言`,
    '',
    '## 已保留的专家意见摘要',
    '',
    ...usefulContributions.map((msg, index) => [
      `### ${index + 1}. ${msg.expertName || msg.expertId || '专家'}${msg.expertTitle ? ` · ${msg.expertTitle}` : ''}`,
      fallbackContributionExcerpt(msg.content),
    ].join('\n')),
    '',
    '## 说明',
    `触发原因：${reason}`,
    '完整专家发言没有丢失，可在下方“完整过程”中展开查看。',
  ].join('\n')
}

function buildNoExpertResponseFallback({ plan, slot }) {
  return {
    id: `fallback-no-experts-${Date.now()}`,
    role: 'moderator',
    status: 'fallback',
    expertId: plan.moderator?.id || '',
    expertName: plan.moderator?.name || 'Moderator',
    expertTitle: plan.moderator?.title || '',
    content: buildNoExpertResponseFallbackContent(plan),
    model: summarizeSlot(slot),
    createdAt: new Date().toISOString(),
  }
}

function buildNoExpertResponseFallbackContent(plan) {
  const failures = (Array.isArray(plan.blackboard) ? plan.blackboard : [])
    .filter(msg => msg?.status === 'error')
  const experts = (Array.isArray(plan.members) ? plan.members : [])
    .map(expert => expert.name || expert.id || '专家')
    .filter(Boolean)
  const reasons = [...new Set(failures.map(item => moderatorFallbackReason(item.error)).filter(Boolean))]
  return [
    `${ALL_EXPERTS_EMPTY_LABEL}，本次没有足够材料生成正式综合结论。`,
    '',
    '## 当前状态',
    `- 已调度专家：${experts.length ? experts.join('、') : '暂无'}`,
    `- 可用专家意见：0 份`,
    `- 常见原因：当前模型返回空内容、模型接口格式不兼容、模型服务异常，或模型配置不可用`,
    '',
    '## 建议下一步',
    '- 优先切换到稳定的 OpenAI 兼容 Chat Completions 模型后重新发起。',
    '- 检查模型配置页里的 baseUrl、模型名、API Key 和服务状态。',
    '- 如果只在某个模型上复现，说明该模型返回格式需要单独适配。',
    '',
    failures.length ? '## 本次错误摘要' : '',
    ...failures.slice(0, 8).map(item => `- ${item.expertName || item.expertId || '专家'}：${moderatorFallbackReason(item.error)}`),
    reasons.length ? `\n主要触发原因：${reasons.join('；')}` : '',
  ].filter(Boolean).join('\n')
}

function fallbackContributionExcerpt(content, limit = 420) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return '该专家没有留下可用文本。'
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function moderatorFallbackReason(error) {
  const raw = String(error || '').trim()
  if (!raw) return '主持模型未返回有效内容'
  if (/All expert responses failed/i.test(raw)) return ALL_EXPERTS_EMPTY_LABEL
  if (/empty\s+(moderator synthesis|expert response)|empty/i.test(raw)) return '主持模型返回空内容'
  return raw
}

function expertMaxTokens(_group = {}, fallback) {
  return fallback
}

function moderatorMaxTokens(_group = {}, fallback) {
  return fallback
}

function normalizeRunError(error) {
  if (error?.name === 'AbortError') return 'Expert team run stopped'
  const message = error?.message || error?.body || error?.toString?.() || ''
  return String(message || 'Unknown model error').trim()
}

function buildExpertRunEvent(type, expert = {}, slot) {
  return {
    type,
    expertId: expert?.id || '',
    expertName: expert?.name || expert?.id || '',
    expertTitle: expert?.title || '',
    model: summarizeSlot(slot),
  }
}

function formatMessages(messages) {
  return messages.map(msg => {
    const speaker = msg.expertName || msg.expertId || msg.role || 'expert'
    return `### ${speaker}\n${msg.content || ''}`
  }).join('\n\n')
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean)
  return []
}

async function callChatModel(slot, messages, opts = {}) {
  if (slot.apiType !== 'openai-completions') {
    throw new Error(`Expert team runtime currently supports OpenAI-compatible Chat Completions only: ${slot.provider}/${slot.model}`)
  }

  // 请求级超时：自动跳过超时专家
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
  const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null
  const signal = opts.signal || timeoutSignal
  const combined = timeoutSignal && opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : signal

  if (Array.isArray(opts.tools) && opts.tools.length && typeof opts.executeTool === 'function') {
    return await callChatModelWithToolLoop(slot, messages, { ...opts, signal: combined })
  }
  const body = {
    model: slot.model,
    messages,
    temperature: DEFAULT_TEMPERATURE,
    max_tokens: opts.maxTokens || 2000,
  }
  if (typeof opts.onDelta === 'function' && api.modelChatCompletionsProxyStream) {
    const resp = await api.modelChatCompletionsProxyStream(slot.baseUrl, slot.apiKey || '', slot.apiType, { ...body, stream: true }, {
      signal: combined,
    })
    if (resp) {
      const content = await readChatCompletionStream(resp, opts.onDelta, combined)
      if (content.trim()) return content.trim()
      throw new Error(`Model returned an empty ${opts.emptyResponseLabel || 'expert response'}`)
    }
  }
  const result = await api.modelChatCompletionsProxy(slot.baseUrl, slot.apiKey || '', slot.apiType, body)
  const parsed = parseProxyBody(result)
  const content = extractChatMessageContent(parsed)
  if (!content.trim()) throw new Error(`Model returned an empty ${opts.emptyResponseLabel || 'expert response'}`)
  return content.trim()
}

async function callChatModelWithToolLoop(slot, messages, opts = {}) {
  const tools = Array.isArray(opts.tools) ? opts.tools : []
  const currentMessages = messages.map(msg => ({ ...msg }))
  const maxToolRounds = Math.max(1, Math.min(Number.parseInt(opts.maxToolRounds || 4, 10) || 4, 8))

  for (let round = 0; round <= maxToolRounds; round++) {
    throwIfAborted(opts.signal)
    const body = {
      model: slot.model,
      messages: currentMessages,
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: opts.maxTokens || 2000,
      tools,
    }
    const result = await api.modelChatCompletionsProxy(slot.baseUrl, slot.apiKey || '', slot.apiType, body)
    const parsed = parseProxyBody(result)
    const choice = parsed?.choices?.[0]
    const message = choice?.message || {}
    const content = extractChatMessageContent(parsed)
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(tc => tc?.function?.name) : []

    if (!toolCalls.length) {
      if (content.trim()) {
        if (typeof opts.onDelta === 'function') opts.onDelta(content)
        return content.trim()
      }
      throw new Error(`Model returned an empty ${opts.emptyResponseLabel || 'expert response'}`)
    }

    currentMessages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls,
    })

    for (const toolCall of toolCalls) {
      throwIfAborted(opts.signal)
      const toolName = toolCall.function?.name || ''
      const args = parseToolCallArguments(toolCall.function?.arguments)
      const eventBase = buildToolEventBase(opts, toolName, args, toolCall)
      emit(opts.onToolEvent, { ...eventBase, type: 'tool_start' })
      let resultText = ''
      let approved = true
      try {
        const toolResult = await opts.executeTool({ name: toolName, args, toolCall })
        approved = toolResult?.approved !== false
        resultText = stringifyToolResult(toolResult?.result)
        emit(opts.onToolEvent, {
          ...eventBase,
          type: 'tool_done',
          approved,
          result: summarizeToolResult(resultText),
        })
      } catch (error) {
        resultText = normalizeRunError(error)
        approved = false
        emit(opts.onToolEvent, {
          ...eventBase,
          type: 'tool_error',
          approved,
          result: resultText,
        })
      }
      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id || `${toolName}-${Date.now()}`,
        content: resultText,
      })
    }
  }

  throw new Error(`Tool loop exceeded ${maxToolRounds} rounds`)
}

function toolRuntimeOptions({ tools, executeTool, onEvent, owner, expert, slot, round } = {}) {
  if (!Array.isArray(tools) || !tools.length || typeof executeTool !== 'function') return {}
  return {
    tools,
    executeTool,
    onToolEvent: (event) => emit(onEvent, {
      owner,
      expertId: expert?.id || '',
      expertName: expert?.name || expert?.id || '',
      expertTitle: expert?.title || '',
      model: summarizeSlot(slot),
      ...(round ? { round } : {}),
      ...event,
    }),
  }
}

function moderatorToolRuntimeOptions({ tools, executeTool, onEvent, plan, slot } = {}) {
  if (!Array.isArray(tools) || !tools.length || typeof executeTool !== 'function') return {}
  const moderator = plan?.moderator || {}
  return {
    tools,
    executeTool,
    onToolEvent: (event) => emit(onEvent, {
      owner: 'moderator',
      expertId: moderator.id || '',
      expertName: moderator.name || '主持专家',
      expertTitle: moderator.title || '主持专家',
      model: summarizeSlot(slot),
      ...event,
    }),
  }
}

function buildToolEventBase(opts, toolName, args, toolCall) {
  return {
    toolName,
    args: cloneToolArgs(args),
    toolCallId: toolCall?.id || `${toolName}-${Date.now()}`,
  }
}

function parseToolCallArguments(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function cloneToolArgs(args) {
  try { return JSON.parse(JSON.stringify(args || {})) } catch { return {} }
}

function stringifyToolResult(result) {
  if (typeof result === 'string') return result
  try { return JSON.stringify(result, null, 2) } catch { return String(result ?? '') }
}

function summarizeToolResult(result) {
  const text = String(result || '').trim()
  if (!text) return ''
  return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text
}

async function readChatCompletionStream(resp, onDelta, signal) {
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(formatProxyStreamError(resp.status, errText))
  }

  const contentType = resp.headers?.get?.('content-type') || ''
  if (!contentType.includes('text/event-stream') && !contentType.includes('text/plain')) {
    const parsed = await resp.json()
    const content = extractChatMessageContent(parsed)
    if (content) onDelta(content)
    return content
  }

  const reader = resp.body?.getReader?.()
  if (!reader) throw new Error('Streaming response body is unavailable')

  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let streamError = ''
  const onAbort = () => { try { reader.cancel() } catch {} }

  if (signal) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        const result = parseChatStreamLine(line)
        if (result.done) return content || reasoning
        if (result.error) streamError = streamError || result.error
        if (result.content) {
          content += result.content
          onDelta(result.content)
        }
        if (result.reasoning) reasoning += result.reasoning
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try { reader.releaseLock() } catch {}
  }

  if (!content && reasoning) {
    onDelta(reasoning)
    return reasoning
  }
  if (!content && streamError) throw new Error(streamError)
  return content
}

function parseChatStreamLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed || trimmed.startsWith('event:')) return {}
  if (!trimmed.startsWith('data:')) return {}
  const data = trimmed.slice(5).trim()
  if (!data) return {}
  if (data === '[DONE]') return { done: true }
  try {
    const json = JSON.parse(data)
    if (json.error) return { error: json.error?.message || String(json.error) }
    if (json.type === 'response.output_text.delta') return { content: json.delta || '' }
    const delta = json.choices?.[0]?.delta
    if (delta?.content) return { content: delta.content }
    if (delta?.reasoning_content) return { reasoning: delta.reasoning_content }
    return {}
  } catch {
    return {}
  }
}

export function extractChatMessageContent(parsed) {
  const choice = parsed?.choices?.[0] || {}
  const message = choice.message || {}
  return [
    extractTextContent(message.content),
    extractTextContent(message.reasoning_content),
    extractTextContent(choice.text),
    extractTextContent(parsed?.output_text),
    extractResponsesOutputText(parsed?.output),
  ].find(text => String(text || '').trim()) || ''
}

function extractResponsesOutputText(output) {
  if (!Array.isArray(output)) return ''
  return output.map(item => {
    if (!item) return ''
    if (item.type === 'message') return extractTextContent(item.content)
    if (item.type === 'reasoning') return extractTextContent(item.summary || item.content)
    return extractTextContent(item.content || item.text || item.output_text)
  }).filter(Boolean).join('')
}

function extractTextContent(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(extractTextContent).filter(Boolean).join('')
  if (typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.output_text === 'string') return value.output_text
  if (typeof value.value === 'string') return value.value
  if (value.text && typeof value.text === 'object') return extractTextContent(value.text)
  if (value.content) return extractTextContent(value.content)
  return ''
}

function formatProxyStreamError(status, errText) {
  let errMsg = `API error ${status}`
  try {
    const errJson = JSON.parse(errText)
    return errJson.error?.message || errJson.message || errMsg
  } catch {
    return errText ? `${errMsg}: ${errText.slice(0, 200)}` : errMsg
  }
}

async function callChatModelWithRetry(slot, messages, opts = {}) {
  const retries = Number.isFinite(opts.retries) ? opts.retries : DEFAULT_RETRY_ATTEMPTS
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(opts.signal)
    try {
      return await callChatModel(slot, messages, opts)
    } catch (error) {
      throwIfAborted(opts.signal)
      lastError = error
      if (attempt >= retries) break
      emit(opts.onRetry, {
        attempt: attempt + 1,
        maxAttempts: retries,
        message: normalizeRunError(error),
      })
    }
  }
  throw lastError || new Error('Model call failed')
}

export function parseProxyBody(result) {
  if (result && typeof result === 'object' && result.choices) return result

  const response = result && typeof result === 'object' ? result : {}
  const wrapped = Object.hasOwn(response, 'body')
  const rawBody = wrapped ? response.body : result
  let parsed
  if (rawBody && typeof rawBody === 'object') {
    parsed = rawBody
  } else {
    const text = String(rawBody || '').trim()
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch (error) {
      if (response.ok === false) parsed = {}
      else throw error
    }
  }

  if (response.ok === false) {
    throw new Error(formatProxyResponseError(response, parsed, rawBody))
  }
  return parsed
}

function formatProxyResponseError(response, parsed, rawBody) {
  const status = response.status ? ` ${response.status}` : ''
  const prefix = `API error${status}`
  const message = extractProxyErrorMessage(parsed, rawBody) || response.statusText || 'Model request failed'
  return `${prefix}: ${message}`
}

function extractProxyErrorMessage(parsed, rawBody) {
  const fromParsed = parsed?.error?.message || parsed?.message || parsed?.error
  if (fromParsed) return String(fromParsed).trim()
  if (typeof rawBody !== 'string') return ''
  const text = rawBody.trim()
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}

function clonePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return JSON.parse(JSON.stringify(value))
}

function summarizePlan(plan, slot, config = {}) {
  return {
    id: plan.id,
    task: plan.task,
    groupId: plan.group.id || '',
    groupName: plan.group.name || '',
    mode: plan.group.mode || 'panel',
    maxParallel: resolveMaxParallel(plan.group),
    maxRounds: resolveMaxRounds(plan.group),
    approvalPolicy: plan.group.approvalPolicy || 'none',
    budget: clonePlainObject(plan.group.budget),
    members: plan.members.map(expert => ({
      id: expert.id,
      name: expert.name || expert.id,
      title: expert.title || '',
      tools: normalizeList(expert.tools),
      skills: normalizeList(expert.skills),
      knowledgeRefs: normalizeList(expert.knowledgeRefs),
      model: summarizeSlot(resolveExpertModelSlot(config, expert, slot)),
    })),
    moderator: plan.moderator ? {
      id: plan.moderator.id,
      name: plan.moderator.name || plan.moderator.id,
      title: plan.moderator.title || '',
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
