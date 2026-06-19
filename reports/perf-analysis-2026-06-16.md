# ChatCraw (ClawPanel) 性能分析报告

**日期**: 2026-06-16
**分析范围**: 全项目（构建产物、源码结构、运行时日志、资源配置）
**总览**: 发现 3 个严重问题、6 个中等风险、7 个优化建议

---

## 📊 项目规模概览

| 指标 | 数值 |
|------|------|
| 总 dist 产物 | **6.2 MB** |
| JS 总大小 | **3.4 MB** (67 个 chunk) |
| CSS 总大小 | **694 KB** (单一文件) |
| 图片资源 | **1.89 MB** (其中 logo-brand.png 1.76MB) |
| GLB 3D 模型 | **63 KB** |
| 源码文件数 | ~200 个 JS 文件 |
| 最大单文件 (agent-office-scene.js) | **1639 行** |
| node_modules | **100 MB** |

---

## 🔴 严重性能问题（必须立即修复）

### 1. Vite 开发服务器 EBUSY 崩溃 — 进程完全终止

- **位置**: `vite.config.js:58-72` / `dev-server-5179.log:230-254`
- **严重程度**: 🔴 CRITICAL
- **影响**: 开发服务器直接崩溃退出（Node.js v24.16.0），所有开发工作中断

**根因分析**:
Vite 的 chokidar 文件监视器在扫描项目目录时，尝试 watch `src-tauri/target/release/deps/clawpanel.exe`。Windows 对正在运行的 `.exe` 文件强制 EBUSY 锁，chokidar 的 `fs.watch()` 调用失败并抛出未捕获异常。虽然 `ignoredWatchPath` 函数（第 58-72 行）包含 `src-tauri/target/` 排除规则，但 chokidar 在初始化扫描期间就可能触发对 `.exe` 的 watch，此时 ignore 过滤器尚未完全生效。这是一个 chokidar + Windows + Tauri 编译产物的已知边界问题。

**实际日志证据**（`dev-server-5179.log:231-253`）:
```
Error: EBUSY: resource busy or locked, watch 'E:\Code\codex\ChatCraw\src-tauri\target\release\deps\clawpanel.exe'
    at FSWatcher.<computed> (node:internal/fs/watchers:321:19)
    at Object.watch (node:fs:2548:36)
...
Emitted 'error' event on FSWatcher instance at:
    at FSWatcher._handleError (file:///.../vite/dist/node/chunks/dep-Dq2t6Dq0.js:23896:10)
```

**修复建议**:
```javascript
// vite.config.js — 将 ignored 改为更激进的数组策略，并添加 fs.deny
export default defineConfig({
  server: {
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/dist/**',
        '**/.tmp/**',
        '**/reports/**',
        '**/screenshots/**',
        '**/*.exe',       // 显式排除所有可执行文件
        '**/*.dll',       // 显式排除 DLL
      ],
    },
    fs: {
      deny: [
        'src-tauri/target',  // 完全禁止访问 Tauri 构建目录
      ],
    },
  },
})
```
同时建议将 `TAURI_TARGET_DIR` 环境变量指向项目外的目录（如 `%TEMP%/clawpanel-target`），彻底隔离构建产物与开发目录。

---

### 2. logo-brand.png 图片严重过大 — 1.76MB

- **位置**: `public/images/logo-brand.png` → `dist/images/logo-brand.png`
- **严重程度**: 🔴 CRITICAL
- **影响**: 首页加载时必须下载 1.76MB 的纯静态图片资源

**根因分析**:
该图片是未经优化的 PNG 格式。对于品牌 Logo 类图形，现代格式可将体积压缩 90%+。

| 当前 | 优化后 (WebP) | 优化后 (AVIF) | 节省 |
|------|--------------|--------------|------|
| 1,760 KB | ~100 KB | ~60 KB | **94-97%** |

**修复建议**:
1. 立即转换为 WebP（兼容所有现代浏览器）
2. 添加 AVIF 格式并提供 `<picture>` fallback
3. 在构建脚本中加入 `sharp` 或 `imagemin` 自动压缩步骤
4. 将这张图片改为懒加载（仅 about/settings 页面需要）

示例构建脚本集成:
```javascript
// scripts/optimize-images.mjs
import sharp from 'sharp'
await sharp('public/images/logo-brand.png')
  .resize(800) // 最大宽度 800px 足够
  .webp({ quality: 85 })
  .toFile('public/images/logo-brand.webp')
```

---

### 3. 694KB 单一 CSS 文件 — 阻塞首次渲染

- **位置**: `dist/assets/index-DMLw4Ugq.css` (694,667 bytes)
- **严重程度**: 🔴 CRITICAL
- **影响**: 浏览器必须下载并解析全部 694KB CSS 后才能渲染首屏。在慢速网络下，这意味 3-5 秒白屏。

**根因分析**:
`src/main.js` 第 33-66 行**一次性导入所有 CSS 文件**：
```javascript
import './style/variables.css'
import './style/compat.css'
import './style/reset.css'
import './style/layout.css'
import './style/components.css'
import './style/pages/dashboard.css'
import './style/pages/about.css'
// ... 共 24 个 CSS import
```
所有这些 CSS 都被 Vite 合并成一个 chunk。用户访问任何页面（如 /about）都需要加载全部 24 个页面的 CSS。

**修复建议**:
1. 将页面级 CSS 改为按路由懒加载：
```javascript
// main.js — 仅保留全局样式
import './style/variables.css'
import './style/reset.css'
import './style/layout.css'
import './style/components.css'

// router.js — 路由加载时动态注入 CSS
async function loadRoute() {
  const cssMap = {
    '/dashboard': () => import('./style/pages/dashboard.css'),
    '/about': () => import('./style/pages/about.css'),
    // ...
  }
  if (cssMap[routePath]) await cssMap[routePath]()
}
```
2. 关键 CSS 内联到 `<head>`（variables.css + reset.css 约 5KB），其余异步加载
3. 启用 Vite 的 `cssCodeSplit`（默认开启，但当前配置因所有 CSS 被 main.js 集中导入而失效）

---

## 🟠 中等性能风险（建议修复）

### 4. Three.js (575KB) 无懒加载隔离 — 访问 Agent 页时瞬间加载 620KB

- **位置**: `src/components/agent-office-scene.js:1-3`
- **文件大小**: `vendor-three-D1UMg4e7.js` 575KB + `vendor-three-addons-Bfc--dd6.js` 44KB + `agent-office-scene-i80ARtoa.js` 41KB = **660KB**
- **严重程度**: 🟠 HIGH

**根因分析**:
虽然 `agent-office-scene.js` 是通过路由懒加载的（不访问 Agents 页就不会加载），但当用户首次导航到 Agents 页面时，需要同时下载 660KB 的 JS —— 造成明显的页面切换延迟。

**修复建议**:
1. 在路由加载前显示加载进度指示器
2. 考虑使用 `import()` 的 `preload` 提示：当用户 hover Agent 导航项时预加载
```javascript
// sidebar.js — hover 预加载
navItem.addEventListener('mouseenter', () => {
  const link = document.createElement('link')
  link.rel = 'modulepreload'
  link.href = '/assets/vendor-three-D1UMg4e7.js'
  document.head.appendChild(link)
})
```
3. 评估是否可以用 Canvas 2D 或 CSS 3D 替代 Three.js 实现 Agent 办公室可视化（可能节省 500KB+）

---

### 5. 15 个 setInterval 定时器同时运行 — CPU 持续占用

- **位置**: 多个文件（详见下方表格）
- **严重程度**: 🟠 HIGH

**根因分析**:
项目中有 15 处 `setInterval` 调用，全部在后台持续运行。用户可能同时打开多个页面（SPA 内不真正卸载），导致定时器累积。高频定时器（200ms、1s、2s）尤其消耗资源。

| 文件 | 间隔 | 用途 | 风险 |
|------|------|------|------|
| `pages/assistant.js:2371` | **200ms** | 流式气泡刷新 | 🔴 极高 |
| `pages/chat.js:3591` | **1s** | 倒计时更新 | 🟠 高 |
| `pages/chat.js:3405` | **5s** | 打字耗时更新 | 🟡 中 |
| `hermes/pages/logs.js:136` | **2s** | 日志尾行轮询 | 🟠 高 |
| `hermes/pages/dashboard.js:883` | 可变 | 仪表盘自动刷新 | 🟡 中 |
| `main.js:439` | **5s** | 后端健康检测 | 🟡 中 |
| `app-state.js:208` | **15s** | Gateway 轮询 | 🟡 中 |
| `hermes/index.js:29` | **15s** | Hermes 状态轮询 | 🟡 中 |
| `ws-client.js:792` | **30s** | WebSocket ping | 🟢 低 |
| `ws-client.js:813` | **30s** | 心跳检测 | 🟢 低 |
| `pages/agents.js:607` | 可变 | Office 演示 | 🟡 中 |
| `pages/agents.js:679` | 可变 | Office 压力测试 | 🟡 中 |
| `pages/services.js:368` | 可变 | 服务状态轮询 | 🟡 中 |
| `main.js:1390` | **30min** | 更新检查 | 🟢 低 |
| `main.js:1395` | **30min** | 公告检查 | 🟢 低 |

**修复建议**:
1. **关键**: 使用 Page Visibility API 在页面不可见时暂停所有非关键定时器
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAllNonCriticalTimers()
  } else {
    resumeTimers()
  }
})
```
2. 用 `requestAnimationFrame` 替代高频 `setInterval`（200ms 的流式刷新可以考虑用 rAF + 时间戳节流）
3. 路由切换时必须清理旧页面的所有定时器（当前 `router.js` 的 `_currentCleanup` 机制依赖各页面实现 `cleanup` 函数，但部分页面未实现）

---

### 6. 日志页面 2 秒轮询无节流 — 大量不必要网络请求

- **位置**: `src/engines/hermes/pages/logs.js:136`
- **严重程度**: 🟠 HIGH

**根因分析**:
```javascript
tailTimer = setInterval(() => loadEntries({ silent: true }), 2000)
```
每 2 秒向后端发起请求。当用户打开多个标签页或长时间停留在日志页面时，会产生大量请求。无节流机制，无 visible 检测。

**修复建议**:
1. 页面不可见时暂停轮询
2. 使用指数退避：如果连续 N 次返回相同数据，延长轮询间隔
3. 考虑 WebSocket 推送替代轮询（项目已有 ws-client）

---

### 7. 首页 inline CSS 260 行 — HTML 体积 23KB

- **位置**: `index.html:18-268`
- **严重程度**: 🟠 MEDIUM

**根因分析**:
Splash 启动屏的完整 CSS（260 行，~10KB）直接嵌入 HTML，每次请求都传输。虽然对启动速度有帮助，但可以优化。

**修复建议**:
1. 仅保留关键渲染路径的 CSS（~50 行），其余移入外部文件
2. 外部 splash CSS 使用 `<link rel="preload">` 提前加载

---

### 8. Google Fonts 远程加载无 display=swap — 字体闪烁

- **位置**: `index.html:13-16`
- **严重程度**: 🟠 MEDIUM

**根因分析**:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:...&family=Space+Grotesk:...&display=swap" media="print" onload="this.media='all'">
```
虽然使用了 `onload` 技巧异步加载，但 `display=swap` 参数**已存在**于 URL 中。这是好的实践。
**但问题是**：preconnect 只做了 `fonts.googleapis.com` 和 `fonts.gstatic.com`，还需要 DNS 解析和 TCP 连接时间。

**修复建议**:
1. 考虑将关键字体预加载并子集化（仅包含实际使用字符）
2. 或在构建时将字体本地化（通过 `vite-plugin-fonts` 或手动下载）

---

### 9. Router 模块缓存永不过期 — 长期运行内存增长

- **位置**: `src/router.js:8` (`_moduleCache`)
- **严重程度**: 🟠 MEDIUM

**根因分析**:
```javascript
const _moduleCache = {}
// ...
_mod = await retryLoad(loader, 3, 500)
// ...
_moduleCache[routePath] = mod  // 永久缓存，从不清理
```
用户每访问一个新页面，模块就被永久缓存。对于有 40+ 路由的应用，内存会持续增长。LRU 缓存或页面数限制可以防止内存泄漏。

**修复建议**:
```javascript
const MAX_CACHED_MODULES = 10
const _moduleCache = new Map()  // 使用 Map 便于 LRU 实现
// 插入时：
_moduleCache.set(routePath, mod)
if (_moduleCache.size > MAX_CACHED_MODULES) {
  const firstKey = _moduleCache.keys().next().value
  _moduleCache.delete(firstKey)
}
```

---

## 🟡 优化建议（可后续迭代）

### 10. 多语言 JSON 全量打包 — locale 文件 869KB

- **位置**: `src/locales/*.json` → `locale-*.js` (共 869KB)
- **严重程度**: 🟡 LOW

**根因分析**:
所有语言的翻译文件被打包成 5 个 chunk（locale-shell 277KB, locale-engine 251KB, locale-ai 195KB, locale-ops 146KB, locale-data 51KB）。用户只需要当前语言的翻译，但所有语言的文本都被加载。

**修复建议**:
按语言拆分为独立 chunk，动态加载当前语言：
```javascript
const lang = getLang()
const messages = await import(`./locales/${lang}.json`)
```

---

### 11. 构建产物缺少压缩 — 3.4MB JS 实际传输可能 1.2MB

- **位置**: 部署配置 (nginx/vite preview)
- **严重程度**: 🟡 LOW

**建议**: 启用 Brotli 压缩（压缩率比 Gzip 高 20%）。3.4MB JS + 694KB CSS → 约 1.1MB（Brotli Level 6）。

---

### 12. 图片资源未做响应式处理

- **位置**: `public/images/` (logo-brand.png 1.76MB, bnbqr.jpg 116KB, OpenClaw-DY.png 8.6KB)
- **严重程度**: 🟡 LOW

**建议**:
1. `bnbqr.jpg` (116KB) 可优化为 WebP ~20KB
2. 所有 PNG 使用 `pngquant` 或 `oxipng` 进行无损压缩
3. 在构建脚本中集成自动图片优化

---

### 13. Three.js 场景每帧创建临时对象 — GC 压力

- **位置**: `src/components/agent-office-scene.js:1439-1545` (animateRecord 方法)
- **严重程度**: 🟡 LOW

**根因分析**:
`animateRecord` 方法每帧调用 `this.tmpVec3.copy(target).sub(avatar.position)` 等操作。虽然有 `tmpVec3` 预分配，但 spawn 了多个临时 Vector3。在 50 个 Agent 的场景（DENSE_AGENT_COUNT）下，每帧 150+ 次向量运算，可能对低端设备造成压力。

**建议**:
1. 在 `reducedMotion` 模式下完全跳过逐帧动画计算
2. 对远离相机的 Agent 降低动画更新频率（LOD 系统当前已实现 quality 预设）

---

### 14. 构建配置缺少 treeshake 显式配置

- **位��**: `vite.config.js:113-123`
- **严重程度**: 🟡 LOW

当前 build 配置只有 `target`, `minify`, `sourcemap`, `chunkSizeWarningLimit`, `rollupOptions.output.manualChunks`。建议添加：
```javascript
build: {
  target: ['es2021', 'chrome100', 'safari13'],
  minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
  sourcemap: !!process.env.TAURI_DEBUG,
  chunkSizeWarningLimit: 700,
  reportCompressedSize: false, // 加快构建速度
  rollupOptions: {
    output: {
      manualChunks,
      // 实验性：更激进的 tree-shaking
      treeshake: {
        preset: 'recommended',
        moduleSideEffects: (id) => {
          if (id.includes('three/examples/')) return false
        },
      },
    },
  },
}
```

---

### 15. WebSocket 消息缓存无上限总量限制

- **位置**: `src/lib/ws-client.js:147-149, 1000-1029`
- **严重程度**: 🟡 LOW

**根因分析**:
```javascript
this._messageCache = new Map()   // 按 session 分组
this._cacheSize = MESSAGE_CACHE_SIZE  // 100 条/会话

_cachedMessage(sessionKey, message) {
  // ...
  const totalSize = JSON.stringify(messages).length
  while (totalSize > 5 * 1024 * 1024 && messages.length > 1) {  // 5MB/session
    messages.shift()
  }
}
```
每个 session 缓存最多 100 条消息或 5MB。如果有 10 个活跃 session，可能缓存 50MB。`JSON.stringify` 每次插入消息都做一次，开销大。

**建议**:
1. 设置全局缓存上限（如 20MB total）
2. 使用估算大小代替 `JSON.stringify`（`msg.length * 2` 近似）
3. 定期清理旧缓存（如 30 分钟未访问的 session）

---

### 16. dev-api.js 热重载过于频繁 — server restart 浪费

- **位置**: `dev-server-5179.log:14-56`
- **严重程度**: 🟡 LOW (仅开发环境)

**根因分析**:
日志显示 `scripts/dev-api.js changed, restarting server...` 触发了 6 次服务器重启。每次重启导致完整的 Vite 重新编译和 WebSocket 断连。

**建议**: 将 `dev-api.js` 中的配置读写逻辑与 Vite plugin 逻辑分离，减少不必要的文件变更触发。

---

## 📈 构建产物分级分析

### Top 10 最大 JS chunks:

| Chunk | 大小 | 占比 | 类型 |
|-------|------|------|------|
| vendor-three-D1UMg4e7.js | **576 KB** | 16.9% | 第三方 (3D) |
| assistant-C9rrjEzn.js | **328 KB** | 9.6% | 页面 |
| locale-shell-Bi_Lvk0m.js | **278 KB** | 8.2% | i18n |
| index-BrkIGsOt.js | **262 KB** | 7.7% | 入口 |
| locale-engine-D8y0WXpn.js | **251 KB** | 7.4% | i18n |
| locale-ai-CymvdbM6.js | **196 KB** | 5.8% | i18n |
| locale-ops-DfgnMQ5k.js | **147 KB** | 4.3% | i18n |
| channels-BSQxjoKi.js | **125 KB** | 3.7% | 页面 |
| chat-B32VSE-I.js | **99 KB** | 2.9% | 页面 |
| config-DE7RX5vJ.js | **94 KB** | 2.8% | 页面 |

### 资源分布:
- **JS**: 3.4 MB (55%)
- **图片**: 1.89 MB (30%)
- **CSS**: 694 KB (11%)
- **3D 模型**: 63 KB (1%)
- **HTML**: 24 KB (<1%)
- **其他**: 157 KB (2%)

---

## 🎯 优化路线图

### 第一阶段（本周 — 即时生效）
1. 🔴 转换 `logo-brand.png` → WebP (节省 ~1.6MB)
2. 🔴 CSS 按路由拆分 (首次加载减少 400KB+)
3. 🔴 修复 Vite EBUSY 崩溃 (解除开发阻塞)

### 第二阶段（下周 — 架构优化）
4. 🟠 实现定时器 Page Visibility 暂停机制
5. 🟠 Router 模块缓存添加 LRU 上限
6. 🟠 日志页面轮询添加可见性检测 + 指数退避
7. 🟠 添加 Three.js hover 预加载

### 第三阶段（后续迭代 — 深度优化）
8. 🟡 多语言按需加载
9. 🟡 图片自动压缩构建集成
10. 🟡 Three.js LOD 系统增强
11. 🟡 WebSocket 缓存总量限制

---

## 📋 检查清单

- [x] package.json 依赖审查 — 生产依赖 5 个 (精简), 开发依赖 3 个 (合理)
- [x] 构建配置检查 — vite.config.js 已进行基础优化, 缺少 CSS code splitting
- [x] 源码架构分析 — 清晰的引擎分离 (openclaw/hermes/xintian), 良好模块化
- [x] 日志异常检测 — EBUSY 崩溃确认, dev-api 热重载频繁
- [x] 内存泄漏检查 — Timer 清理较完善, moduleCache 无上限
- [x] 网络请求分析 — 15 个定时器, 缺少 visibility 检测
- [x] Bundle 大小分析 — CSS 694KB 单一文件为最大问题
