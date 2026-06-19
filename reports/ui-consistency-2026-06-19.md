# UI 一致性修复报告 — 2026-06-19

## 概述

针对"多处 UI 显示有问题，不统一协调"的问题，对全项目 25 个 CSS 文件 + JS 内联样式进行了深度扫描，发现 2,300+ 处硬编码值。本次修复聚焦于影响视觉一致性最严重的问题。

## 扫描发现

| 问题类型 | 总数 | 最严重文件 |
|----------|------|------------|
| 硬编码间距 px | 1,344 | hermes.css (463), assistant.css (300) |
| 硬编码 rgba() | 326 | hermes.css (70), chat.css (55) |
| 硬编码字号 px | 272 | hermes.css (211) |
| 硬编码圆角 px | 122 | hermes.css (91) |
| 硬编码 hex 色 | 118 | hermes.css (64), xintian.css (54) |
| 硬编码过渡时长 | 84 | hermes.css (50) |
| !important | 46 | — |
| 硬编码 z-index | 23 | — |

**根本原因**: `polish.css` 全局覆盖了共享组件样式（.btn-primary, .btn-ghost, .badge, .input），使用不同的变量和硬编码值，导致整个 UI 不一致。

## 本次修复内容

### P0 功能缺陷修复
1. **channels.js:2470** — `color:#000` → `color:var(--text-primary)` (深色主题下文字不可见)

### polish.css 全局覆盖修复（根因修复）
2. **.btn-primary 阴影** — `rgba(124,111,255,0.3)` → `var(--shadow-btn-primary)`
3. **.btn-primary:hover** — 移除 `background:var(--aether-primary)` 覆盖（保持渐变），阴影改用变量
4. **.btn-ghost** — 从 secondary 按钮组中移除（恢复透明背景）
5. **.input/.form-input 背景** — `var(--bg-elevated)` → `var(--aether-void)` (与共享定义一致)
6. **.input:hover 边框** — `var(--aether-primary)` → `var(--aether-border-focus)` (与共享定义一致)
7. **.input:focus** — 补充缺失的 `background:var(--aether-base)`
8. **.badge** — 从 border 覆盖组中移除（恢复共享定义的无边框样式）
9. **.ast-welcome-icon 阴影** — `rgba(124,111,255,0.3)` → `var(--brand-shadow-base)`
10. **.ai-fab:hover 阴影** — `rgba(124,111,255,0.4)` → `var(--brand-shadow-hover)`
11. **.ast-error-banner** — 硬编码 rgba → `var(--error-hover-border)` / `var(--error-surface)`

### chat.css 硬编码值清理
12. **12 处 `rgba(124,111,255,...)`** → `var(--aether-primary-muted)` / `var(--chat-tool-bg)` / `var(--tool-surface)` / `var(--aether-primary-faint)` / `var(--accent-border)` / `var(--tool-border)`
13. **3 处 `rgba(0,0,0,...)` 叠加** → `var(--overlay-dark)` / `var(--overlay-heavy)` / `var(--overlay-light)`
14. **1 处 `rgba(255,255,255,0.3)`** → `var(--ripple-color)`
15. **20 处 font-size px** → `var(--text-xxs)` / `var(--text-xs)` / `var(--text-base)` / `var(--text-lg)`
16. **1 处 transition** → `var(--ease-normal)`

### misc.css 硬编码值清理
17. **error/warning rgba** → `var(--error-surface)` / `var(--error-hover-border)` / `var(--warning-surface)` / `var(--warning-bg)`
18. **品牌色 rgba** → `var(--brand-overlay)`

### settings.css / services.css 阴影修复
19. **settings.css** — 2 处 `rgba(124,111,255,0.3)` → `var(--brand-shadow-base)`
20. **services.css** — `rgba(0,0,0,0.15)` → `var(--shadow-sm)`

### page-header 一致性修复
21. **agents.css** — `border-bottom: var(--aether-border-soft)` → `var(--aether-border)`
22. **glossary.css** — `margin-bottom: var(--space-lg)` → `var(--space-5)`

### dashboard.css 圆角修复
23. **.quick-actions .btn** — `border-radius: var(--radius-lg)` → `var(--radius-md)` (与共享 .btn 一致)

### JS 内联样式修复
24. **assistant.js** — 4 处 font-size/border-radius px → CSS 变量
25. **models.js** — 1 处 font-size/border-radius px → CSS 变量
26. **ciao-bug-warning.js** — 4 处 font-size/margin/padding px → CSS 变量

## 修改文件清单

| 文件 | 修改项数 |
|------|----------|
| src/style/pages/polish.css | 11 |
| src/style/chat.css | 37 |
| src/style/pages/misc.css | 6 |
| src/style/pages/settings.css | 2 |
| src/style/pages/services.css | 1 |
| src/style/pages/dashboard.css | 1 |
| src/style/agents.css | 1 |
| src/style/pages/glossary.css | 1 |
| src/pages/assistant.js | 4 |
| src/pages/channels.js | 1 |
| src/pages/models.js | 1 |
| src/lib/ciao-bug-warning.js | 4 |
| **合计** | **13 个文件，74 项修改** |

## 未修复（后续建议）

| 优先级 | 问题 | 原因 |
|--------|------|------|
| P2 | hermes.css 949 处硬编码值 | 引擎专属样式，需独立专项处理 |
| P2 | xintian.css 218 处硬编码值 | 引擎专属样式，需独立专项处理 |
| P2 | assistant.css 300 处硬编码间距 | 数量庞大，需逐个验证映射 |
| P3 | toolbar 类名命名不一致 | 代码质量问题，不影响视觉 |
| P3 | 46 处 !important | 需逐个分析是否必要 |
| P3 | models-page-header 自定义类 | 需同步修改 JS 和 CSS |

## 构建验证

```
✓ built in 3.05s — 所有修改编译通过
```
