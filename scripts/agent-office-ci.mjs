#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const inflate = promisify(zlib.inflate)
const root = path.resolve(import.meta.dirname, '..')
const artifactsDir = path.join(root, 'artifacts', 'agent-office')
const port = Number(process.env.AGENT_OFFICE_CI_PORT || 15179)
const url = `http://127.0.0.1:${port}/#/agents`
const maxDrawCalls = Number(process.env.AGENT_OFFICE_MAX_DRAW_CALLS || 4200)
const maxTriangles = Number(process.env.AGENT_OFFICE_MAX_TRIANGLES || 280000)
const minFps = Number(process.env.AGENT_OFFICE_MIN_FPS || 0)

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

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset)
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

async function decodePngRgba(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('Screenshot is not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = readUInt32(data, 0)
      height = readUInt32(data, 4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`)
  }
  const raw = await inflate(Buffer.concat(idat))
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const stride = width * bytesPerPixel
  const pixels = Buffer.alloc(width * height * 4)
  const decodedRows = []
  let input = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[input++]
    const decoded = Buffer.alloc(stride)
    const prevDecoded = y > 0 ? decodedRows[y - 1] : null
    for (let x = 0; x < stride; x += 1) {
      const value = raw[input++]
      const left = x >= bytesPerPixel ? decoded[x - bytesPerPixel] : 0
      const up = prevDecoded ? prevDecoded[x] : 0
      const upLeft = prevDecoded && x >= bytesPerPixel ? prevDecoded[x - bytesPerPixel] : 0
      if (filter === 0) decoded[x] = value
      else if (filter === 1) decoded[x] = (value + left) & 255
      else if (filter === 2) decoded[x] = (value + up) & 255
      else if (filter === 3) decoded[x] = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) decoded[x] = (value + paeth(left, up, upLeft)) & 255
      else throw new Error(`Unsupported PNG filter: ${filter}`)
    }
    decodedRows[y] = decoded
    for (let x = 0; x < width; x += 1) {
      const source = x * bytesPerPixel
      const target = (y * width + x) * 4
      pixels[target] = decoded[source]
      pixels[target + 1] = decoded[source + 1]
      pixels[target + 2] = decoded[source + 2]
      pixels[target + 3] = colorType === 6 ? decoded[source + 3] : 255
    }
  }
  return { width, height, pixels }
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    console.warn(`[agent-office-ci] bundled Chromium unavailable, trying system Chrome: ${error.message}`)
    return chromium.launch({ channel: 'chrome', headless: true })
  }
}

async function assertNonBlankPng(buffer) {
  const { width, height, pixels } = await decodePngRgba(buffer)
  const step = Math.max(4, Math.floor((width * height * 4) / 6000) * 4)
  let samples = 0
  let mean = 0
  let variance = 0
  let min = 255
  let max = 0
  for (let i = 0; i < pixels.length; i += step) {
    const value = Math.round((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3)
    samples += 1
    const delta = value - mean
    mean += delta / samples
    variance += delta * (value - mean)
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  const stddev = Math.sqrt(variance / Math.max(1, samples - 1))
  if (stddev < 4 || max - min < 18) {
    throw new Error(`Scene screenshot looks blank: stddev=${stddev.toFixed(2)}, range=${max - min}`)
  }
  return { width, height, stddev: Number(stddev.toFixed(2)), range: max - min }
}

async function main() {
  await fs.mkdir(artifactsDir, { recursive: true })
  const server = startServer()
  let browser
  try {
    await waitForServer(`http://127.0.0.1:${port}/`)
    browser = await launchBrowser()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    const consoleErrors = []
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', error => consoleErrors.push(error.message))

    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('agentOfficeAssets')
      localStorage.setItem('agentOfficeStress', '1')
      localStorage.setItem('agentOfficeDemo', '1')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#agent-office-scene canvas', { timeout: 30000 })
    await page.waitForSelector('#agent-office-diagnostics[data-quality]', { timeout: 30000 })
    await page.locator('#agent-office-stress-size').selectOption('100')
    await page.locator('#agent-office-stress').click()
    await page.waitForFunction(() => {
      const diagnostics = document.querySelector('#agent-office-diagnostics')
      return diagnostics?.dataset.agents === '100' && diagnostics.dataset.quality === 'low'
    }, null, { timeout: 30000 })
    await page.waitForSelector('#agent-office-audit .agent-office-audit-item', { timeout: 30000 })
    await page.waitForTimeout(1200)

    const metrics = await page.locator('#agent-office-diagnostics').evaluate(el => ({ ...el.dataset }))
    const summaryText = await page.locator('#agent-office-summary').innerText()
    const auditText = await page.locator('#agent-office-audit').innerText()
    const fallbackVisible = await page.locator('.agent-office-fallback').count()
    if (fallbackVisible) throw new Error('3D scene fell back to 2D view')
    if (!summaryText.includes('100')) throw new Error('Stress summary did not show 100 agents')
    if (!auditText.includes('事件审计')) throw new Error('Audit rail did not render')
    if (metrics.assetStatus !== 'gltf') throw new Error(`GLTF asset did not load: assetStatus=${metrics.assetStatus}`)
    if (Number(metrics.animationClipCount || 0) < 8) {
      throw new Error(`Expected at least 8 GLTF animation clips, got ${metrics.animationClipCount}`)
    }
    if (Number(metrics.drawCalls || 0) > maxDrawCalls) {
      throw new Error(`Draw calls exceeded threshold: ${metrics.drawCalls} > ${maxDrawCalls}`)
    }
    if (Number(metrics.triangles || 0) > maxTriangles) {
      throw new Error(`Triangles exceeded threshold: ${metrics.triangles} > ${maxTriangles}`)
    }
    if (minFps > 0 && Number(metrics.fps || 0) < minFps) {
      throw new Error(`FPS below threshold: ${metrics.fps} < ${minFps}`)
    }

    const scene = page.locator('#agent-office-scene')
    const sceneShot = await scene.screenshot({ path: path.join(artifactsDir, 'agents-100-scene.png') })
    const fullShot = await page.screenshot({ path: path.join(artifactsDir, 'agents-100.png'), fullPage: true })
    const pixelStats = await assertNonBlankPng(sceneShot)
    await fs.writeFile(path.join(artifactsDir, 'metrics.json'), JSON.stringify({
      url,
      metrics,
      pixelStats,
      consoleErrors,
      screenshotBytes: fullShot.length,
      checkedAt: new Date().toISOString(),
    }, null, 2))
    if (consoleErrors.length) {
      throw new Error(`Console errors found:\n${consoleErrors.join('\n')}`)
    }
    console.log(JSON.stringify({ ok: true, metrics, pixelStats }, null, 2))
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
