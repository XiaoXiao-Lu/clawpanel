# 迭代报告 — 2026-06-12

## 扫描范围

| 阶段 | 状态 | 产出 |
|------|------|------|
| 基线验证（测试 + 构建） | ✅ 568 通过 / 0 失败 | dist 正常 |
| git status 审查 | ✅ | 已改动文件 6 个 |
| 核心模块扫描 | ✅ | 18 个核心 JS/CSS |
| 安全扫描 | ✅ | XSS + 日志泄漏 |
| CSS 变量一致性 | ✅ | 别名已完整定义 |
| 构建 + 测试 | ✅ | 2.68s / 568 通过 |

## 本轮修复

### P1: `modal.js` XSS 漏洞修复

**文件**: `src/components/modal.js`

**问题**: `appendHtmlLog(line)` 使用 `div.innerHTML = line` 直接注入 HTML 内容。
通过该函数渲染的动态内容（如 `setup.js:1126` 传入的 `{ err: ge }` 本地化消息）若含特殊字符，可导致 XSS。

**修复**: 动态导入 DOMPurify，sanitize 后再注入。未就绪时回退到 `textContent`。

```diff
+ let DOMPurify = null
+ let _purifyReady = false
+ if (typeof window !== 'undefined') {
+   import('dompurify').then(m => { DOMPurify = m.default; _purifyReady = true }).catch(() => {})
+ }

  appendHtmlLog(line) {
    _logLines.push(line)
    const div = document.createElement('div')
-   div.innerHTML = line
+   if (DOMPurify?.sanitize && _purifyReady) {
+     div.innerHTML = DOMPurify.sanitize(line, { USE_CLOSES: false })
+   } else {
+     div.textContent = line
+   }
    logBox.appendChild(div)
    logBox.scrollTop = logBox.scrollHeight
  }
```

**验证**: `icon()` / `statusIcon()` 返回硬编码 SVG 路径，不接受用户输入，逻辑安全。`setup.js` 和 `services.js` 中的调用均通过 DOMPurify sanitize。

### P2: `models.js` console.error 敏感信息泄漏

**文件**: `src/pages/models.js:247`

**问题**: `console.error('[models] loadConfig failed:', e)` 输出完整 Error 对象，包含内部错误消息、HTTP 状态码等敏感信息。

**修复**: 改为只输出错误消息字符串，与 `chat.js` 保持一致。

```diff
- console.error('[models] loadConfig failed:', e)
+ console.error('[models] loadConfig failed:', e?.message ?? e)
```

## 二次全局复盘

| 检查项 | 结果 |
|--------|------|
| XSS: `modal.js:appendHtmlLog` | ✅ 已修复 |
| XSS: `markdown.js:onerror` | ✅ 已有 DOMPurify + img onerror 防御 |
| XSS: `skills.js:onerror` | ✅ onerror 只清理 src 属性 |
| 日志泄漏: `chat.js` | ✅ 已有 safeAssistantErrorText |
| 日志泄漏: `models.js` | ✅ 刚修复 |
| CSS 变量: `--text-1/2/3/4` | ✅ variables.css 已定义别名 |
| CSS 变量: `--border-1/2` | ✅ 已定义别名 |
| CSS 变量: `--bg-base/raised/sunken` | ✅ 已定义别名 |
| 硬编码凭证 | ✅ 无 |
| localStorage 凭证暴露 | ✅ 无 |
| 顶层 `document.addEventListener` | ✅ 无 |
| scroll/resize 无 debounce | ✅ 合理使用 |
| async/await 未 catch | ✅ 合理使用（边界错误由外层处理）|

## 待改进项（本次未处理）

以下问题在扫描中被识别，建议后续迭代处理：

1. **代码风格**: `assistant.js` 中大量 `.onclick = () => {}` 属性赋值 vs `addEventListener`。建议迁移到统一的事件委托模式。
2. **P3 错误边界**: 部分 async 函数未对特定错误类型做区分处理，统一 catch 所有异常后输出通用消息。

## 提交

```bash
git add src/components/modal.js src/pages/models.js
git commit -m "fix: P1 modal.js XSS + P2 models.js console.error sanitization

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```