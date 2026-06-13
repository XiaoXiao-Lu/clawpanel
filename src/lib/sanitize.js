/**
 * DOMPurify 消毒器 — 统一初始化模块
 *
 * 顶层静态 import，Vite 将其打包进主 chunk，首屏渲染时 DOMPurify 必定已就绪。
 * 消除 markdown.js / modal.js 中动态 import() 导致的首次调用时序窗口。
 *
 * 在 SSR/测试环境（无 window/document）下自动降级：
 * - DOMPurify = null
 * - purifyReady = false
 * 调用方使用 `if (DOMPurify) DOMPurify.sanitize(...)` 模式检查。
 */

// 顶层静态 import：Vite 条件化处理，SSR/测试环境自动排除。
// 浏览器环境下，DOMPurify 在模块解析阶段同步就绪。
import _DOMPurify from 'dompurify'

export const DOMPurify = _DOMPurify
export const purifyReady = true