import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const defaultTimeoutMs = 120000
const defaultStaleMs = 30 * 60 * 1000

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readLockInfo(lockDir) {
  try {
    const raw = await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function lockAgeMs(lockDir) {
  try {
    const stat = await fs.stat(lockDir)
    return Date.now() - stat.mtimeMs
  } catch {
    return 0
  }
}

export async function acquireDistLock(root, owner, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.CLAWPANEL_DIST_LOCK_TIMEOUT_MS || defaultTimeoutMs)
  const staleMs = Number(options.staleMs || process.env.CLAWPANEL_DIST_LOCK_STALE_MS || defaultStaleMs)
  const lockDir = path.join(root, '.tmp', 'dist.lock')
  const token = crypto.randomUUID()
  const started = Date.now()
  let lastHolder = null

  await fs.mkdir(path.dirname(lockDir), { recursive: true })
  while (Date.now() - started < timeoutMs) {
    try {
      await fs.mkdir(lockDir)
      try {
        await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({
          token,
          owner,
          pid: process.pid,
          host: os.hostname(),
          acquiredAt: new Date().toISOString(),
        }, null, 2))
      } catch (error) {
        await fs.rm(lockDir, { recursive: true, force: true })
        throw error
      }
      return async function releaseDistLock() {
        const info = await readLockInfo(lockDir)
        if (info?.token === token) {
          await fs.rm(lockDir, { recursive: true, force: true })
        }
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      lastHolder = await readLockInfo(lockDir)
      if (await lockAgeMs(lockDir) > staleMs) {
        await fs.rm(lockDir, { recursive: true, force: true })
      } else {
        await wait(250)
      }
    }
  }

  const holder = lastHolder?.owner ? `${lastHolder.owner} pid=${lastHolder.pid || 'unknown'}` : 'unknown holder'
  throw new Error(`Timed out waiting for dist lock held by ${holder}. Another build or smoke may still be using dist.`)
}

export async function withDistLock(root, owner, callback, options = {}) {
  const release = await acquireDistLock(root, owner, options)
  try {
    return await callback()
  } finally {
    await release()
  }
}
