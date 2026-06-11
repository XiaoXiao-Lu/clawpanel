import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DIST_DIR,
  isPathInsideDirectory,
  resolveStaticFilePath,
  serveStatic,
} from '../scripts/serve.js'

test('headless static server resolves normal dist assets safely', () => {
  const resolved = resolveStaticFilePath('/assets/app.js?cache=1')

  assert.equal(resolved.ok, true)
  assert.equal(resolved.filePath, path.resolve(DIST_DIR, 'assets/app.js'))
  assert.equal(resolved.urlPath, '/assets/app.js')
})

test('headless static server rejects dist-prefix sibling traversal', () => {
  const sibling = path.resolve(DIST_DIR, '..', `${path.basename(DIST_DIR)}-evil`, 'secret.txt')

  assert.equal(isPathInsideDirectory(DIST_DIR, sibling), false)
  assert.deepEqual(
    resolveStaticFilePath(`/../${path.basename(DIST_DIR)}-evil/secret.txt`),
    { ok: false, statusCode: 403, message: 'Forbidden' },
  )
})

test('headless static server rejects encoded directory traversal', () => {
  assert.deepEqual(
    resolveStaticFilePath('/%2e%2e/package.json'),
    { ok: false, statusCode: 403, message: 'Forbidden' },
  )
})

test('headless static server rejects malformed encoded paths', () => {
  assert.deepEqual(
    resolveStaticFilePath('/assets/%E0%A4%A'),
    { ok: false, statusCode: 400, message: 'Bad Request' },
  )
})

async function withStaticServer(t, files = {}) {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpanel-serve-'))
  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(distDir, fileName)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }

  const server = http.createServer((req, res) => serveStatic(req, res, { distDir }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.close()
    fs.rmSync(distDir, { recursive: true, force: true })
  })

  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

async function readResponse(urlPath, baseUrl, { method = 'GET' } = {}) {
  const target = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: urlPath,
      method,
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          allow: res.headers.allow || null,
          cacheControl: res.headers['cache-control'] || null,
          contentType: res.headers['content-type'] || null,
          text: body,
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

test('headless static server serves assets with immutable cache headers', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
    'assets/app.js': 'console.log("ok")',
  })

  const res = await readResponse('/assets/app.js?v=1', baseUrl)

  assert.equal(res.status, 200)
  assert.equal(res.allow, null)
  assert.equal(res.contentType, 'application/javascript; charset=utf-8')
  assert.equal(res.cacheControl, 'public, max-age=31536000, immutable')
  assert.equal(res.text, 'console.log("ok")')
})

test('headless static server keeps html uncached and uses SPA fallback', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
  })

  const res = await readResponse('/workspace/deep/link', baseUrl)

  assert.equal(res.status, 200)
  assert.equal(res.allow, null)
  assert.equal(res.contentType, 'text/html; charset=utf-8')
  assert.equal(res.cacheControl, 'no-cache, no-store, must-revalidate')
  assert.equal(res.text, '<main>shell</main>')
})

test('headless static server returns explicit HTTP errors for unsafe or missing assets', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
  })

  assert.deepEqual(
    await readResponse('/assets/missing.js', baseUrl),
    { status: 404, allow: null, cacheControl: null, contentType: null, text: 'Not Found' },
  )
  assert.deepEqual(
    await readResponse('/%2e%2e/package.json', baseUrl),
    { status: 403, allow: null, cacheControl: null, contentType: null, text: 'Forbidden' },
  )
  assert.deepEqual(
    await readResponse('/assets/%E0%A4%A', baseUrl),
    { status: 400, allow: null, cacheControl: null, contentType: null, text: 'Bad Request' },
  )
})

test('headless static server supports HEAD without body and rejects unsafe methods', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
    'assets/app.js': 'console.log("ok")',
  })

  assert.deepEqual(
    await readResponse('/assets/app.js', baseUrl, { method: 'HEAD' }),
    {
      status: 200,
      allow: null,
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: 'application/javascript; charset=utf-8',
      text: '',
    },
  )
  assert.deepEqual(
    await readResponse('/assets/app.js', baseUrl, { method: 'POST' }),
    {
      status: 405,
      allow: 'GET, HEAD',
      cacheControl: null,
      contentType: null,
      text: 'Method Not Allowed',
    },
  )
})
