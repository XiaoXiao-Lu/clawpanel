import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  DIST_DIR,
  isPathInsideDirectory,
  parseRangeHeader,
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

test('headless static server parses single byte ranges safely', () => {
  assert.deepEqual(parseRangeHeader('', 10), { ok: true, range: null })
  assert.deepEqual(parseRangeHeader('bytes=2-5', 10), { ok: true, range: { start: 2, end: 5 } })
  assert.deepEqual(parseRangeHeader('bytes=7-', 10), { ok: true, range: { start: 7, end: 9 } })
  assert.deepEqual(parseRangeHeader('bytes=-4', 10), { ok: true, range: { start: 6, end: 9 } })
  assert.deepEqual(parseRangeHeader('bytes=8-99', 10), { ok: true, range: { start: 8, end: 9 } })
  assert.deepEqual(parseRangeHeader('bytes=10-12', 10), { ok: false })
  assert.deepEqual(parseRangeHeader('bytes=5-2', 10), { ok: false })
  assert.deepEqual(parseRangeHeader('bytes=0-1,4-5', 10), { ok: false })
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

async function readResponse(urlPath, baseUrl, { method = 'GET', headers = {} } = {}) {
  const target = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: urlPath,
      method,
      headers,
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          allow: res.headers.allow || null,
          acceptRanges: res.headers['accept-ranges'] || null,
          cacheControl: res.headers['cache-control'] || null,
          contentLength: res.headers['content-length'] || null,
          contentRange: res.headers['content-range'] || null,
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
  assert.equal(res.acceptRanges, 'bytes')
  assert.equal(res.contentType, 'application/javascript; charset=utf-8')
  assert.equal(res.cacheControl, 'public, max-age=31536000, immutable')
  assert.equal(res.contentLength, '17')
  assert.equal(res.contentRange, null)
  assert.equal(res.text, 'console.log("ok")')
})

test('headless static server keeps html uncached and uses SPA fallback', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
  })

  const res = await readResponse('/workspace/deep/link', baseUrl)

  assert.equal(res.status, 200)
  assert.equal(res.allow, null)
  assert.equal(res.acceptRanges, null)
  assert.equal(res.contentType, 'text/html; charset=utf-8')
  assert.equal(res.cacheControl, 'no-cache, no-store, must-revalidate')
  assert.equal(res.contentLength, null)
  assert.equal(res.contentRange, null)
  assert.equal(res.text, '<main>shell</main>')
})

test('headless static server returns explicit HTTP errors for unsafe or missing assets', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
  })

  assert.deepEqual(
    await readResponse('/assets/missing.js', baseUrl),
    { status: 404, allow: null, acceptRanges: null, cacheControl: null, contentLength: '9', contentRange: null, contentType: null, text: 'Not Found' },
  )
  assert.deepEqual(
    await readResponse('/%2e%2e/package.json', baseUrl),
    { status: 403, allow: null, acceptRanges: null, cacheControl: null, contentLength: '9', contentRange: null, contentType: null, text: 'Forbidden' },
  )
  assert.deepEqual(
    await readResponse('/assets/%E0%A4%A', baseUrl),
    { status: 400, allow: null, acceptRanges: null, cacheControl: null, contentLength: '11', contentRange: null, contentType: null, text: 'Bad Request' },
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
      acceptRanges: 'bytes',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: '17',
      contentRange: null,
      contentType: 'application/javascript; charset=utf-8',
      text: '',
    },
  )
  assert.deepEqual(
    await readResponse('/assets/app.js', baseUrl, { method: 'POST' }),
    {
      status: 405,
      allow: 'GET, HEAD',
      acceptRanges: null,
      cacheControl: null,
      contentLength: '18',
      contentRange: null,
      contentType: null,
      text: 'Method Not Allowed',
    },
  )
})

test('headless static server supports single-range asset requests', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
    'assets/video.mp4': '0123456789',
  })

  assert.deepEqual(
    await readResponse('/assets/video.mp4', baseUrl, { headers: { Range: 'bytes=2-5' } }),
    {
      status: 206,
      allow: null,
      acceptRanges: 'bytes',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: '4',
      contentRange: 'bytes 2-5/10',
      contentType: 'video/mp4',
      text: '2345',
    },
  )
  assert.deepEqual(
    await readResponse('/assets/video.mp4', baseUrl, { headers: { Range: 'bytes=-3' } }),
    {
      status: 206,
      allow: null,
      acceptRanges: 'bytes',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: '3',
      contentRange: 'bytes 7-9/10',
      contentType: 'video/mp4',
      text: '789',
    },
  )
})

test('headless static server handles HEAD and invalid range requests', async (t) => {
  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
    'assets/video.mp4': '0123456789',
  })

  assert.deepEqual(
    await readResponse('/assets/video.mp4', baseUrl, { method: 'HEAD', headers: { Range: 'bytes=1-3' } }),
    {
      status: 206,
      allow: null,
      acceptRanges: 'bytes',
      cacheControl: 'public, max-age=31536000, immutable',
      contentLength: '3',
      contentRange: 'bytes 1-3/10',
      contentType: 'video/mp4',
      text: '',
    },
  )
  assert.deepEqual(
    await readResponse('/assets/video.mp4', baseUrl, { headers: { Range: 'bytes=99-100' } }),
    {
      status: 416,
      allow: null,
      acceptRanges: 'bytes',
      cacheControl: null,
      contentLength: '21',
      contentRange: 'bytes */10',
      contentType: null,
      text: 'Range Not Satisfiable',
    },
  )
})

test('headless static server returns 500 when a static file stream fails', async (t) => {
  const originalCreateReadStream = fs.createReadStream
  fs.createReadStream = () => {
    const stream = new Readable({ read() {} })
    queueMicrotask(() => stream.destroy(new Error('disk read failed')))
    return stream
  }
  t.after(() => {
    fs.createReadStream = originalCreateReadStream
  })

  const baseUrl = await withStaticServer(t, {
    'index.html': '<main>shell</main>',
    'assets/app.js': 'console.log("ok")',
  })

  assert.deepEqual(
    await readResponse('/assets/app.js', baseUrl),
    {
      status: 500,
      allow: null,
      acceptRanges: null,
      cacheControl: null,
      contentLength: null,
      contentRange: null,
      contentType: 'text/plain; charset=utf-8',
      text: 'Internal Server Error',
    },
  )
})
