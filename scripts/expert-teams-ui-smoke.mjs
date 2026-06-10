#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const artifactsDir = path.join(root, 'artifacts', 'expert-teams')
const stateDir = path.join(artifactsDir, 'state')
const port = Number(process.env.EXPERT_TEAMS_SMOKE_PORT || 15180)
const baseUrl = `http://127.0.0.1:${port}`
const url = `${baseUrl}/#/expert-teams`

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
  for (const expert of experts) await createExpert(page, expert)

  await page.locator('[data-expert-tab="groups"]').click()
  await waitForExpertTeamsIdle(page)
  await clickAction(page, 'add')
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
    const persistence = await createPersistedTeam(page)
    const delayedSkillsRefresh = await checkDelayedSkillsRefreshPreservesDirtyEditor(page)
    const mobile = await checkExpertTeamsPage(page, { width: 390, height: 844 }, 'mobile')
    if (consoleErrors.length) {
      throw new Error(`Console errors found:\n${consoleErrors.join('\n')}`)
    }

    const result = {
      ok: true,
      url,
      desktop,
      persistence,
      delayedSkillsRefresh,
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
