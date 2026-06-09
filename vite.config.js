import { defineConfig } from 'vite'
import { devApiPlugin, readJsonFileRelaxed } from './scripts/dev-api.js'
import fs from 'fs'
import path from 'path'
import { homedir } from 'os'

// 读取 package.json 版本号，构建时注入前端
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// 读取 Gateway 端口（启动时读取一次）
// 注意：Gateway 默认端口是 18789，不是 18790
let gatewayPort = 18789
try {
  const cfgPath = path.join(homedir(), '.openclaw', 'openclaw.json')
  if (fs.existsSync(cfgPath)) {
    const cfg = readJsonFileRelaxed(cfgPath)
    // 端口必须 > 0 且 < 65536
    const port = cfg?.gateway?.port
    if (port && typeof port === 'number' && port > 0 && port < 65536) {
      gatewayPort = port
    }
  }
} catch (e) {
  console.warn('[vite] 读取 Gateway 端口配置失败，使用默认端口 18789:', e.message)
}

console.log(`[vite] Gateway WebSocket 代理目标: ws://127.0.0.1:${gatewayPort}`)

function manualChunks(id) {
  const normalized = id.replace(/\\/g, '/')

  if (normalized.includes('/node_modules/three/')) {
    return normalized.includes('/examples/jsm/') || normalized.includes('/addons/')
      ? 'vendor-three-addons'
      : 'vendor-three'
  }
  if (normalized.includes('/node_modules/@tauri-apps/')) return 'vendor-tauri'

  if (normalized.includes('/src/locales/')) {
    if (normalized.includes('/src/locales/helper.js')) return 'locale-helper'
    if (normalized.includes('/src/locales/index.js')) return 'locale-index'
    if (normalized.includes('/src/locales/modules/engine.js')) return 'locale-engine'
    if (normalized.match(/\/src\/locales\/modules\/(channels|communication|connectors|security|gateway|notifications)\.js$/)) {
      return 'locale-ops'
    }
    if (normalized.match(/\/src\/locales\/modules\/(assistant|chat|chat-debug|expertTeams|agents|agentDetail|models)\.js$/)) {
      return 'locale-ai'
    }
    if (normalized.match(/\/src\/locales\/modules\/(memory|dreaming|cron|usage|skills|logs|hermesLazyDeps)\.js$/)) {
      return 'locale-data'
    }
    return 'locale-shell'
  }
}

export default defineConfig({
  plugins: [devApiPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/dist/**',
        '**/.tmp/**',
        '**/reports/**',
        '**/screenshots/**',
      ],
    },
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${gatewayPort}`,
        ws: true,
        changeOrigin: true,
        timeout: 30000,
        configure: (proxy, options) => {
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            socket.setTimeout(30000)
            socket.on('timeout', () => {
              console.warn('[vite/ws] WebSocket 超时，关闭连接')
              socket.destroy()
            })
          })
          proxy.on('error', (err, req, socket) => {
            console.warn(`[vite/ws] 代理错误: ${err.code} ${err.message}`)
            // WebSocket 升级后 socket 是 net.Socket，无 headersSent
            if (socket && !socket.destroyed) {
              socket.destroy()
            }
          })
        },
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
})
