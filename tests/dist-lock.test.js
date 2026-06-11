import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { acquireDistLock, withDistLock } from '../scripts/lib/dist-lock.js'

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'clawpanel-dist-lock-'))
}

test('dist lock blocks concurrent holders and releases explicitly', async () => {
  const root = await tempRoot()
  try {
    const release = await acquireDistLock(root, 'first', { timeoutMs: 500 })
    await assert.rejects(
      () => acquireDistLock(root, 'second', { timeoutMs: 20, staleMs: 60000 }),
      /Timed out waiting for dist lock held by first/,
    )
    await release()

    const releaseAfter = await acquireDistLock(root, 'second', { timeoutMs: 500 })
    await releaseAfter()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('withDistLock releases the lock when the callback throws', async () => {
  const root = await tempRoot()
  try {
    await assert.rejects(
      () => withDistLock(root, 'throwing-task', async () => {
        throw new Error('forced failure')
      }),
      /forced failure/,
    )

    const release = await acquireDistLock(root, 'after-failure', { timeoutMs: 500 })
    await release()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
