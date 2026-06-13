# 项目问题分析报告 — 2026-06-12

## 基线状态
- **测试**: ✅ 568 PASS, 0 FAIL
- **构建**: ✅ 2.81s, 无警告
- **安全**: ⚠️ 有待处理项（见下）

---

## P0 — 严重问题

### 1. DOMPurify 异步加载时间窗口 [XSS 风险]

**文件**: [src/lib/markdown.js:258](src/lib/markdown.js#L258)

**问题**:
```javascript
// DOMPurify 懒加载，可能在首次调用 renderMarkdown 时未就绪
let DOMPurify = null
let _purifyReady = false
if (_IS_BROWSER) {
  import('dompurify').then(m => { DOMPurify = m.default; _purifyReady = true }).catch(() => {})
}

// renderMarkdown 中的检查
if (_IS_BROWSER && DOMPurify?.sanitize && _purifyReady) {
  raw = DOMPurify.sanitize(raw, {...})
}
```

**风险**: 首次页面加载时，DOMPurify 可能尚未加载完成，`renderMarkdown()` 会跳过消毒直接输出 HTML。

**建议**: 
- 方案A: 使用同步 import（Vite 支持 `import.meta.url` 或预加载 `<link rel="modulepreload">`）
- 方案B: 在 renderMarkdown 开头添加 `_purifyReady` 就绪等待或使用缓存占位符
- 方案C: 将 DOMPurify 检查改为 `DOMPurify ?? null`，并在 ALLOWED_TAGS 极度严格（禁用 img/a/script 等）

---

## P1 — 重要问题

### 2. CSS 变量 `--text-4` 未定义

**现状**: `--text-4` 变量在 `variables.css` 中未定义（无 `text-4` 声明），但未发现引用（grep 结果为空）。

**建议**: 确认无使用后无需处理；如需兼容可添加:
```css
--text-4: var(--text-disabled);
```

### 3. console.error 可能泄漏敏感信息

**文件**: 多个 page 文件

| 文件 | 行号 | 潜在问题 |
|------|------|----------|
| [agents.js:1144](src/pages/agents.js#L1144) | `console.error('[Agent编辑] 获取模型列表失败:', e?.message ?? e)` | ✅ 已 humanizeError |
| [chat.js:1474](src/pages/chat.js#L1474) | `console.error('[chat] refreshSessionList error:', e?.message ?? e)` | ⚠️ 直接输出错误信息 |
| [dashboard.js:84](src/pages/dashboard.js#L84) | `console.error('[dashboard] loadDashboardData 异常:', e?.message ?? e)` | ⚠️ 直接输出错误信息 |
| [models.js:247](src/pages/models.js#L247) | `console.error('[models] loadConfig failed:', e?.message ?? e)` | ⚠️ 直接输出错误信息 |

**建议**: 统一使用 `humanizeError()` 包装错误信息：
```javascript
import { humanizeError } from '../lib/humanize-error.js'
console.error('[chat] refreshSessionList error:', humanizeError(e))
```

### 4. markdown.js 顶层 `document.addEventListener` 调用

**文件**: [src/lib/markdown.js:387](src/lib/markdown.js#L387)

```javascript
if (_IS_BROWSER) {
  document.addEventListener('error', (e) => { ... })  // ✅ 已有保护
}
```

**现状**: 已有 `_IS_BROWSER` 检查，无问题。但模式与其他模块不一致（多数模块在 `render()` 后绑定）。

**建议**: 文档化说明此模式的设计意图。

---

## P2 — 改进建议

### 5. CSS 变量命名不一致

**问题**: 部分 CSS 文件使用 `aether-*` 语义化变量，部分使用旧别名如 `bg-card`、`text-1`：

```css
/* agents.css:566 */
color-mix(in srgb, var(--agent-color) 70%, var(--text-1));
```

**建议**: 
- 统一迁移到 `aether-*` 语义化变量
- 或在 `variables.css` 中补充旧别名映射（已部分完成）

### 6. 浅色主题 CSS 变量覆盖不完整

**文件**: [src/style/variables.css:472-529](src/style/variables.css#L472)

**问题**: 浅色主题（`@media (prefers-color-scheme: light)`）未覆盖所有变量：
- `aether-secondary` 未在浅色主题重新定义
- `--success-bg`/`--warning-bg` 等语义变量未覆盖

**建议**: 补充浅色主题语义颜色覆盖。

### 7. `--aether-sunken` 定义位置异常

**文件**: [src/style/variables.css:423](src/style/variables.css#L423)

```css
--aether-sunken:      #0A0A14;  /* 硬编码 */
--bg-sunken:         var(--aether-sunken);
```

**问题**: `aether-sunken` 在 `--bg-*` 别名块中定义，而非与其他 `aether-*` 变量一起。

**建议**: 移至 `--aether-*` 变量块中定义，保持一致性。

---

## P3 — 细节优化

### 8. expert-teams.js XSS 风险

**文件**: [src/pages/expert-teams.js:815](src/pages/expert-teams.js#L815)

```javascript
option(expert.id, expert.name)  // expert.name 未 escapeHtml
```

**建议**: 确认 `expert.name` 来源（API/用户输入），必要时添加 `escapeHtml()`。

### 9. agents.css 重复变量定义

**文件**: [src/style/agents.css:356-430](src/style/agents.css#L356-L430)

**问题**: agents.css 中存在重复的 `bg-card` 相关定义，可能导致样式冲突。

**建议**: 合并重复定义，统一使用 CSS 变量。

### 10. assistant.js 调试覆盖层内联事件处理

**文件**: [src/pages/assistant.js:8940-8943](src/pages/assistant.js#L8940-L8943)

**问题**: `.ast-debug-close` 和 `.ast-debug-copy` 按钮使用 `.onclick` 属性赋值而非 `addEventListener`。

**建议**: 迁移到事件委托或 `addEventListener` 模式。

---

## 项目亮点（无需修改）

| 特性 | 状态 |
|------|------|
| 内联 onclick 处理程序 | ✅ 全部已迁移到事件委托 |
| 图片 src 安全化 | ✅ `safeImageSrc()` 白名单验证 |
| 链接 href 安全化 | ✅ `safeLinkUrl()` 白名单验证 |
| escapeHtml/escapeAttr | ✅ 完整实现 |
| 代码高亮安全 | ✅ 两阶段转义 + 控制字符隔离 |
| WebSocket 日志脱敏 | ✅ session keys 已脱敏 |
| 测试覆盖率 | ✅ 568 个测试用例 |

---

## 优先级排序

| 优先级 | 问题 | 影响 |
|--------|------|------|
| P0 | DOMPurify 异步加载时间窗口 | XSS 风险 |
| P1 | console.error 敏感信息泄漏 | 隐私/调试信息 |
| P1 | CSS 变量 `--text-4` 缺失 | 潜在样式断裂 |
| P2 | CSS 变量命名不一致 | 可维护性 |
| P2 | 浅色主题覆盖不完整 | UI 一致性 |
| P3 | expert-teams XSS | 低风险（需确认数据源） |
| P3 | assistant.js 调试覆盖层 | 代码风格 |

---

## 建议行动

1. **立即**: 修复 P0 DOMPurify 加载时序问题（同步 import 或严格 ALLOWED_TAGS）
2. **本周**: 修复 P1 console.error 泄漏 + `--text-4` 定义
3. **下迭代**: P2 CSS 变量统一 + 浅色主题补充
4. **后续**: P3 细节优化