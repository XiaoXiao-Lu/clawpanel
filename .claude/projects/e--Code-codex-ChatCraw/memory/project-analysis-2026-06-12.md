# ChatCraw 项目问题分析报告

**日期**: 2026/06/12
**审查范围**: 前端 JS、CSS、国际化、功能完整性

---

## 一、已确认问题清单

### P1 — Markdown XSS 风险（安全）

**位置**: [src/lib/markdown.js](src/lib/markdown.js)
**问题**: `renderMarkdown()` 生成 HTML 后直接通过 `innerHTML` 注入到页面，未使用 DOMPurify 消毒。AI 响应中若含恶意脚本（如 `<img src=x onerror=alert(1)>`），可能执行 XSS。

**证据**:
```js
// assistant.js:8655
bubble.innerHTML = renderMarkdown(aiMsg.content) + '<span class="ast-cursor"></span>'
```

**影响**: 高 — 任何通过 AI 模型注入的内容都可执行任意脚本

**建议**:
- 方案 A: 引入 DOMPurify，输出前消毒
  ```js
  import DOMPurify from 'dompurify'
  return DOMPurify.sanitize(result.join('\n'))
  ```
- 方案 B: 保持当前手动过滤，但移除所有 `onerror`/`onload` 内联事件（markdown.js:349 当前有内联 onerror）

---

### P2 — assistant.js 体积过大（可维护性）

**位置**: [src/pages/assistant.js](src/pages/assistant.js)
**问题**: 单文件 9,532 行，308 个函数，超出单文件可维护阈值（业界推荐 < 2,000 行）

**影响**: 中 — 新成员上手成本高，改一处易引发连锁问题

**建议**:
- 将 expert team 相关逻辑（~500 行）抽取到 `expert-team-ui.js`
- 将 message bubble 渲染抽取到 `message-bubble.js`
- 将 stats/metrics 渲染抽取到 `stats-renderer.js`

---

### P3 — expert-teams.js 缺少错误边界（健壮性）

**位置**: [src/pages/expert-teams.js](src/pages/expert-teams.js)
**问题**: `Promise.allSettled` 在 runner 中使用正确，但 page 层对网络错误、API 超时无用户友好的 fallback UI

**证据**:
```js
// expert-teams.js 中缺少错误状态渲染
catch (err) {
  toast.error(humanizeError(err))  // 仅 toast，无状态持久化
}
```

**影响**: 低 — 错误仅通过 toast 展示，用户刷新后无法恢复上下文

---

## 二、CSS 变量兼容性（已解决 ✓）

**问题**: expert-teams.css 混用旧变量名（`--text-1`、`--border-1`、`--bg-sunken`）与新 aether 变量

**现状**: 已解决 — `variables.css:438-454` 已建立完整别名映射层：
```css
--text-1: var(--text-primary);   /* 兼容旧代码 */
--border-1: var(--aether-border);
--bg-sunken: #0A0A14;
```

**结论**: 无需修改

---

## 三、国际化完整性（良好 ✓）

| 模块 | 翻译键数量 |
|------|-----------|
| expertTeams | 236 条 |
| assistant | 大量 |
| 覆盖状态 | 完整 |

expert-teams 使用 `t()` 包装所有用户可见文本，键盘操作 ARIA 属性已正确设置。

---

## 四、文件规模概览

| 文件 | 行数 | 函数数 | 状态 |
|------|------|--------|------|
| [assistant.js](src/pages/assistant.js) | 9,532 | 308 | ⚠️ 过大 |
| [expert-teams.js](src/pages/expert-teams.js) | 1,480 | 45 | ✓ |
| [expert-team-runner.js](src/lib/expert-team-runner.js) | ~400 | 15 | ✓ |
| [expert-teams.css](src/style/pages/expert-teams.css) | 1,150 | — | ✓ |
| [markdown.js](src/lib/markdown.js) | 383 | 15 | ⚠️ 需 XSS 防护 |

---

## 五、本轮修复建议优先级

| 优先级 | 行动项 | 工作量 |
|--------|--------|--------|
| P1 | 引入 DOMPurify 消毒 Markdown 输出 | 30 分钟 |
| P1 | 移除 markdown.js:349 内联 `onerror` | 10 分钟 |
| P2 | 抽取 assistant.js expert-team UI 代码 | 2-3 小时 |
| P3 | expert-teams 错误状态持久化 | 1 小时 |

---

## 六、安全扫描结果

| 检查项 | 结果 |
|--------|------|
| `eval()` / `Function()` 动态代码 | ✓ 未发现 |
| 内联 `onclick` 事件处理器 | ✓ 已使用事件委托 |
| 未转义 HTML 直接注入 | ✓ 大部分使用 `escapeHtml()` |
| localStorage 敏感数据 | ⚠️ 仅存配置/会话 ID，无凭证 |
| XHR/fetch 凭证泄露 | ✓ 未发现问题 |

---

*报告生成完毕。P1 修复建议优先处理。*