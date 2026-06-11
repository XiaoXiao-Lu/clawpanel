#!/usr/bin/env node
/**
 * ClawPanel 独立 Web 服务器（Headless 模式）
 * 无需 Tauri / Rust / GUI，纯 Node.js 运行
 * 适用于 Linux 服务器、Docker 等无桌面环境
 *
 * 用法：
 *   npm run serve              # 默认 0.0.0.0:1420
 *   npm run serve -- --port 8080
 *   npm run serve -- --host 127.0.0.1 --port 3000
 *   PORT=8080 npm run serve
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import net from 'net'
import { _initApi, _apiMiddleware } from './dev-api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '..', 'dist')
const SERVE_ENTRY = fileURLToPath(import.meta.url)

// === 解析命令行参数 ===
function parseArgs() {
  const args = process.argv.slice(2)
  let host = process.env.HOST || '0.0.0.0'
  let port = parseInt(process.env.PORT, 10) || 1420
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) host = args[++i]
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10)
    if (args[i] === '-p' && args[i + 1]) port = parseInt(args[++i], 10)
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
ClawPanel Web Server (Headless)

用法: node scripts/serve.js [选项]

选项:
  --host <addr>   监听地址 (默认: 0.0.0.0)
  --port, -p <n>  监听端口 (默认: 1420)
  --help, -h      显示帮助

环境变量:
  HOST            监听地址
  PORT            监听端口

示例:
  npm run serve                    # 0.0.0.0:1420
  npm run serve -- --port 8080     # 0.0.0.0:8080
  npm run serve -- --host 127.0.0.1 -p 3000
`)
      process.exit(0)
    }
  }
  return { host, port }
}

// === MIME 类型映射 ===
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

// === 静态文件服务 ===
function isPathInsideDirectory(parentDir, candidatePath) {
  const relativePath = path.relative(parentDir, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function resolveStaticFilePath(rawUrl = '/', distDir = DIST_DIR) {
  const rawPath = String(rawUrl || '/').split('?')[0] || '/'
  let urlPath
  try {
    urlPath = decodeURIComponent(rawPath).replace(/\\/g, '/')
  } catch {
    return { ok: false, statusCode: 400, message: 'Bad Request' }
  }

  if (urlPath.includes('\0')) {
    return { ok: false, statusCode: 400, message: 'Bad Request' }
  }

  const relativePath = urlPath === '/'
    ? 'index.html'
    : urlPath.replace(/^\/+/, '')
  const filePath = path.resolve(distDir, relativePath)

  if (!isPathInsideDirectory(distDir, filePath)) {
    return { ok: false, statusCode: 403, message: 'Forbidden' }
  }

  return { ok: true, filePath, urlPath }
}

function serveStatic(req, res, { distDir = DIST_DIR } = {}) {
  if (req.method && !['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end('Method Not Allowed')
    return
  }

  const resolved = resolveStaticFilePath(req.url, distDir)
  if (!resolved.ok) {
    res.statusCode = resolved.statusCode
    res.end(req.method === 'HEAD' ? '' : resolved.message)
    return
  }
  const { filePath, urlPath } = resolved

  // 尝试读取文件
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      sendFile(res, filePath, { headOnly: req.method === 'HEAD' })
      return
    }

    // SPA fallback：非 API、非静态资源 → index.html
    const ext = path.extname(urlPath)
    if (!ext || ext === '.html') {
      sendFile(res, path.join(distDir, 'index.html'), { headOnly: req.method === 'HEAD' })
    } else {
      res.statusCode = 404
      res.end(req.method === 'HEAD' ? '' : 'Not Found')
    }
  })
}

function sendFile(res, filePath, { headOnly = false } = {}) {
  const ext = path.extname(filePath)
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  // 缓存策略：资源文件长缓存，HTML 不缓存
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }

  res.setHeader('Content-Type', contentType)
  if (headOnly) {
    res.end()
    return
  }
  fs.createReadStream(filePath).pipe(res)
}

// === 启动服务器 ===
async function main() {
  // 检查 dist 目录
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error('❌ 未找到 dist/index.html，请先运行: npm run build')
    process.exit(1)
  }

  const { host, port } = parseArgs()

  // 初始化 API
  _initApi()

  const server = http.createServer(async (req, res) => {
    // CORS 头（方便开发调试）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

    // API 请求
    await _apiMiddleware(req, res, () => {
      // 非 API → 静态文件
      serveStatic(req, res)
    })
  })

  // WebSocket 代理
  let gatewayPort = 18789
  try {
    const cfgPath = path.join(homedir(), '.openclaw', 'openclaw.json')
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    gatewayPort = cfg?.gateway?.port || 18789
  } catch {}

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy()
      return
    }

    const target = net.createConnection(gatewayPort, '127.0.0.1', () => {
      const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
      const headers = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')
      target.write(reqLine + headers + '\r\n\r\n')
      if (head.length) target.write(head)
      socket.pipe(target)
      target.pipe(socket)
    })

    target.on('error', () => socket.destroy())
    socket.on('error', () => target.destroy())
  })

  server.listen(port, host, () => {
    console.log('')
    console.log('  ┌─────────────────────────────────────────┐')
    console.log('  │                                         │')
    console.log('  │   🦀 ClawPanel Web Server (Headless)    │')
    console.log('  │                                         │')
    console.log(`  │   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`.padEnd(44) + '│')
    if (host === '0.0.0.0') {
      console.log(`  │   http://0.0.0.0:${port}/`.padEnd(44) + '│')
    }
    console.log('  │                                         │')
    console.log('  └─────────────────────────────────────────┘')
    console.log('')
    console.log('  按 Ctrl+C 停止服务')
    console.log('')
  })

  // 优雅退出
  process.on('SIGINT', () => { console.log('\n  👋 服务已停止'); process.exit(0) })
  process.on('SIGTERM', () => { console.log('\n  👋 服务已停止'); process.exit(0) })
}

if (path.resolve(process.argv[1] || '') === SERVE_ENTRY) {
  main().catch(e => { console.error('启动失败:', e); process.exit(1) })
}

export { DIST_DIR, isPathInsideDirectory, resolveStaticFilePath, serveStatic }
