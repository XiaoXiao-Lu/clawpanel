#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const artifactsDir = path.join(root, 'artifacts', 'expert-teams')
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
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
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
  await fs.mkdir(artifactsDir, { recursive: true })
  const server = startServer()
  let browser
  try {
    await waitForServer(`${baseUrl}/`)
    browser = await launchBrowser()
    const page = await browser.newPage()
    const consoleErrors = []
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', error => consoleErrors.push(error.message))

    const desktop = await checkExpertTeamsPage(page, { width: 1366, height: 900 }, 'desktop')
    const mobile = await checkExpertTeamsPage(page, { width: 390, height: 844 }, 'mobile')
    if (consoleErrors.length) {
      throw new Error(`Console errors found:\n${consoleErrors.join('\n')}`)
    }

    const result = {
      ok: true,
      url,
      desktop,
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
