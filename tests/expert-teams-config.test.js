import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/expert-teams.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/style/pages/expert-teams.css', import.meta.url), 'utf8')
const api = readFileSync(new URL('../src/lib/tauri-api.js', import.meta.url), 'utf8')
const runner = readFileSync(new URL('../src/lib/expert-team-runner.js', import.meta.url), 'utf8')
const rust = readFileSync(new URL('../src-tauri/src/commands/team.rs', import.meta.url), 'utf8')
const devApi = readFileSync(new URL('../scripts/dev-api.js', import.meta.url), 'utf8')
const engine = readFileSync(new URL('../src/engines/openclaw/index.js', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/locales/index.js', import.meta.url), 'utf8')
const sidebarLocale = readFileSync(new URL('../src/locales/modules/sidebar.js', import.meta.url), 'utf8')
const expertTeamsLocale = readFileSync(new URL('../src/locales/modules/expertTeams.js', import.meta.url), 'utf8')
const assistantLocale = readFileSync(new URL('../src/locales/modules/assistant.js', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

test('OpenClaw registers Expert Teams navigation and route', () => {
  assert.match(engine, /route:\s*'\/expert-teams'/)
  assert.match(engine, /path:\s*'\/expert-teams'/)
  assert.match(engine, /pages\/expert-teams\.js/)
  assert.match(sidebarLocale, /expertTeams:\s*_\(/)
  assert.match(locales, /import expertTeams/)
  assert.match(locales, /agentDetail,\s*expertTeams/)
})

test('Expert Teams API is exposed in frontend, dev API, and Tauri commands', () => {
  for (const name of [
    'listExperts',
    'saveExpert',
    'deleteExpert',
    'listExpertGroups',
    'saveExpertGroup',
    'deleteExpertGroup',
  ]) {
    assert.match(api, new RegExp(`${name}:`), `${name} should be in tauri-api`)
  }
  for (const cmd of [
    'list_experts',
    'save_expert',
    'delete_expert',
    'list_expert_groups',
    'save_expert_group',
    'delete_expert_group',
  ]) {
    assert.match(rust, new RegExp(`pub fn ${cmd}`), `${cmd} should be a Tauri command`)
    assert.match(devApi, new RegExp(`${cmd}\\(`), `${cmd} should be handled in dev-api`)
  }
})

test('Expert Teams persistence keeps expert library and group membership separate', () => {
  assert.match(rust, /experts\.json/)
  assert.match(rust, /expert-groups\.json/)
  assert.match(rust, /prune_expert_from_groups/)
  assert.match(rust, /moderatorExpertId/)
  assert.match(rust, /members/)
  assert.match(devApi, /expertProfilesPath/)
  assert.match(devApi, /expertGroupsPath/)
  assert.match(devApi, /pruneExpertFromGroups/)
})

test('Expert Teams page supports expert editing and team member selection', () => {
  for (const token of [
    'api.listExperts',
    'api.saveExpert',
    'api.deleteExpert',
    'api.listExpertGroups',
    'api.saveExpertGroup',
    'api.deleteExpertGroup',
    'api.skillsList',
    'expert-member-picker',
    'data-member-toggle',
    'data-member-order',
    'data-member-drag',
    'expert-member-order-label',
    'memberDragLabel',
    'moderatorExpertId',
    'group-moderator',
    'renderTopSummary',
    'groupCountSummary',
    'currentGroupMembersSummary',
    'memberSlotSummary',
    'memberOrderHint',
    'memberOrderLabel',
    'renumberSelectedMembers',
    'dragstart',
    'dragover',
    'expert-communication-note',
    'formWorkflow',
    'group-max-rounds',
    'group-max-parallel',
    'group-approval-policy',
    'expert-workflow-grid-wide',
    'workflowRounds',
    'workflowParallelRoundMeaning',
    'workflowSequentialRoundMeaning',
    'classList.toggle(\'is-muted\'',
    'availableSkills',
    'normalizeSkillOptions',
    'skillOptionsForExpert',
    'mergeSelectedTagOptions',
    'tagPickerSelected',
    'tagPickerChoose',
    'tagPickerSelectAll',
    'tagPickerDeselectAll',
    'tagPickerInvert',
    'selectedSkillListFailed',
    'selectedSkillNotScanned',
    'selectedTagNotAvailable',
    'modelIdInvalid',
    'groupMembersRequired',
    'isProviderModelRef',
    'normalizeProviderModelRef',
    'const rawModelId',
    '!inheritDefault && !modelId',
    'closeModal({ restoreFocus: true })',
    "modal.addEventListener('click'",
    "modal.addEventListener('keydown'",
    "e.key !== 'Escape'",
    'renderWorkflowGuide',
    'workflowGuide',
    'updateGroupWorkflowGuide',
    'expert-workflow-guide',
    'workflowExecution',
    'workflowCommunication',
    'workflowBestFor',
    'workflowTuning',
    'workflowParallelExecution',
    'workflowSequentialExecution',
    'memberOrderLabel',
    'syncMemberOrderLabel',
  ]) {
    assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.doesNotMatch(page, /group-max-tokens/)
  assert.doesNotMatch(page, /总 Token 预算/)
  assert.doesNotMatch(page, /aria-label="关闭"/)
  assert.doesNotMatch(page, /placeholder="搜索\.\.\."/)
  assert.doesNotMatch(page, />全选</)
  assert.doesNotMatch(page, />取消全选</)
  assert.doesNotMatch(page, />反选</)
  assert.doesNotMatch(page, />确认</)
  assert.doesNotMatch(page, /已选 \$\{[^}]+\} 项/)
  assert.doesNotMatch(page, /点击选择\.\.\./)
  const workflowSection = page.slice(page.indexOf('function renderWorkflowGuide'), page.indexOf('function currentGroupFromForm'))
  for (const hardcodedWorkflowText of [
    '执行次数',
    '沟通方式',
    '适合任务',
    '参数建议',
    '轮次说明',
    '每位专家通常执行 1 次',
    '当前模式不使用多轮接力',
    '不会从空白重写',
    '多位专家独立看同一个问题',
    '专家按顺序接力',
  ]) {
    assert.doesNotMatch(workflowSection, new RegExp(hardcodedWorkflowText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(page, /modal\.querySelector\('\.expert-tag-modal-overlay'\)/)
  assert.match(expertTeamsLocale, /modelIdInvalid/)
  assert.match(expertTeamsLocale, /groupMembersRequired/)
  assert.match(expertTeamsLocale, /workflowSequentialRoundMeaning/)
  assert.match(expertTeamsLocale, /workflowResearchTuning/)

  for (const token of [
    'expert-run-panel',
    'data-action="run-team"',
    'data-action="stop-run"',
    'runAbortController',
    'RUN_HISTORY_KEY',
    'renderRunHistory',
    'saveCurrentRunRecord',
    'viewRunHistory',
    'clearCurrentRunHistory',
    'runExpertTeam',
    'runExpertTeamSequential',
  ]) {
    assert.doesNotMatch(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Expert Teams runner defines structured expert communication', () => {
  for (const token of [
    'buildExpertTeamPlan',
    'buildExpertMessages',
    'buildModeratorMessages',
    'shared blackboard',
    'Communication protocol',
    'Moderator protocol',
    'api.modelChatCompletionsProxy',
    'resolveDefaultModelSlot',
    'resolveExpertModelSlot',
    'resolveMaxParallel',
    'resolveMaxRounds',
    'Promise.allSettled',
    'callChatModelWithRetry',
    'modelChatCompletionsProxyStream',
    'readChatCompletionStream',
    'expert_delta',
    'moderator_delta',
    'onDelta',
    'DEFAULT_RETRY_ATTEMPTS',
    'buildExpertFailure',
    'buildModeratorFinalOrFallback',
    'buildFallbackSynthesis',
    'buildNoExpertResponseFallback',
    'extractChatMessageContent',
    'extractResponsesOutputText',
    'reasoning_content',
    'output_text',
    'emptyResponseLabel',
    "emptyResponseLabel: 'moderator synthesis'",
    "buildExpertRunEvent('moderator_delta', plan.moderator, slot)",
    "buildExpertRunEvent('moderator_retry', plan.moderator, slot)",
    '系统已根据已完成的专家意见整理临时交付',
    'resumeExpertTeamRun',
    'resumeExpertTeamSynthesis',
    'resume_start',
    'normalizeResumePlan',
    'getResumeRemainingWork',
    'resumeParallelExperts',
    'resumeSequentialExperts',
    'Expert team plan is required to resume run',
    'No expert contributions available to resume synthesis',
    'expert_error',
    'moderator_error',
    '专家团没有收到可用的专家回复',
    'maxParallel',
    'maxRounds',
    'Declared capability context',
    'Mode guidance',
    'closeout report',
    'final decision',
    'validation checks',
    'modelId',
  ]) {
    assert.match(runner, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Assistant Expert Teams entry loads arrays, persists selection, and cleans remount listener', () => {
  const assistant = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')
  assert.match(assistant, /import \{ escapeAttr as escAttr,\s*escapeHtml as escHtml \} from '\.\.\/lib\/utils\.js'/)
  for (const token of [
    'EXPERT_TEAM_SELECTION_KEY',
    'normalizeExpertListResponse(groupRes, \'groups\')',
    'normalizeExpertListResponse(expertRes, \'experts\')',
    'syncActiveExpertGroup',
    'hasRunnableExpertGroup',
    'persistActiveExpertGroupId',
    'resolveMaxRounds(group)',
    'runExpertTeam',
    'runExpertTeamSequential',
    'resumeExpertTeamRun',
    'resumeExpertTeamSynthesis',
    '_expertTeamOutsideClickHandler',
    'document.removeEventListener(\'click\', _expertTeamOutsideClickHandler)',
    'event.type === \'expert_error\'',
    'event.type === \'moderator_error\'',
    'ast-expert-item--warning',
    'event.type === \'expert_retry\'',
    'event.type === \'moderator_retry\'',
    'event.type === \'expert_delta\'',
    'event.type === \'moderator_delta\'',
    'appendExpertRunDelta',
    'appendModeratorRunDelta',
    'renderExpertTeamOperationTrace',
    'getExpertTeamOperations',
    'ast-expert-trace',
    'expertTeamTraceTitle',
    '_expertTeamRun',
    'initExpertTeamRunMeta',
    'updateExpertTeamRunMeta',
    'appendExpertTeamCheckpoint',
    'expertTeamCheckpointFromEvent',
    'getExpertTeamRunMeta',
    'buildExpertTeamLegacyCheckpoints',
    'expertTeamLegacyPhase',
    'expertTeamPhaseLabel',
    'expertTeamRunElapsed',
    'renderExpertTeamRunMeta',
    'renderExpertTeamRunDetails',
    'renderExpertTeamFocus',
    'getExpertTeamFocus',
    'renderExpertTeamWorkboard',
    'getExpertTeamWorkboard',
    'getExpertTeamMemberStatuses',
    'renderExpertTeamLiveSynthesis',
    'expertTeamDomId',
    'expertTeamLiveDomId',
    'scheduleExpertTeamLiveDomUpdate',
    'applyExpertTeamLiveDomUpdate',
    'data-expert-live-id',
    'data-expert-active-id',
    'ast-expert-progress',
    'ast-expert-focus',
    'ast-expert-workboard',
    'ast-expert-member-track',
    'ast-expert-run-meta',
    'ast-expert-run-details',
    'ast-expert-live-synthesis',
    'ast-expert-stage-board',
    'ast-expert-governance',
    'ast-expert-closeout',
    'getExpertTeamStages',
    'getExpertTeamGovernance',
    'renderExpertTeamCloseout',
    'renderExpertTeamResumeActions',
    'canResumeExpertTeamSynthesis',
    'canResumeExpertTeamRun',
    'hasExpertTeamModeratorFallback',
    'getExpertTeamContributions',
    'getExpertTeamRemainingMembers',
    'resumeExpertTeamMessage',
    'assistantExpertTeamSlot',
    'handleExpertTeamRunEvent',
    'expertTeamMessageText',
    'expertTeamErrorText',
    'data-action="resume-expert-synthesis"',
    'data-action="resume-expert-run"',
    'ast-expert-resume-actions',
    'assistant.expertTeamResumeRun',
    'assistant.expertTeamResumeRunUnavailable',
    'resume_start',
    'assistant.expertTeamResumeSynthesis',
    'assistant.expertTeamResynthesize',
    'assistant.expertTeamStatusDegraded',
    'assistant.expertTeamProgressFallback',
    'final.status',
    "status: event.final?.status || ''",
    'getExpertTeamActiveAgents',
    'isRunning ? getExpertTeamActiveAgents(transcript) : []',
    'clearActiveExpertGroupSelection',
    'ast-expert-disclosure',
    'ast-expert-live-text',
    'ast-expert-final-card',
    '<details class="ast-expert-item ast-expert-item--done ast-expert-disclosure"',
    'assistant.expertTeamRunDetailsDesc',
    'assistant.expertTeamGovernanceTopology',
    'assistant.expertTeamGovernanceAutonomy',
    'assistant.expertTeamCheckpointLabel',
    'assistant.expertTeamRunIdTitle',
    'assistant.expertTeamCloseoutTitle',
    'assistant.expertTeamQualityGate',
    'assistant.expertTeamWorkboardQueue',
    'expertTeamToolTargetBrief',
    'expertTeamProcessSummary',
    'assistant.expertTeamStoppedChatFallback',
    'assistant.expertTeamResumeRunStopped',
    "toast(t('assistant.expertTeamTaskRequired'), 'warning')",
    "toast(t('assistant.expertTeamSelectionUnavailable'), 'error')",
  ]) {
    assert.match(assistant, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const token of [
    'expertTeamFocusAria',
    'expertTeamRunDetailsDesc',
    'expertTeamResumeRun',
    'expertTeamResumeRunUnavailable',
    'expertTeamResumeRunStopped',
    'expertTeamProgressFallback',
    'expertTeamStatusDegraded',
    'expertTeamGovernanceTopology',
    'expertTeamGovernanceAutonomy',
    'expertTeamCheckpointLabel',
    'expertTeamRunIdTitle',
    'expertTeamCloseoutTitle',
    'expertTeamQualityGate',
    'expertTeamWorkboardQueue',
    'expertTeamStoppedChatFallback',
    'expertTeamTaskRequired',
    'expertTeamSelectionUnavailable',
  ]) {
    assert.match(assistantLocale, new RegExp(`${token}:\\s*_\\(`))
  }
  assert.doesNotMatch(assistant, /message\s*=\s*humanizeError\(e,\s*mode === 'run'/)
  assert.doesNotMatch(assistant, /message\s*=\s*humanizeError\(e,\s*'专家团运行失败'\)/)
  assert.doesNotMatch(assistant, /toast\('请先写下要交给专家团处理的任务'/)
  assert.doesNotMatch(assistant, /toast\('未找到选中的专家团'/)
  assert.doesNotMatch(assistant, /function\s+expertTeamPreview/)
  assert.match(assistant, /_isStreaming\s*=\s*true[\s\S]*clearActiveExpertGroupSelection\(\)/)
  assert.match(assistant, /event\.type === 'expert_delta'[\s\S]*shouldRender\s*=\s*false/)
  assert.match(assistant, /event\.type === 'moderator_delta'[\s\S]*shouldRender\s*=\s*false/)
  assert.match(assistant, /event\.type === 'expert_delta'[\s\S]*scheduleExpertTeamLiveDomUpdate\(aiMsg,\s*event,\s*'expert'\)/)
  assert.match(assistant, /event\.type === 'moderator_delta'[\s\S]*scheduleExpertTeamLiveDomUpdate\(aiMsg,\s*event,\s*'moderator'\)/)
  assert.match(assistant, /const \{ shouldRender,\s*shouldPersistNow \}\s*=\s*handleExpertTeamRunEvent\(aiMsg,\s*event\)/)
  assert.match(assistant, /const effectiveStopped = stopped && !isRunning && !finalDone && !failed/)
  assert.match(assistant, /fallback \? 'degraded' : finalDone \? 'done'/)
  assert.match(assistant, /hasExpertTeamModeratorFallback\(transcript\)[\s\S]*transcript\.some\(item => item\.type === 'final'\) && !fallback/)
  assert.match(assistant, /\$\{focusHtml\}[\s\S]*\$\{topPrimaryHtml\}[\s\S]*\$\{showWorkboard \? workboardHtml : ''\}[\s\S]*\$\{inlinePrimaryHtml\}[\s\S]*\$\{resumeActionsHtml\}[\s\S]*\$\{detailsHtml\}[\s\S]*\$\{processBlock\}/)
  assert.match(assistant, /renderExpertTeamRunDetails\(\{[\s\S]*activityHtml[\s\S]*closeoutHtml: isRunning \? '' : closeoutHtml[\s\S]*planHtml[\s\S]*traceHtml/)
  const renderedExpertTeamMessage = assistant.slice(assistant.indexOf('return `<div class="ast-msg ast-msg-ai ast-msg-expert-team"'), assistant.indexOf('function renderExpertTeamFocus'))
  assert.doesNotMatch(renderedExpertTeamMessage, /\$\{stageHtml\}/)
  assert.match(assistant, /<details class="ast-expert-run-details">/)
})

test('Assistant Expert Teams detail events render from locale keys', () => {
  const assistant = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')
  const assistantLocale = readFileSync(new URL('../src/locales/modules/assistant.js', import.meta.url), 'utf8')
  const detailBlock = assistant.slice(
    assistant.indexOf('function getExpertTeamPipeline'),
    assistant.indexOf('function renderMessages'),
  ).replace(/\/\/[^\n]*/g, '')
  for (const token of [
    'assistant.expertTeamPipelineAria',
    'assistant.expertTeamPipelinePrepare',
    'assistant.expertTeamPipelinePreparedDetail',
    'assistant.expertTeamPipelineDelivered',
    'assistant.expertTeamModeratorDegradedTitle',
    'assistant.expertTeamSynthesisConclusion',
    'assistant.expertTeamViewFullDeliverable',
    'assistant.expertTeamToolArgs',
    'assistant.expertTeamToolResult',
    'assistant.expertTeamToolRunCommand',
    'assistant.expertTeamToolNoTextResult',
    'assistant.expertTeamDoneExpandHint',
    'assistant.expertTeamContentMeta',
    'assistant.expertTeamDeliverySummaryHeading',
    'assistant.expertTeamCodeBlockLabel',
    'assistant.expertTeamGenericError',
    'assistant.expertTeamGenerating',
  ]) {
    assert.match(detailBlock, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const token of [
    'expertTeamPipelineAria',
    'expertTeamPipelinePrepare',
    'expertTeamToolRunCommand',
    'expertTeamToolNoTextResult',
    'expertTeamDoneExpandHint',
    'expertTeamContentMeta',
    'expertTeamDeliverySummaryHeading',
    'expertTeamGenericError',
  ]) {
    assert.match(assistantLocale, new RegExp(`${token}:\\s*_\\(`), `${token} should be translated`)
  }
  for (const hardcoded of [
    '执行管线',
    '主持综合已自动降级',
    '可重新综合',
    '查看完整交付',
    '已完成，可展开查看完整发言',
    '执行完成，无文本结果',
    '模型调用失败，正在重试第',
    '交付摘要',
    '代码块',
    '运行出错',
  ]) {
    assert.doesNotMatch(detailBlock, new RegExp(hardcoded))
  }
})

test('Assistant Expert Teams run card chrome renders from locale keys', () => {
  const assistant = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')
  const assistantLocale = readFileSync(new URL('../src/locales/modules/assistant.js', import.meta.url), 'utf8')
  for (const token of [
    'expertTeamPlanMetaLabel',
    "t('assistant.expertTeamStatsAria')",
    "t('assistant.expertTeamActivityStripAria')",
    "t('assistant.expertTeamDetailSummary')",
    "t('assistant.expertTeamTabAll')",
    "t('assistant.expertTeamStageBoardAria')",
    "t('assistant.expertTeamWorkboardAria')",
    "t('assistant.expertTeamActivityAria')",
    "t('assistant.expertTeamTraceTitle')",
    "t('assistant.expertTeamProcessSummary'",
  ]) {
    assert.match(assistant, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const token of [
    'expertTeamStatsAria',
    'expertTeamPlanMetaSequential',
    'expertTeamPlanMetaParallel',
    'expertTeamDetailSummary',
    'expertTeamWorkboardAria',
    'expertTeamTraceTitle',
    'expertTeamProcessSummary',
  ]) {
    assert.match(assistantLocale, new RegExp(`${token}:\\s*_\\(`), `${token} should be translated`)
  }
  const runCardBlock = assistant.slice(
    assistant.indexOf('function renderExpertTeamStatsBar'),
    assistant.indexOf('function getExpertTeamOperations'),
  ).replace(/\/\/[^\n]*/g, '')
  for (const hardcoded of [
    '运行统计',
    '最近动态',
    '暂无过程记录',
    '运行详情',
    '专家团阶段进度',
    '专家团执行看板',
    '专家执行队列',
    '专家团实时活动',
    '操作痕迹',
    '完整过程 · 默认收起',
  ]) {
    assert.doesNotMatch(runCardBlock, new RegExp(hardcoded))
  }

  const runtimeBlock = assistant.slice(
    assistant.indexOf('function getExpertTeamOperations'),
    assistant.indexOf('function renderExpertTeamEventItem'),
  ).replace(/\/\/[^\n]*/g, '')
  for (const token of [
    'assistant.expertTeamGovernanceTopology',
    'assistant.expertTeamGovernanceAutonomy',
    'assistant.expertTeamCheckpointLabel',
    'assistant.expertTeamRunIdTitle',
    'assistant.expertTeamCloseoutTitle',
    'assistant.expertTeamQualityGate',
    'assistant.expertTeamWorkboardQueue',
    'assistant.expertTeamModelRetryDetail',
    'assistant.expertTeamModeratorWaitingConclusion',
  ]) {
    assert.match(runtimeBlock, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const hardcoded of [
    '协作拓扑',
    '自治级别',
    '检查点',
    '运行编号',
    '交付复盘',
    '质量门禁',
    '执行队列',
    '模型请求失败，正在第',
    '汇总专家黑板，等待综合结论',
  ]) {
    assert.doesNotMatch(runtimeBlock, new RegExp(hardcoded))
  }
})

test('Assistant Expert Teams resume controls expose complete and synthesis-only paths', () => {
  const assistant = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')
  const assistantCss = readFileSync(new URL('../src/style/assistant.css', import.meta.url), 'utf8')
  assert.match(assistant, /getExpertTeamRemainingMembers\(message\)\.length\s*>\s*0/)
  assert.match(assistant, /function canResumeExpertTeamRun\(message\)[\s\S]*transcript\.some\(item => item\.type === 'stopped'\)[\s\S]*getExpertTeamRemainingMembers\(message\)\.length\s*>\s*0/)
  assert.doesNotMatch(assistant, /function canResumeExpertTeamRun\(message\)\s*\{\s*if \(!canResumeExpertTeamSynthesis\(message\)\)/)
  assert.match(assistant, /const resumeRunner = mode === 'run' \? resumeExpertTeamRun : resumeExpertTeamSynthesis/)
  assert.match(assistant, /resumeExpertTeamMessage\(Number\.parseInt\(resumeRunBtn\.dataset\.msgIdx,\s*10\),\s*'run'\)/)
  assert.match(assistantCss, /\.ast-expert-resume-btn--ghost/)
  assert.match(assistantCss, /\.ast-expert-badge--degraded/)
  assert.match(assistantCss, /\.ast-expert-workboard/)
  assert.match(assistantCss, /\.ast-expert-member-chip--running/)
  assert.match(assistantCss, /\.ast-expert-focus/)
  assert.match(assistantCss, /\.ast-expert-stage-row--warning/)
  assert.match(assistantCss, /\.ast-expert-closeout--degraded/)
  assert.match(assistantCss, /\.ast-expert-trace/)
  assert.match(assistantCss, /\.ast-expert-identity-pill--warning/)
  assert.match(assistantCss, /\.ast-expert-run-details-summary/)
})

test('Expert Teams styling keeps a responsive workbench layout', () => {
  assert.match(cssBlock('.expert-teams-shell'), /grid-template-columns:\s*minmax\(280px,\s*360px\)\s*minmax\(0,\s*1fr\)/)
  assert.match(cssBlock('.expert-member-picker'), /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/)
  assert.match(cssBlock('.expert-member-row'), /grid-template-columns:\s*18px\s*32px\s*minmax\(0,\s*1fr\)\s*auto/)
  assert.match(cssBlock('.expert-member-order-wrap'), /justify-content:\s*flex-end/)
  assert.match(cssBlock('.expert-member-order-label'), /border-radius:\s*var\(--radius-full\)/)
  assert.match(cssBlock('.expert-member-drag'), /cursor:\s*grab/)
  assert.match(cssBlock('.expert-member-row.is-dragging'), /opacity:\s*\.72/)
  assert.match(cssBlock('.expert-workflow-grid'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(cssBlock('.expert-workflow-grid-wide'), /grid-column:\s*1\s*\/\s*-1/)
  assert.match(css, /\.expert-form-section \.form-group\.is-muted/)
  assert.doesNotMatch(css, /\.expert-run-/)
  assert.match(css, /@media \(max-width:\s*(?:1120|1024)px\)[\s\S]*\.expert-teams-shell\s*\{[\s\S]*grid-template-columns:\s*1fr/)
})
