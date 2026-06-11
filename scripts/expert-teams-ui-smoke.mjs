#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const distDir = path.join(root, 'dist')
const artifactsDir = path.join(root, 'artifacts', 'expert-teams')
const stateDir = path.join(artifactsDir, 'state')
const port = Number(process.env.EXPERT_TEAMS_SMOKE_PORT || 15180)
const baseUrl = `http://127.0.0.1:${port}`
const url = `${baseUrl}/#/expert-teams`
const distReadyTimeoutMs = Number(process.env.EXPERT_TEAMS_SMOKE_DIST_TIMEOUT_MS || 45000)
const distStableMs = Number(process.env.EXPERT_TEAMS_SMOKE_DIST_STABLE_MS || 1500)

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForServer(target, timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(target)
      if (response.ok) return
    } catch {}
    await wait(350)
  }
  throw new Error(`Server did not become ready: ${target}`)
}

function normalizeDistReference(value) {
  const cleanValue = String(value || '').split(/[?#]/, 1)[0].replace(/^\.?\//, '')
  return cleanValue.startsWith('assets/') ? cleanValue : ''
}

function extractDistAssetRefs(indexHtml) {
  const refs = new Set()
  const attributePattern = /\b(?:src|href)=["']([^"']+)["']/g
  let match
  while ((match = attributePattern.exec(indexHtml))) {
    const ref = normalizeDistReference(match[1])
    if (ref) refs.add(ref)
  }
  return [...refs].sort()
}

async function listDistFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listDistFiles(fullPath, baseDir))
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath)
      files.push({
        path: path.relative(baseDir, fullPath).replaceAll(path.sep, '/'),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function createDistSnapshot() {
  const indexPath = path.join(distDir, 'index.html')
  let indexHtml
  try {
    indexHtml = await fs.readFile(indexPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ready: false, reason: 'dist/index.html is missing' }
    throw error
  }

  const assetRefs = extractDistAssetRefs(indexHtml)
  for (const assetRef of assetRefs) {
    try {
      await fs.stat(path.join(distDir, assetRef))
    } catch (error) {
      if (error?.code === 'ENOENT') return { ready: false, reason: `${assetRef} referenced by index.html is missing` }
      throw error
    }
  }

  let files
  try {
    files = await listDistFiles(distDir)
  } catch (error) {
    if (error?.code === 'ENOENT') return { ready: false, reason: 'dist changed while scanning' }
    throw error
  }
  return {
    ready: true,
    assetRefs,
    fileCount: files.length,
    signature: JSON.stringify({ assetRefs, files }),
  }
}

async function waitForDistReady(timeoutMs = distReadyTimeoutMs, stableMs = distStableMs) {
  const started = Date.now()
  let lastSignature = ''
  let lastChangeAt = 0
  let lastReason = 'dist has not been checked yet'

  while (Date.now() - started < timeoutMs) {
    const snapshot = await createDistSnapshot()
    if (snapshot.ready) {
      if (snapshot.signature !== lastSignature) {
        lastSignature = snapshot.signature
        lastChangeAt = Date.now()
        lastReason = 'dist is still changing'
      } else if (Date.now() - lastChangeAt >= stableMs) {
        console.log(`[expert-teams-ui-smoke] dist ready: ${snapshot.fileCount} files, ${snapshot.assetRefs.length} entry assets stable for ${stableMs}ms`)
        return snapshot
      }
    } else {
      lastSignature = ''
      lastChangeAt = Date.now()
      lastReason = snapshot.reason
    }
    await wait(250)
  }

  throw new Error(`dist did not become stable within ${timeoutMs}ms (${lastReason}). Run npm run build separately before npm run expert-teams:ui.`)
}

function startServer() {
  const child = spawn(process.execPath, ['scripts/serve.js', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      OPENCLAW_HOME: stateDir,
      DISABLE_GATEWAY_SPAWN: '1',
    },
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  child.on('exit', code => {
    if (code && code !== 0) console.error(output)
  })
  return { child, getOutput: () => output }
}

async function stopServer(child) {
  if (!child || child.killed) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    wait(2000).then(() => child.kill('SIGKILL')),
  ])
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    console.warn(`[expert-teams-ui-smoke] bundled Chromium unavailable, trying system Chrome: ${error.message}`)
    return chromium.launch({ channel: 'chrome', headless: true })
  }
}

async function pageOverflow(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await pageOverflow(page)
  const maxScrollWidth = Math.max(overflow.scrollWidth, overflow.bodyScrollWidth)
  if (maxScrollWidth > overflow.innerWidth + 2) {
    throw new Error(`${label} has horizontal overflow: scrollWidth=${maxScrollWidth}, innerWidth=${overflow.innerWidth}`)
  }
  return overflow
}

function isIgnoredConsoleError(message) {
  return /\[ws\].*(AUTH_TOKEN_MISSING|生成 connect frame 失败|Failed to fetch)/.test(String(message || ''))
}

function consumeExpectedConsoleError(consoleErrors, pattern) {
  const index = consoleErrors.findIndex(message => pattern.test(String(message || '')))
  if (index >= 0) consoleErrors.splice(index, 1)
}

async function clickAction(page, action) {
  await page.locator(`.expert-teams-actions [data-action="${action}"], .expert-editor-actions [data-action="${action}"]`).last().click()
}

async function waitForExpertTeamsIdle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  try {
    await page.waitForFunction(() => {
      const loadingText = ['加载', 'Loading']
      const hasSkeleton = !!document.querySelector('.expert-list-skeleton, .loading-placeholder')
      const editorText = document.querySelector('#expert-teams-editor')?.textContent || ''
      const hasAddButton = !!document.querySelector('.expert-teams-actions [data-action="add"]')
      return hasAddButton && !hasSkeleton && !loadingText.some(text => editorText.includes(text))
    }, { timeout: 30000 })
  } catch (error) {
    await fs.writeFile(path.join(artifactsDir, 'expert-teams-timeout.html'), await page.content())
    await page.screenshot({ path: path.join(artifactsDir, 'expert-teams-timeout.png'), fullPage: true })
    throw error
  }
}

async function saveAndWait(page, cmd) {
  await Promise.all([
    page.waitForResponse(response => response.url().includes(`/__api/${cmd}`) && response.ok()),
    clickAction(page, 'save'),
  ])
}

async function createExpert(page, expert) {
  await clickAction(page, 'add')
  await page.locator('#expert-id').fill(expert.id)
  await page.locator('#expert-name').fill(expert.name)
  await page.locator('#expert-title').fill(expert.title)
  await page.locator('#expert-description').fill(expert.description)
  await page.locator('#expert-system-prompt').fill(expert.prompt)
  await saveAndWait(page, 'save_expert')
  await page.locator(`[data-select-id="${expert.id}"]`).waitFor({ timeout: 10000 })
}

async function createBlankTeamDraft(page) {
  await clickAction(page, 'add')
  const blankTemplate = page.locator('.expert-template-picker-overlay [data-action="template-blank"]')
  if (await blankTemplate.isVisible({ timeout: 1000 }).catch(() => false)) {
    await blankTemplate.click()
  }
  await page.locator('#group-id').waitFor({ timeout: 10000 })
}

async function checkGroupTemplatePickerAppliesDraft(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)

  const expectedTemplates = [
    { index: 0, mode: 'review', maxRounds: 3, maxParallel: 3 },
    { index: 1, mode: 'panel', maxRounds: 2, maxParallel: 3 },
    { index: 2, mode: 'creation', maxRounds: 3, maxParallel: 4 },
    { index: 3, mode: 'debate', maxRounds: 3, maxParallel: 4 },
    { index: 4, mode: 'research', maxRounds: 3, maxParallel: 3 },
    { index: 5, mode: 'sequential', maxRounds: 3, maxParallel: 3 },
  ]
  const drafts = []

  for (const expected of expectedTemplates) {
    await clickAction(page, 'add')
    const picker = page.locator('.expert-template-picker-overlay')
    await picker.waitFor({ timeout: 10000 })
    const templateCount = await picker.locator('[data-template-idx]').count()
    if (templateCount !== expectedTemplates.length) {
      throw new Error(`Template picker rendered ${templateCount} templates instead of ${expectedTemplates.length}`)
    }

    await picker.locator(`[data-template-idx="${expected.index}"]`).click()
    await page.locator('#group-name').waitFor({ timeout: 10000 })
    if (await picker.isVisible({ timeout: 1000 }).catch(() => false)) {
      throw new Error(`Template picker stayed open after selecting template ${expected.index}`)
    }

    const draft = {
      index: expected.index,
      templateCount,
      name: await page.locator('#group-name').inputValue(),
      description: await page.locator('#group-description').inputValue(),
      mode: await page.locator('#group-mode').inputValue(),
      maxRounds: await page.locator('#group-max-rounds').inputValue(),
      maxParallel: await page.locator('#group-max-parallel').inputValue(),
    }
    if (!draft.name || /^expertTeams\./.test(draft.name)) {
      throw new Error(`Template ${expected.index} did not apply a localized team name: ${draft.name || '<empty>'}`)
    }
    if (!draft.description || /^expertTeams\./.test(draft.description)) {
      throw new Error(`Template ${expected.index} did not apply a localized team description`)
    }
    if (draft.mode !== expected.mode) {
      throw new Error(`Template ${expected.index} should create a ${expected.mode} team, got ${draft.mode}`)
    }
    if (Number(draft.maxRounds) !== expected.maxRounds || Number(draft.maxParallel) !== expected.maxParallel) {
      throw new Error(`Template ${expected.index} wrote unexpected workflow limits: rounds=${draft.maxRounds}, parallel=${draft.maxParallel}`)
    }
    drafts.push({
      index: draft.index,
      name: draft.name,
      mode: draft.mode,
      maxRounds: Number(draft.maxRounds),
      maxParallel: Number(draft.maxParallel),
      descriptionLength: draft.description.length,
    })
  }

  return {
    templateCount: drafts.length,
    templates: drafts,
  }
}

async function checkGroupTemplatePickerCancelKeepsDraft(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)

  const beforeCancel = await groupEditorSnapshot(page)
  await clickAction(page, 'add')
  const picker = page.locator('.expert-template-picker-overlay')
  await picker.waitFor({ timeout: 10000 })
  await picker.click({ position: { x: 8, y: 8 } })
  if (await picker.isVisible({ timeout: 1000 }).catch(() => false)) {
    throw new Error('Template picker stayed open after backdrop cancel')
  }

  const afterCancel = await groupEditorSnapshot(page)
  if (JSON.stringify(afterCancel) !== JSON.stringify(beforeCancel)) {
    throw new Error(`Template picker cancel changed editor state: before=${JSON.stringify(beforeCancel)} after=${JSON.stringify(afterCancel)}`)
  }

  return afterCancel
}

async function groupEditorSnapshot(page) {
  return page.evaluate(() => {
    const groupId = document.querySelector('#group-id')
    const groupName = document.querySelector('#group-name')
    const groupMode = document.querySelector('#group-mode')
    const selectedRows = document.querySelectorAll('#expert-member-picker [data-member-row].is-selected')
    return {
      hasGroupEditor: !!groupId,
      idValue: groupId?.value || '',
      nameValue: groupName?.value || '',
      modeValue: groupMode?.value || '',
      selectedCount: selectedRows.length,
    }
  })
}

async function createPersistedTeam(page) {
  const experts = [
    {
      id: 'smoke-reviewer',
      name: 'Smoke Reviewer',
      title: 'Quality Gate',
      description: 'Checks risky edges before release.',
      prompt: 'Review the task for correctness, UX risk, and missing validation.',
    },
    {
      id: 'smoke-planner',
      name: 'Smoke Planner',
      title: 'Execution Planner',
      description: 'Turns ambiguous requests into ordered steps.',
      prompt: 'Create a concise plan and identify the smallest safe next action.',
    },
  ]

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="experts"]').click()
  await waitForExpertTeamsIdle(page)
  for (const expert of experts) await createExpert(page, expert)

  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)
  await createBlankTeamDraft(page)
  await page.locator('#group-id').fill('smoke-review-panel')
  await page.locator('#group-name').fill('Smoke Review Panel')
  await page.locator('#group-description').fill('Verifies that expert team config survives a real browser save and reload.')
  await page.locator('#group-mode').selectOption('review')
  await page.locator('input[data-member-toggle][value="smoke-planner"]').setChecked(true)
  await page.locator('input[data-member-toggle][value="smoke-reviewer"]').setChecked(true)
  await page.locator('#group-moderator').selectOption('smoke-reviewer')
  await saveAndWait(page, 'save_expert_group')
  await page.locator('[data-select-id="smoke-review-panel"]').waitFor({ timeout: 10000 })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await page.locator('[data-select-id="smoke-review-panel"]').click()
  await page.locator('#group-id').waitFor({ timeout: 10000 })

  const persisted = await page.evaluate(async () => {
    const [expertsResponse, groupsResponse] = await Promise.all([
      fetch('/__api/list_experts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(response => response.json()),
      fetch('/__api/list_expert_groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(response => response.json()),
    ])
    return { experts: expertsResponse, groups: groupsResponse }
  })
  const savedExpertIds = new Set((Array.isArray(persisted.experts) ? persisted.experts : []).map(expert => expert.id))
  const savedGroup = (Array.isArray(persisted.groups) ? persisted.groups : []).find(group => group.id === 'smoke-review-panel')
  if (!savedExpertIds.has('smoke-reviewer') || !savedExpertIds.has('smoke-planner')) {
    throw new Error('Saved smoke experts were not returned by the API after reload')
  }
  if (!savedGroup || savedGroup.moderatorExpertId !== 'smoke-reviewer') {
    throw new Error('Saved smoke expert team did not preserve its moderator')
  }
  const savedMemberIds = (Array.isArray(savedGroup.members) ? savedGroup.members : []).map(member => member.expertId)
  if (savedMemberIds.join(',') !== 'smoke-planner,smoke-reviewer') {
    throw new Error(`Saved smoke expert team members were not ordered correctly: ${savedMemberIds.join(',')}`)
  }

  const selectedCount = await page.locator('#expert-member-picker [data-member-row].is-selected').count()
  if (selectedCount !== 2) throw new Error(`Reloaded smoke team selected ${selectedCount} members instead of 2`)

  return {
    experts: [...savedExpertIds].filter(id => id.startsWith('smoke-')).length,
    groupId: savedGroup.id,
    moderatorExpertId: savedGroup.moderatorExpertId,
    memberIds: savedMemberIds,
  }
}

async function checkTemplateTeamSavePersists(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)

  await clickAction(page, 'add')
  const picker = page.locator('.expert-template-picker-overlay')
  await picker.waitFor({ timeout: 10000 })
  await picker.locator('[data-template-idx="1"]').click()
  await page.locator('#group-id').waitFor({ timeout: 10000 })
  await page.locator('#group-id').fill('smoke-template-product')
  await page.locator('input[data-member-toggle][value="smoke-planner"]').setChecked(true)
  await page.locator('#group-moderator').selectOption('smoke-planner')
  await saveAndWait(page, 'save_expert_group')
  await page.locator('[data-select-id="smoke-template-product"]').waitFor({ timeout: 10000 })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await page.locator('[data-select-id="smoke-template-product"]').click()
  await page.locator('#group-id').waitFor({ timeout: 10000 })

  const saved = await page.evaluate(async () => {
    const response = await fetch('/__api/list_expert_groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`list_expert_groups failed: ${response.status}`)
    const groups = await response.json()
    return (Array.isArray(groups) ? groups : []).find(group => group.id === 'smoke-template-product') || null
  })
  if (!saved) throw new Error('Saved template team was not returned by the API after reload')
  const memberIds = (Array.isArray(saved.members) ? saved.members : []).map(member => member.expertId)
  if (saved.mode !== 'panel') throw new Error(`Saved template team mode changed to ${saved.mode}`)
  if (saved.maxRounds !== 2 || saved.maxParallel !== 3) {
    throw new Error(`Saved template team limits changed: rounds=${saved.maxRounds}, parallel=${saved.maxParallel}`)
  }
  if (saved.moderatorExpertId !== 'smoke-planner') {
    throw new Error(`Saved template team moderator changed to ${saved.moderatorExpertId || '<none>'}`)
  }
  if (memberIds.join(',') !== 'smoke-planner') {
    throw new Error(`Saved template team members changed: ${memberIds.join(',')}`)
  }

  const ui = {
    mode: await page.locator('#group-mode').inputValue(),
    maxRounds: await page.locator('#group-max-rounds').inputValue(),
    maxParallel: await page.locator('#group-max-parallel').inputValue(),
    selectedCount: await page.locator('#expert-member-picker [data-member-row].is-selected').count(),
    moderatorValue: await page.locator('#group-moderator').inputValue(),
  }
  if (ui.mode !== 'panel' || ui.maxRounds !== '2' || ui.maxParallel !== '3') {
    throw new Error(`Reloaded template team UI values changed: ${JSON.stringify(ui)}`)
  }
  if (ui.selectedCount !== 1 || ui.moderatorValue !== 'smoke-planner') {
    throw new Error(`Reloaded template team member UI changed: ${JSON.stringify(ui)}`)
  }

  return {
    groupId: saved.id,
    mode: saved.mode,
    maxRounds: saved.maxRounds,
    maxParallel: saved.maxParallel,
    moderatorExpertId: saved.moderatorExpertId,
    memberIds,
  }
}

async function checkModeratorClearsWhenMemberRemoved(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)

  await createBlankTeamDraft(page)
  await page.locator('#group-id').fill('smoke-moderator-sync')
  await page.locator('#group-name').fill('Smoke Moderator Sync')
  await page.locator('#group-description').fill('Verifies moderator choices update immediately when members change.')
  await page.locator('#group-mode').selectOption('panel')
  await page.locator('input[data-member-toggle][value="smoke-planner"]').setChecked(true)
  await page.locator('input[data-member-toggle][value="smoke-reviewer"]').setChecked(true)
  await page.locator('#group-moderator').selectOption('smoke-reviewer')

  const beforeRemoval = await page.locator('#group-moderator').inputValue()
  if (beforeRemoval !== 'smoke-reviewer') {
    throw new Error(`Moderator setup selected ${beforeRemoval || '<none>'} before member removal`)
  }

  await page.locator('input[data-member-toggle][value="smoke-reviewer"]').setChecked(false)
  await page.waitForFunction(() => document.querySelector('#group-moderator')?.value === '', null, { timeout: 5000 })
  const ui = {
    moderatorValue: await page.locator('#group-moderator').inputValue(),
    reviewerOptions: await page.locator('#group-moderator option[value="smoke-reviewer"]').count(),
    selectedCount: await page.locator('#expert-member-picker [data-member-row].is-selected').count(),
  }
  if (ui.moderatorValue || ui.reviewerOptions !== 0 || ui.selectedCount !== 1) {
    throw new Error(`Moderator choices did not refresh after member removal: ${JSON.stringify(ui)}`)
  }

  await saveAndWait(page, 'save_expert_group')
  await page.locator('[data-select-id="smoke-moderator-sync"]').waitFor({ timeout: 10000 })

  const saved = await page.evaluate(async () => {
    const response = await fetch('/__api/list_expert_groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`list_expert_groups failed: ${response.status}`)
    const groups = await response.json()
    return (Array.isArray(groups) ? groups : []).find(group => group.id === 'smoke-moderator-sync') || null
  })
  if (!saved) throw new Error('Moderator sync smoke team was not returned by the API')
  const memberIds = (Array.isArray(saved.members) ? saved.members : []).map(member => member.expertId)
  if (saved.moderatorExpertId) {
    throw new Error(`Removed member stayed as saved moderator: ${saved.moderatorExpertId}`)
  }
  if (memberIds.join(',') !== 'smoke-planner') {
    throw new Error(`Moderator sync team saved unexpected members: ${memberIds.join(',')}`)
  }

  return {
    groupId: saved.id,
    beforeRemoval,
    moderatorValue: saved.moderatorExpertId || '',
    memberIds,
    reviewerOptionsAfterRemoval: ui.reviewerOptions,
  }
}

async function checkMemberDragOrderPersists(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)

  await createBlankTeamDraft(page)
  await page.locator('#group-id').fill('smoke-order-sync')
  await page.locator('#group-name').fill('Smoke Order Sync')
  await page.locator('#group-description').fill('Verifies drag ordering is saved and restored.')
  await page.locator('#group-mode').selectOption('sequential')
  await page.locator('input[data-member-toggle][value="smoke-planner"]').setChecked(true)
  await page.locator('input[data-member-toggle][value="smoke-reviewer"]').setChecked(true)

  const beforeDrag = await selectedMemberRows(page)
  if (beforeDrag.length !== 2) {
    throw new Error(`Member drag setup selected ${beforeDrag.length} members instead of 2`)
  }
  const expectedOrder = [beforeDrag[1].id, beforeDrag[0].id]
  await page.evaluate(({ sourceId, targetId }) => {
    const sourceRow = document.querySelector(`#expert-member-picker [data-member-row="${sourceId}"]`)
    const targetRow = document.querySelector(`#expert-member-picker [data-member-row="${targetId}"]`)
    const sourceHandle = sourceRow?.querySelector('[data-member-drag]')
    if (!sourceRow || !targetRow || !sourceHandle) throw new Error('Member drag rows were not found')
    const dataTransfer = new DataTransfer()
    const rect = targetRow.getBoundingClientRect()
    const eventInit = {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY: rect.top + 1,
    }
    sourceHandle.dispatchEvent(new DragEvent('dragstart', eventInit))
    targetRow.dispatchEvent(new DragEvent('dragover', eventInit))
    targetRow.dispatchEvent(new DragEvent('drop', eventInit))
    sourceRow.dispatchEvent(new DragEvent('dragend', eventInit))
  }, { sourceId: beforeDrag[1].id, targetId: beforeDrag[0].id })

  const afterDrag = await selectedMemberRows(page)
  const afterDragIds = afterDrag.map(row => row.id)
  const afterDragOrders = afterDrag.map(row => row.order)
  if (afterDragIds.join(',') !== expectedOrder.join(',') || afterDragOrders.join(',') !== '1,2') {
    throw new Error(`Member drag order did not update UI order: ${JSON.stringify(afterDrag)}`)
  }

  await saveAndWait(page, 'save_expert_group')
  await page.locator('[data-select-id="smoke-order-sync"]').waitFor({ timeout: 10000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await page.locator('[data-select-id="smoke-order-sync"]').click()
  await page.locator('#group-id').waitFor({ timeout: 10000 })

  const persisted = await page.evaluate(async () => {
    const response = await fetch('/__api/list_expert_groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`list_expert_groups failed: ${response.status}`)
    const groups = await response.json()
    return (Array.isArray(groups) ? groups : []).find(group => group.id === 'smoke-order-sync') || null
  })
  if (!persisted) throw new Error('Member drag smoke team was not returned by the API')
  const persistedMembers = (Array.isArray(persisted.members) ? persisted.members : []).map(member => ({
    id: member.expertId,
    order: member.order,
  }))
  const persistedIds = persistedMembers.map(member => member.id)
  const persistedOrders = persistedMembers.map(member => member.order)
  if (persistedIds.join(',') !== expectedOrder.join(',') || persistedOrders.join(',') !== '1,2') {
    throw new Error(`Dragged member order was not persisted: ${JSON.stringify(persistedMembers)}`)
  }

  const reloadedRows = await selectedMemberRows(page)
  if (reloadedRows.map(row => row.id).join(',') !== expectedOrder.join(',')) {
    throw new Error(`Dragged member order was not restored in UI: ${JSON.stringify(reloadedRows)}`)
  }

  return {
    groupId: persisted.id,
    beforeDrag,
    afterDrag,
    persistedMembers,
  }
}

async function selectedMemberRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('#expert-member-picker [data-member-row].is-selected')].map(row => ({
    id: row.dataset.memberRow || '',
    order: row.querySelector('[data-member-order]')?.value || '',
    label: row.querySelector('.expert-member-order-label')?.textContent || '',
  })))
}

async function checkEmptyTeamSaveIsBlocked(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)

  await createBlankTeamDraft(page)
  await page.locator('#group-id').fill('smoke-empty-team')
  await page.locator('#group-name').fill('Smoke Empty Team')
  await page.locator('#group-description').fill('Verifies empty teams are blocked before save.')

  const saveRequest = page.waitForRequest(
    request => request.url().includes('/__api/save_expert_group'),
    { timeout: 700 },
  ).catch(() => null)
  await clickAction(page, 'save')
  const unexpectedRequest = await saveRequest
  if (unexpectedRequest) {
    throw new Error('Empty expert team attempted to call save_expert_group')
  }

  const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
    hasText: /请至少为专家团选择一位专家|Select at least one expert for the team/,
  })
  await toastMessage.first().waitFor({ timeout: 5000 })

  const saved = await page.evaluate(async () => {
    const response = await fetch('/__api/list_expert_groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`list_expert_groups failed: ${response.status}`)
    const groups = await response.json()
    return (Array.isArray(groups) ? groups : []).find(group => group.id === 'smoke-empty-team') || null
  })
  if (saved) throw new Error('Empty expert team was persisted despite validation failure')

  const draftState = {
    idValue: await page.locator('#group-id').inputValue(),
    selectedCount: await page.locator('#expert-member-picker [data-member-row].is-selected').count(),
    toastText: await toastMessage.first().innerText(),
  }
  if (draftState.idValue !== 'smoke-empty-team' || draftState.selectedCount !== 0) {
    throw new Error(`Empty team validation changed the draft unexpectedly: ${JSON.stringify(draftState)}`)
  }

  return draftState
}

async function checkInvalidTeamIdSaveIsBlocked(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)

  await createBlankTeamDraft(page)
  await page.locator('#group-id').fill('smoke invalid/team')
  await page.locator('#group-name').fill('Smoke Invalid Team')
  await page.locator('#group-description').fill('Verifies invalid team IDs are blocked before save.')
  await page.locator('input[data-member-toggle][value="smoke-planner"]').setChecked(true)

  const saveRequest = page.waitForRequest(
    request => request.url().includes('/__api/save_expert_group'),
    { timeout: 700 },
  ).catch(() => null)
  await clickAction(page, 'save')
  const unexpectedRequest = await saveRequest
  if (unexpectedRequest) {
    throw new Error('Invalid expert team attempted to call save_expert_group')
  }

  const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
    hasText: /ID 只能包含字母、数字、点、下划线和短横线|ID can only include letters, numbers, dots, underscores, and hyphens/,
  })
  await toastMessage.first().waitFor({ timeout: 5000 })

  const saved = await page.evaluate(async () => {
    const response = await fetch('/__api/list_expert_groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`list_expert_groups failed: ${response.status}`)
    const groups = await response.json()
    return (Array.isArray(groups) ? groups : []).find(group => group.id === 'smoke invalid/team') || null
  })
  if (saved) throw new Error('Invalid expert team ID was persisted despite validation failure')

  const draftState = {
    idValue: await page.locator('#group-id').inputValue(),
    selectedCount: await page.locator('#expert-member-picker [data-member-row].is-selected').count(),
    toastText: await toastMessage.first().innerText(),
  }
  if (draftState.idValue !== 'smoke invalid/team' || draftState.selectedCount !== 1) {
    throw new Error(`Invalid team ID validation changed the draft unexpectedly: ${JSON.stringify(draftState)}`)
  }

  return draftState
}

async function checkInvalidExpertModelSaveIsBlocked(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="experts"]').click()
  await waitForExpertTeamsIdle(page)

  await clickAction(page, 'add')
  await page.locator('#expert-id').waitFor({ timeout: 10000 })
  await page.locator('#expert-id').fill('smoke-invalid-model')
  await page.locator('#expert-name').fill('Smoke Invalid Model')
  await page.locator('#expert-title').fill('Model Gate')
  await page.locator('#expert-description').fill('Verifies fixed model references are validated before save.')
  await page.locator('#expert-system-prompt').fill('Keep this expert as an unsaved validation draft.')
  await page.locator('#expert-model-inherit').selectOption('fixed')
  await page.locator('#expert-model-id').fill('smoke-invalid-model-ref')

  const saveRequest = page.waitForRequest(
    request => request.url().includes('/__api/save_expert'),
    { timeout: 700 },
  ).catch(() => null)
  await clickAction(page, 'save')
  const unexpectedRequest = await saveRequest
  if (unexpectedRequest) {
    throw new Error('Invalid expert fixed model attempted to call save_expert')
  }

  const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
    hasText: /指定模型时请填写 provider\/model|Enter provider\/model for a fixed model/,
  })
  await toastMessage.first().waitFor({ timeout: 5000 })

  const saved = await page.evaluate(async () => {
    const response = await fetch('/__api/list_experts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`list_experts failed: ${response.status}`)
    const experts = await response.json()
    return (Array.isArray(experts) ? experts : []).find(expert => expert.id === 'smoke-invalid-model') || null
  })
  if (saved) throw new Error('Invalid expert fixed model was persisted despite validation failure')

  const draftState = {
    idValue: await page.locator('#expert-id').inputValue(),
    modelMode: await page.locator('#expert-model-inherit').inputValue(),
    modelId: await page.locator('#expert-model-id').inputValue(),
    toastText: await toastMessage.first().innerText(),
  }
  if (
    draftState.idValue !== 'smoke-invalid-model'
    || draftState.modelMode !== 'fixed'
    || draftState.modelId !== 'smoke-invalid-model-ref'
  ) {
    throw new Error(`Invalid expert model validation changed the draft unexpectedly: ${JSON.stringify(draftState)}`)
  }

  return draftState
}

async function checkInvalidExpertIdSaveIsBlocked(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="experts"]').click()
  await waitForExpertTeamsIdle(page)

  await clickAction(page, 'add')
  await page.locator('#expert-id').waitFor({ timeout: 10000 })
  await page.locator('#expert-id').fill('smoke invalid/expert')
  await page.locator('#expert-name').fill('Smoke Invalid Expert ID')
  await page.locator('#expert-title').fill('Identity Gate')
  await page.locator('#expert-description').fill('Verifies invalid expert IDs are blocked before save.')
  await page.locator('#expert-system-prompt').fill('Keep this invalid ID expert as an unsaved validation draft.')

  const saveRequest = page.waitForRequest(
    request => request.url().includes('/__api/save_expert'),
    { timeout: 700 },
  ).catch(() => null)
  await clickAction(page, 'save')
  const unexpectedRequest = await saveRequest
  if (unexpectedRequest) {
    throw new Error('Invalid expert ID attempted to call save_expert')
  }

  const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
    hasText: /ID 只能包含字母、数字、点、下划线和短横线|ID can only include letters, numbers, dots, underscores, and hyphens/,
  })
  await toastMessage.first().waitFor({ timeout: 5000 })

  const saved = await page.evaluate(async () => {
    const response = await fetch('/__api/list_experts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`list_experts failed: ${response.status}`)
    const experts = await response.json()
    return (Array.isArray(experts) ? experts : []).find(expert => expert.id === 'smoke invalid/expert') || null
  })
  if (saved) throw new Error('Invalid expert ID was persisted despite validation failure')

  const draftState = {
    idValue: await page.locator('#expert-id').inputValue(),
    nameValue: await page.locator('#expert-name').inputValue(),
    toastText: await toastMessage.first().innerText(),
  }
  if (draftState.idValue !== 'smoke invalid/expert' || draftState.nameValue !== 'Smoke Invalid Expert ID') {
    throw new Error(`Invalid expert ID validation changed the draft unexpectedly: ${JSON.stringify(draftState)}`)
  }

  return draftState
}

async function checkExpertSaveFailurePreservesDraft(page, consoleErrors) {
  let intercepted = false
  const routePattern = '**/__api/save_expert'
  const failSaveExpert = async route => {
    if (intercepted) return route.continue()
    intercepted = true
    await route.fulfill({
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'Smoke forced save_expert failure' }),
    })
  }

  await page.route(routePattern, failSaveExpert)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
    await waitForExpertTeamsIdle(page)
    await page.locator('[data-expert-tab="experts"]').click()
    await waitForExpertTeamsIdle(page)

    await clickAction(page, 'add')
    await page.locator('#expert-id').waitFor({ timeout: 10000 })
    await page.locator('#expert-id').fill('smoke-save-failure')
    await page.locator('#expert-name').fill('Smoke Save Failure')
    await page.locator('#expert-title').fill('Failure Gate')
    await page.locator('#expert-description').fill('Verifies failed expert saves keep the dirty draft intact.')
    await page.locator('#expert-system-prompt').fill('Preserve this prompt when save_expert returns a server error.')

    await Promise.all([
      page.waitForResponse(response => response.url().includes('/__api/save_expert') && response.status() === 500),
      clickAction(page, 'save'),
    ])
    if (!intercepted) throw new Error('Failed expert save smoke did not intercept save_expert')
    await page.waitForTimeout(50)
    consumeExpectedConsoleError(consoleErrors, /Failed to load resource: the server responded with a status of 500/)

    const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
      hasText: /Smoke forced save_expert failure|保存失败|Save failed/,
    })
    await toastMessage.first().waitFor({ timeout: 5000 })

    const saved = await page.evaluate(async () => {
      const response = await fetch('/__api/list_experts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error(`list_experts failed: ${response.status}`)
      const experts = await response.json()
      return (Array.isArray(experts) ? experts : []).find(expert => expert.id === 'smoke-save-failure') || null
    })
    if (saved) throw new Error('Failed expert save was persisted despite a server error')

    const draftState = {
      idValue: await page.locator('#expert-id').inputValue(),
      nameValue: await page.locator('#expert-name').inputValue(),
      promptValue: await page.locator('#expert-system-prompt').inputValue(),
      toastText: await toastMessage.first().innerText(),
    }
    if (
      draftState.idValue !== 'smoke-save-failure'
      || draftState.nameValue !== 'Smoke Save Failure'
      || draftState.promptValue !== 'Preserve this prompt when save_expert returns a server error.'
    ) {
      throw new Error(`Failed expert save changed the dirty draft unexpectedly: ${JSON.stringify(draftState)}`)
    }

    return draftState
  } finally {
    await page.unroute(routePattern, failSaveExpert).catch(() => {})
  }
}

async function checkTeamSaveFailurePreservesDraft(page, consoleErrors) {
  let intercepted = false
  const routePattern = '**/__api/save_expert_group'
  const failSaveExpertGroup = async route => {
    if (intercepted) return route.continue()
    intercepted = true
    await route.fulfill({
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'Smoke forced save_expert_group failure' }),
    })
  }

  await page.route(routePattern, failSaveExpertGroup)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
    await waitForExpertTeamsIdle(page)
    await page.locator('[data-expert-tab="groups"]').click()
    await waitForExpertTeamsIdle(page)

    await createBlankTeamDraft(page)
    await page.locator('#group-id').fill('smoke-group-save-failure')
    await page.locator('#group-name').fill('Smoke Group Save Failure')
    await page.locator('#group-description').fill('Verifies failed expert team saves keep the dirty draft intact.')
    await page.locator('#group-mode').selectOption('sequential')
    await page.locator('#group-max-rounds').fill('3')
    await page.locator('#group-max-parallel').fill('2')
    await page.locator('input[data-member-toggle][value="smoke-planner"]').setChecked(true)
    await page.locator('#group-moderator').selectOption('smoke-planner')

    await Promise.all([
      page.waitForResponse(response => response.url().includes('/__api/save_expert_group') && response.status() === 500),
      clickAction(page, 'save'),
    ])
    if (!intercepted) throw new Error('Failed expert team save smoke did not intercept save_expert_group')
    await page.waitForTimeout(50)
    consumeExpectedConsoleError(consoleErrors, /Failed to load resource: the server responded with a status of 500/)

    const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
      hasText: /Smoke forced save_expert_group failure|保存失败|Save failed/,
    })
    await toastMessage.first().waitFor({ timeout: 5000 })

    const saved = await page.evaluate(async () => {
      const response = await fetch('/__api/list_expert_groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error(`list_expert_groups failed: ${response.status}`)
      const groups = await response.json()
      return (Array.isArray(groups) ? groups : []).find(group => group.id === 'smoke-group-save-failure') || null
    })
    if (saved) throw new Error('Failed expert team save was persisted despite a server error')

    const draftState = {
      idValue: await page.locator('#group-id').inputValue(),
      nameValue: await page.locator('#group-name').inputValue(),
      modeValue: await page.locator('#group-mode').inputValue(),
      moderatorValue: await page.locator('#group-moderator').inputValue(),
      selectedCount: await page.locator('#expert-member-picker [data-member-row].is-selected').count(),
      toastText: await toastMessage.first().innerText(),
    }
    if (
      draftState.idValue !== 'smoke-group-save-failure'
      || draftState.nameValue !== 'Smoke Group Save Failure'
      || draftState.modeValue !== 'sequential'
      || draftState.moderatorValue !== 'smoke-planner'
      || draftState.selectedCount !== 1
    ) {
      throw new Error(`Failed expert team save changed the dirty draft unexpectedly: ${JSON.stringify(draftState)}`)
    }

    return draftState
  } finally {
    await page.unroute(routePattern, failSaveExpertGroup).catch(() => {})
  }
}

async function checkDelayedSkillsRefreshPreservesDirtyEditor(page) {
  let releaseSkills
  let intercepted = false
  const releaseSkillsPromise = new Promise(resolve => { releaseSkills = resolve })
  await page.route('**/__api/skills_list', async route => {
    if (intercepted) return route.continue()
    intercepted = true
    await releaseSkillsPromise
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        skills: [
          {
            name: 'slow-review-skill',
            description: 'Synthetic skill returned after the expert form is already dirty.',
            path: '/smoke/slow-review-skill/SKILL.md',
          },
        ],
      }),
    })
  })

  const skillsResponse = page.waitForResponse(response => response.url().includes('/__api/skills_list') && response.ok())
  await page.goto(`${baseUrl}/?slowSkills=${Date.now()}#/expert-teams`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-tabs [role="tab"]', { timeout: 30000 })
  await page.locator('[data-expert-tab="experts"]').click()
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
  await page.waitForFunction(() => {
    const hasAddButton = !!document.querySelector('.expert-teams-actions [data-action="add"]')
    const hasSkeleton = !!document.querySelector('.expert-list-skeleton, .loading-placeholder')
    const hasEditorForm = !!document.querySelector('#expert-editor-form')
    return hasAddButton && hasEditorForm && !hasSkeleton
  }, { timeout: 30000 })
  await page.locator('[data-select-id="smoke-reviewer"]').click()
  await page.locator('#expert-name').waitFor({ timeout: 10000 })

  const dirtyValues = {
    name: 'Unsaved Slow Skill Name',
    title: 'Unsaved Focus Title',
    prompt: 'Keep this unsaved prompt while the slow Skills request resolves.',
  }
  await page.locator('#expert-name').fill(dirtyValues.name)
  await page.locator('#expert-title').fill(dirtyValues.title)
  await page.locator('#expert-system-prompt').fill(dirtyValues.prompt)
  await page.locator('#expert-system-prompt').focus()

  releaseSkills()
  await skillsResponse
  await page.waitForTimeout(100)

  const valuesAfterSkillsRefresh = {
    name: await page.locator('#expert-name').inputValue(),
    title: await page.locator('#expert-title').inputValue(),
    prompt: await page.locator('#expert-system-prompt').inputValue(),
    focusedId: await page.evaluate(() => document.activeElement?.id || ''),
  }
  if (valuesAfterSkillsRefresh.name !== dirtyValues.name) {
    throw new Error(`Slow Skills refresh reset expert name: ${valuesAfterSkillsRefresh.name}`)
  }
  if (valuesAfterSkillsRefresh.title !== dirtyValues.title) {
    throw new Error(`Slow Skills refresh reset expert title: ${valuesAfterSkillsRefresh.title}`)
  }
  if (valuesAfterSkillsRefresh.prompt !== dirtyValues.prompt) {
    throw new Error('Slow Skills refresh reset expert prompt')
  }
  if (valuesAfterSkillsRefresh.focusedId !== 'expert-system-prompt') {
    throw new Error(`Slow Skills refresh moved focus to ${valuesAfterSkillsRefresh.focusedId || '<none>'}`)
  }
  await page.unroute('**/__api/skills_list')
  return valuesAfterSkillsRefresh
}

async function checkExpertDeleteFailurePreservesState(page, consoleErrors) {
  let intercepted = false
  const routePattern = '**/__api/delete_expert'
  const failDeleteExpert = async route => {
    if (intercepted) return route.continue()
    intercepted = true
    await route.fulfill({
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'Smoke forced delete_expert failure' }),
    })
  }

  await page.route(routePattern, failDeleteExpert)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
    await waitForExpertTeamsIdle(page)
    await page.locator('[data-expert-tab="experts"]').click()
    await page.locator('[data-select-id="smoke-reviewer"]').click()
    await page.locator('#expert-id').waitFor({ timeout: 10000 })

    await clickAction(page, 'delete')
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/__api/delete_expert') && response.status() === 500),
      page.locator('.modal-overlay [data-action="confirm"]').click(),
    ])
    if (!intercepted) throw new Error('Failed expert delete smoke did not intercept delete_expert')
    await page.waitForTimeout(50)
    consumeExpectedConsoleError(consoleErrors, /Failed to load resource: the server responded with a status of 500/)

    const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
      hasText: /Smoke forced delete_expert failure|删除失败|Delete failed/,
    })
    await toastMessage.first().waitFor({ timeout: 5000 })

    const persisted = await page.evaluate(async () => {
      const [expertsResponse, groupsResponse] = await Promise.all([
        fetch('/__api/list_experts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then(response => response.json()),
        fetch('/__api/list_expert_groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then(response => response.json()),
      ])
      const expertIds = (Array.isArray(expertsResponse) ? expertsResponse : []).map(expert => expert.id)
      const group = (Array.isArray(groupsResponse) ? groupsResponse : []).find(item => item.id === 'smoke-review-panel')
      return {
        expertIds,
        moderatorExpertId: group?.moderatorExpertId || '',
        memberIds: (Array.isArray(group?.members) ? group.members : []).map(member => member.expertId),
      }
    })
    if (!persisted.expertIds.includes('smoke-reviewer')) {
      throw new Error('Failed expert delete removed smoke expert despite a server error')
    }
    if (persisted.moderatorExpertId !== 'smoke-reviewer') {
      throw new Error(`Failed expert delete changed team moderator unexpectedly: ${persisted.moderatorExpertId || '<empty>'}`)
    }
    if (!persisted.memberIds.includes('smoke-reviewer')) {
      throw new Error(`Failed expert delete pruned smoke team members unexpectedly: ${persisted.memberIds.join(',')}`)
    }

    const editorState = {
      idValue: await page.locator('#expert-id').inputValue(),
      nameValue: await page.locator('#expert-name').inputValue(),
      toastText: await toastMessage.first().innerText(),
      ...persisted,
    }
    if (editorState.idValue !== 'smoke-reviewer' || editorState.nameValue !== 'Smoke Reviewer') {
      throw new Error(`Failed expert delete changed the selected expert unexpectedly: ${JSON.stringify(editorState)}`)
    }

    return editorState
  } finally {
    await page.unroute(routePattern, failDeleteExpert).catch(() => {})
  }
}

async function checkTeamDeleteFailurePreservesState(page, consoleErrors) {
  let intercepted = false
  const routePattern = '**/__api/delete_expert_group'
  const failDeleteExpertGroup = async route => {
    if (intercepted) return route.continue()
    intercepted = true
    await route.fulfill({
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'Smoke forced delete_expert_group failure' }),
    })
  }

  await page.route(routePattern, failDeleteExpertGroup)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })
    await waitForExpertTeamsIdle(page)
    await page.locator('[data-expert-tab="groups"]').click()
    await page.locator('[data-select-id="smoke-review-panel"]').click()
    await page.locator('#group-id').waitFor({ timeout: 10000 })

    await clickAction(page, 'delete')
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/__api/delete_expert_group') && response.status() === 500),
      page.locator('.modal-overlay [data-action="confirm"]').click(),
    ])
    if (!intercepted) throw new Error('Failed expert team delete smoke did not intercept delete_expert_group')
    await page.waitForTimeout(50)
    consumeExpectedConsoleError(consoleErrors, /Failed to load resource: the server responded with a status of 500/)

    const toastMessage = page.locator('.toast.error, .toast[role="alert"], [role="alert"]').filter({
      hasText: /Smoke forced delete_expert_group failure|删除失败|Delete failed/,
    })
    await toastMessage.first().waitFor({ timeout: 5000 })

    const persisted = await page.evaluate(async () => {
      const response = await fetch('/__api/list_expert_groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error(`list_expert_groups failed: ${response.status}`)
      const groups = await response.json()
      const group = (Array.isArray(groups) ? groups : []).find(item => item.id === 'smoke-review-panel')
      return group
        ? {
            id: group.id,
            name: group.name,
            mode: group.mode,
            moderatorExpertId: group.moderatorExpertId || '',
            memberIds: (Array.isArray(group.members) ? group.members : []).map(member => member.expertId),
          }
        : null
    })
    if (!persisted) throw new Error('Failed expert team delete removed smoke team despite a server error')
    if (persisted.moderatorExpertId !== 'smoke-reviewer') {
      throw new Error(`Failed expert team delete changed moderator unexpectedly: ${persisted.moderatorExpertId || '<empty>'}`)
    }
    if (persisted.memberIds.join(',') !== 'smoke-planner,smoke-reviewer') {
      throw new Error(`Failed expert team delete changed members unexpectedly: ${persisted.memberIds.join(',')}`)
    }

    const editorState = {
      idValue: await page.locator('#group-id').inputValue(),
      nameValue: await page.locator('#group-name').inputValue(),
      modeValue: await page.locator('#group-mode').inputValue(),
      moderatorValue: await page.locator('#group-moderator').inputValue(),
      selectedCount: await page.locator('#expert-member-picker [data-member-row].is-selected').count(),
      toastText: await toastMessage.first().innerText(),
      ...persisted,
    }
    if (
      editorState.idValue !== 'smoke-review-panel'
      || editorState.nameValue !== 'Smoke Review Panel'
      || editorState.modeValue !== 'review'
      || editorState.moderatorValue !== 'smoke-reviewer'
      || editorState.selectedCount !== 2
    ) {
      throw new Error(`Failed expert team delete changed the selected team unexpectedly: ${JSON.stringify(editorState)}`)
    }

    return editorState
  } finally {
    await page.unroute(routePattern, failDeleteExpertGroup).catch(() => {})
  }
}

async function checkDeletedExpertPrunesPersistedTeam(page) {
  await page.evaluate(async () => {
    const response = await fetch('/__api/delete_expert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'smoke-reviewer' }),
    })
    if (!response.ok) throw new Error(`delete_expert failed: ${response.status}`)
  })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForExpertTeamsIdle(page)
  await page.locator('[data-expert-tab="groups"]').click()
  await page.locator('[data-select-id="smoke-review-panel"]').click()
  await page.locator('#group-id').waitFor({ timeout: 10000 })

  const pruned = await page.evaluate(async () => {
    const [expertsResponse, groupsResponse] = await Promise.all([
      fetch('/__api/list_experts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(response => response.json()),
      fetch('/__api/list_expert_groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(response => response.json()),
    ])
    const expertIds = (Array.isArray(expertsResponse) ? expertsResponse : []).map(expert => expert.id)
    const group = (Array.isArray(groupsResponse) ? groupsResponse : []).find(item => item.id === 'smoke-review-panel')
    return {
      expertIds,
      moderatorExpertId: group?.moderatorExpertId || '',
      memberIds: (Array.isArray(group?.members) ? group.members : []).map(member => member.expertId),
    }
  })
  if (pruned.expertIds.includes('smoke-reviewer')) {
    throw new Error('Deleted smoke expert still exists in the expert API list')
  }
  if (pruned.moderatorExpertId) {
    throw new Error(`Deleted moderator was not cleared from smoke team: ${pruned.moderatorExpertId}`)
  }
  if (pruned.memberIds.join(',') !== 'smoke-planner') {
    throw new Error(`Deleted expert was not pruned from smoke team members: ${pruned.memberIds.join(',')}`)
  }

  const selectedCount = await page.locator('#expert-member-picker [data-member-row].is-selected').count()
  const moderatorValue = await page.locator('#group-moderator').inputValue()
  if (selectedCount !== 1) throw new Error(`Pruned smoke team selected ${selectedCount} members instead of 1`)
  if (moderatorValue) throw new Error(`Pruned smoke team still selected moderator ${moderatorValue}`)
  return { ...pruned, selectedCount, moderatorValue }
}

async function checkExpertTeamsPage(page, viewport, label) {
  await page.setViewportSize(viewport)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#expert-teams-tabs [role="tab"]', { timeout: 30000 })
  await page.waitForSelector('#expert-teams-editor', { timeout: 30000 })

  const tabs = page.locator('#expert-teams-tabs [role="tab"]')
  if (await tabs.count() !== 2) throw new Error(`${label} expected 2 expert team tabs`)

  await tabs.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.activeElement?.dataset?.expertTab === 'groups')
  const groupsSelected = await tabs.nth(1).getAttribute('aria-selected')
  const groupsTabIndex = await tabs.nth(1).evaluate(el => el.tabIndex)
  const searchPlaceholder = await page.locator('#expert-teams-search').getAttribute('placeholder')
  if (groupsSelected !== 'true' || groupsTabIndex !== 0) {
    throw new Error(`${label} ArrowRight did not activate the groups tab`)
  }
  if (!searchPlaceholder || /expert/i.test(searchPlaceholder)) {
    throw new Error(`${label} search placeholder did not update for groups tab: ${searchPlaceholder || '<empty>'}`)
  }

  await page.keyboard.press('Home')
  await page.waitForFunction(() => document.activeElement?.dataset?.expertTab === 'experts')
  const expertsSelected = await tabs.nth(0).getAttribute('aria-selected')
  if (expertsSelected !== 'true') throw new Error(`${label} Home did not return to the experts tab`)

  const overflow = await assertNoHorizontalOverflow(page, label)
  const screenshot = await page.screenshot({
    path: path.join(artifactsDir, `expert-teams-${label}.png`),
    fullPage: true,
  })
  return { label, overflow, screenshotBytes: screenshot.length }
}

async function main() {
  await fs.rm(stateDir, { recursive: true, force: true })
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(path.join(stateDir, 'clawpanel.json'), JSON.stringify({
    ignoreRisk: true,
    engineMode: 'openclaw',
    enabledEngines: ['openclaw'],
    engineSetupChoice: 'openclaw',
  }, null, 2))
  await fs.writeFile(path.join(stateDir, 'openclaw.json'), JSON.stringify({
    version: 1,
    model: {
      default: 'smoke/local',
      provider: 'smoke',
    },
  }, null, 2))
  await fs.mkdir(artifactsDir, { recursive: true })
  await waitForDistReady()
  const server = startServer()
  let browser
  try {
    await waitForServer(`${baseUrl}/`)
    browser = await launchBrowser()
    const page = await browser.newPage()
    const consoleErrors = []
    page.on('console', message => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (!isIgnoredConsoleError(text)) consoleErrors.push(text)
    })
    page.on('pageerror', error => {
      if (!isIgnoredConsoleError(error.message)) consoleErrors.push(error.message)
    })

    const desktop = await checkExpertTeamsPage(page, { width: 1366, height: 900 }, 'desktop')
    const templateCancel = await checkGroupTemplatePickerCancelKeepsDraft(page)
    const templateDraft = await checkGroupTemplatePickerAppliesDraft(page)
    const persistence = await createPersistedTeam(page)
    const templatePersistence = await checkTemplateTeamSavePersists(page)
    const moderatorMemberSync = await checkModeratorClearsWhenMemberRemoved(page)
    const memberOrderDrag = await checkMemberDragOrderPersists(page)
    const emptyTeamValidation = await checkEmptyTeamSaveIsBlocked(page)
    const invalidTeamIdValidation = await checkInvalidTeamIdSaveIsBlocked(page)
    const invalidExpertModelValidation = await checkInvalidExpertModelSaveIsBlocked(page)
    const invalidExpertIdValidation = await checkInvalidExpertIdSaveIsBlocked(page)
    const expertSaveFailureDraft = await checkExpertSaveFailurePreservesDraft(page, consoleErrors)
    const teamSaveFailureDraft = await checkTeamSaveFailurePreservesDraft(page, consoleErrors)
    const delayedSkillsRefresh = await checkDelayedSkillsRefreshPreservesDirtyEditor(page)
    const expertDeleteFailureState = await checkExpertDeleteFailurePreservesState(page, consoleErrors)
    const teamDeleteFailureState = await checkTeamDeleteFailurePreservesState(page, consoleErrors)
    const deletionPrune = await checkDeletedExpertPrunesPersistedTeam(page)
    const mobile = await checkExpertTeamsPage(page, { width: 390, height: 844 }, 'mobile')
    if (consoleErrors.length) {
      throw new Error(`Console errors found:\n${consoleErrors.join('\n')}`)
    }

    const result = {
      ok: true,
      url,
      desktop,
      templateCancel,
      templateDraft,
      persistence,
      templatePersistence,
      moderatorMemberSync,
      memberOrderDrag,
      emptyTeamValidation,
      invalidTeamIdValidation,
      invalidExpertModelValidation,
      invalidExpertIdValidation,
      expertSaveFailureDraft,
      teamSaveFailureDraft,
      delayedSkillsRefresh,
      expertDeleteFailureState,
      teamDeleteFailureState,
      deletionPrune,
      mobile,
      checkedAt: new Date().toISOString(),
    }
    await fs.writeFile(path.join(artifactsDir, 'expert-teams-smoke.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(server.getOutput())
    throw error
  } finally {
    if (browser) await browser.close()
    await stopServer(server.child)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
