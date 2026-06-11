/**
 * 开发期日志工具
 *
 * 生产构建（import.meta.env.DEV 为假）下静默，避免把模型列表、保存载荷、
 * 运行时内部状态等调试信息泄漏到用户浏览器控制台。
 * 真正的错误/警告请继续使用 console.error / console.warn。
 */

function isDev() {
  try {
    return !!import.meta.env?.DEV
  } catch {
    return false
  }
}

/** 仅在开发环境输出的调试日志。 */
export function devLog(...args) {
  if (!isDev()) return
  console.log(...args)
}

/** 仅在开发环境输出的调试警告。 */
export function devWarn(...args) {
  if (!isDev()) return
  console.warn(...args)
}
