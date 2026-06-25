import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const assistantJs = readFileSync(new URL('../src/pages/assistant.js', import.meta.url), 'utf8')
const chatJs = readFileSync(new URL('../src/pages/chat.js', import.meta.url), 'utf8')

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `Expected ${name} to exist`)
  const argsOpen = source.indexOf('(', start)
  let parenDepth = 0
  let open = -1
  for (let i = argsOpen; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(') parenDepth++
    if (ch === ')') {
      parenDepth--
      if (parenDepth === 0) {
        open = source.indexOf('{', i)
        break
      }
    }
  }
  assert.notEqual(open, -1, `Could not find ${name} body start`)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`Could not parse ${name} body`)
}

test('assistant adds DeepSeek cache usage options only on the DeepSeek request path', () => {
  const applyDeepSeekChatOptions = functionBody(assistantJs, 'applyDeepSeekChatOptions')
  assert.match(applyDeepSeekChatOptions, /if\s*\(!deepseek\)\s*return\s+body/)
  assert.match(applyDeepSeekChatOptions, /body\.messages\s*=\s*sanitizeDeepSeekMessages\(body\.messages\s*\|\|\s*\[\]\)/)
  assert.match(applyDeepSeekChatOptions, /body\.stream_options\s*=\s*\{\s*include_usage:\s*true\s*\}/)

  const callChatCompletions = functionBody(assistantJs, 'callChatCompletions')
  assert.match(callChatCompletions, /const\s+deepseek\s*=\s*isDeepSeekConfig\(_config,\s*base\)/)
  assert.match(callChatCompletions, /applyDeepSeekChatOptions\(body,\s*\{\s*deepseek\s*\}\)/)
  assert.match(callChatCompletions, /if\s*\(deepseek\)\s*attachDeepSeekPrefixDiagnostics\(body\.messages,\s*\[\]\)/)
  assert.match(callChatCompletions, /if\s*\(deepseek\s*&&\s*json\.usage\)\s*captureDeepSeekUsage\(json\)/)

  const callAIWithTools = functionBody(assistantJs, 'callAIWithTools')
  assert.match(callAIWithTools, /const\s+deepseek\s*=\s*isDeepSeekConfig\(_config,\s*base\)/)
  assert.match(callAIWithTools, /applyDeepSeekChatOptions\(body,\s*\{\s*deepseek,\s*tools:\s*tools\.length\s*>\s*0\s*\}\)/)
  assert.match(callAIWithTools, /if\s*\(deepseek\)\s*attachDeepSeekPrefixDiagnostics\(body\.messages,\s*tools\)/)
  assert.match(callAIWithTools, /if\s*\(deepseek\s*&&\s*json\.usage\)\s*captureDeepSeekUsage\(json\)/)
})

test('assistant strips ordinary DeepSeek reasoning but keeps tool-call reasoning for compatibility', () => {
  const sanitizeDeepSeekMessages = functionBody(assistantJs, 'sanitizeDeepSeekMessages')
  assert.match(sanitizeDeepSeekMessages, /const\s+hasToolCalls\s*=\s*Array\.isArray\(next\.tool_calls\)\s*&&\s*next\.tool_calls\.length\s*>\s*0/)
  assert.match(sanitizeDeepSeekMessages, /next\.role\s*===\s*'assistant'\s*&&\s*next\.reasoning_content\s*&&\s*!hasToolCalls/)
  assert.match(sanitizeDeepSeekMessages, /delete\s+next\.reasoning_content/)

  const callAIWithTools = functionBody(assistantJs, 'callAIWithTools')
  assert.match(callAIWithTools, /if\s*\(deepseek\s*&&\s*reasoningBuf\)\s*assistantMsg\.reasoning_content\s*=\s*reasoningBuf/)
  assert.match(callAIWithTools, /content:\s*contentBuf\s*\|\|\s*\(deepseek\s*\?\s*''\s*:\s*null\)/)
})

test('DeepSeek uses a stable system/tool prefix while plan mode still blocks writes at execution time', () => {
  const buildProviderMessages = functionBody(assistantJs, 'buildProviderMessages')
  assert.match(buildProviderMessages, /if\s*\(!deepseek\)\s*return\s+\[\{\s*role:\s*'system',\s*content:\s*await\s+buildSystemPromptAsync\(\)\s*\},\s*\.\.\.messages\]/)
  assert.match(buildProviderMessages, /return\s+\[\{\s*role:\s*'system',\s*content:\s*buildSystemPrompt\(\)\s*\},\s*\.\.\.messages\]/)

  const getEnabledTools = functionBody(assistantJs, 'getEnabledTools')
  assert.match(getEnabledTools, /const\s+keepSchemaStable\s*=\s*isDeepSeekConfig\(\)/)
  assert.match(getEnabledTools, /mode\.readOnly\s*&&\s*!keepSchemaStable/)

  const executeToolWithSafety = functionBody(assistantJs, 'executeToolWithSafety')
  assert.match(assistantJs, /const\s+PLAN_MODE_WRITER_TOOLS\s*=\s*new\s+Set\(\['write_file',\s*'skills_install_dep',\s*'skillhub_install'\]\)/)
  assert.match(executeToolWithSafety, /mode\.readOnly\s*&&\s*\(PLAN_MODE_WRITER_TOOLS\.has\(toolName\)\s*\|\|\s*isBrowserWrite\)/)
  assert.match(executeToolWithSafety, /blocked:\s*"\$\{toolName\}"\s+is\s+a\s+writer\s+tool\s+and\s+plan\s+mode\s+is\s+read-only/)
})

test('DeepSeek long-context path compacts locally and records prefix diagnostics', () => {
  assert.match(assistantJs, /const\s+DEEPSEEK_CONTEXT_WINDOW_TOKENS\s*=\s*64000/)
  assert.match(assistantJs, /const\s+DEEPSEEK_COMPACT_RATIO\s*=\s*0\.72/)
  assert.match(assistantJs, /function\s+captureDeepSeekPrefixShape\s*\(messages,\s*tools\s*=\s*\[\],\s*contextRewriteVersion\s*=\s*0\)/)
  assert.match(assistantJs, /function\s+attachDeepSeekPrefixDiagnostics\s*\(messages,\s*tools\s*=\s*\[\]\)/)
  assert.match(assistantJs, /function\s+buildDeepSeekContextMessages\s*\(session\)/)
  assert.match(assistantJs, /function\s+buildContextMessagesForSession\s*\(session\)/)

  const captureDeepSeekPrefixShape = functionBody(assistantJs, 'captureDeepSeekPrefixShape')
  assert.match(captureDeepSeekPrefixShape, /systemHash:\s*shortHash\(systemPrompt\)/)
  assert.match(captureDeepSeekPrefixShape, /toolsHash:\s*shortHash\(toolsJson\)/)
  assert.match(captureDeepSeekPrefixShape, /contextRewriteVersion/)

  const attachDeepSeekPrefixDiagnostics = functionBody(assistantJs, 'attachDeepSeekPrefixDiagnostics')
  assert.match(attachDeepSeekPrefixDiagnostics, /_lastDebugInfo\.deepseekPrefix\s*=/)
  assert.match(attachDeepSeekPrefixDiagnostics, /reasons\.push\('system'\)/)
  assert.match(attachDeepSeekPrefixDiagnostics, /reasons\.push\('tools'\)/)
  assert.match(attachDeepSeekPrefixDiagnostics, /reasons\.push\('context_rewrite'\)/)

  const buildDeepSeekContextMessages = functionBody(assistantJs, 'buildDeepSeekContextMessages')
  assert.match(buildDeepSeekContextMessages, /const\s+threshold\s*=\s*DEEPSEEK_CONTEXT_WINDOW_TOKENS\s*\*\s*DEEPSEEK_COMPACT_RATIO/)
  assert.match(buildDeepSeekContextMessages, /return\s+compactDeepSeekContext\(session,\s*messages/)

  const buildContextMessagesForSession = functionBody(assistantJs, 'buildContextMessagesForSession')
  assert.match(buildContextMessagesForSession, /if\s*\(isDeepSeekConfig\(\)\)\s*return\s+buildDeepSeekContextMessages\(session\)/)
  assert.match(buildContextMessagesForSession, /return\s+trimChatMessagesToBudget\(modelFacingChatMessages\(session\.messages\)\)/)
})

test('send and retry both use the shared context builder', () => {
  const sendMessageDirect = functionBody(assistantJs, 'sendMessageDirect')
  assert.match(sendMessageDirect, /const\s+contextMessages\s*=\s*buildContextMessagesForSession\(session\)/)
  assert.doesNotMatch(sendMessageDirect, /\.slice\(-MAX_CONTEXT_TOKENS\)/)

  const retryAIResponse = functionBody(assistantJs, 'retryAIResponse')
  assert.match(retryAIResponse, /const\s+contextMessages\s*=\s*buildContextMessagesForSession\(session\)/)
  assert.doesNotMatch(retryAIResponse, /\.slice\(-MAX_CONTEXT_TOKENS\)/)
})

test('hosted agent mirrors DeepSeek cache usage collection for OpenAI-compatible calls', () => {
  const callHostedAI = functionBody(chatJs, 'callHostedAI')
  assert.match(chatJs, /function\s+isHostedDeepSeekConfig\s*\(config,\s*baseOverride\s*=\s*''\)/)
  assert.match(chatJs, /function\s+sanitizeHostedDeepSeekMessages\s*\(messages\)/)
  assert.match(chatJs, /function\s+hostedDeepSeekCacheUsage\s*\(usage\)/)
  assert.match(callHostedAI, /const\s+deepseek\s*=\s*isHostedDeepSeekConfig\(config,\s*base\)/)
  assert.match(callHostedAI, /messages:\s*deepseek\s*\?\s*sanitizeHostedDeepSeekMessages\(messages\)\s*:\s*messages/)
  assert.match(callHostedAI, /if\s*\(deepseek\)\s*body\.stream_options\s*=\s*\{\s*include_usage:\s*true\s*\}/)
  assert.match(callHostedAI, /const\s+usage\s*=\s*hostedDeepSeekCacheUsage\(json\.usage\)/)
  assert.match(callHostedAI, /_hostedRuntime\.lastUsage\s*=\s*usage/)
})
