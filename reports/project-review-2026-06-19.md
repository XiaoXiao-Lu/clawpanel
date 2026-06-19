# ClawPanel 项目全面审查报告

> 审查日期：2026-06-19  
> 审查范围：CSS 一致性 / JS 代码质量 / 主题系统 / 性能 / 可访问性  
> 审查方法：3 个并行子代理扫描全部 CSS (25 文件) 和 JS (96 文件)

---

## 一、P0 严重问题（建议立即修复）

### 1. 组件级浅色主题未生效（与 variables.css 同类架构缺陷）

**文件**：`src/style/chat.css:2410-2732`、`src/style/assistant.css:5679-6004`

**问题**：chat.css 有 ~322 行、assistant.css 有 ~325 行组件级浅色覆盖规则，都包裹在 `@media (prefers-color-scheme: light)` 中。当用户系统是深色模式但手动切到浅色主题时，这些规则**不生效**，导致聊天页面和助手页面的组件回退到深色默认样式。

**影响**：聊天输入框、消息区、气泡、侧栏、助手页面等 ~647 行组件在 explicit-light 下显示异常。

**修复方案**：将 `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) ... }` 改为同时匹配 explicit light，例如：
```css
/* 方案：脱离媒体查询，改用属性选择器 */
:root:not([data-theme="dark"]) .chat-input { ... }
```
或添加 `[data-theme="light"]` 选择器组。

---

### 2. `--aether-ground` 变量完全未定义

**文件**：`src/style/pages/polish.css`（8 处使用）

**问题**：`--aether-ground` 在整个代码库中**从未被定义**（`:root`、light、dark 均无），但在 polish.css 中被 8 处引用，用于骨架屏背景、标签底色、徽章背景等。

**影响**：所有引用该变量的元素背景回退为 `transparent`，骨架屏加载动画完全不可见。

**修复方案**：在 `:root`、light 块、dark 块中补充定义：
```css
:root { --aether-ground: var(--aether-sunken); }
/* light */ --aether-ground: #EEEEF3;
/* dark */  --aether-ground: #0A0A14;
```

---

### 3. XSS 漏洞（5 处）

| 文件 | 行号 | 问题 |
|------|------|------|
| `src/pages/chat.js` | 3331 | lightbox `src` 变量未转义直接插入 innerHTML |
| `src/pages/assistant.js` | 7329 | `selectedModel` 未转义插入 innerHTML |
| `src/pages/setup.js` | 796, 828, 920 | `t()` 函数不做 HTML 转义，错误消息直接插入 |
| `src/engines/hermes/pages/setup.js` | 609 | `msg` 来自 `err.message`，未转义 |
| `src/engines/hermes/pages/setup.js` | 365 | `preset.name` 未转义 |

**修复方案**：统一使用 `escapeHtml()` / `escapeAttr()` 函数，或改用 DOM API 属性赋值。

---

### 4. 事件监听器泄漏（600+ vs 51）

**全局统计**：addEventListener ~600 处，removeEventListener ~51 处，比率约 12:1。

**最严重文件**：

| 文件 | add | remove | 差值 |
|------|:---:|:---:|:---:|
| `assistant.js` | 80 | 4 | **76** |
| `chat.js` | 57 | 3 | **54** |
| `hermes/chat.js` | 52 | 4 | **48** |
| `hermes/config.js` | 46 | 0 | **46** |
| `channels.js` | 29 | 0 | **29** |
| `main.js` | 24 | 0 | **24** |

**P0 泄漏**：`document`/`window` 级监听器永久泄漏（10 处），涉及 main.js、sidebar.js、markdown.js、command-palette.js 等。

**修复方案**：引入 `AbortController` 模式，页面 cleanup 时统一 abort。

---

### 5. 巨型文件需拆分

| 文件 | 行数 |
|------|------|
| `src/pages/assistant.js` | **9,542** |
| `src/engines/hermes/pages/config.js` | **5,221** |
| `src/pages/chat.js` | **4,124** |
| `src/pages/channels.js` | 3,113 |
| `src/pages/models.js` | 2,660 |

`assistant.js` 接近 1 万行，极度需要拆分为 settings/messages/experts/commands 等子模块。

---

## 二、P1 高优先级问题

### 6. ~40 处 `color: white` 硬编码

应替换为 `var(--text-inverse)`，分布在 chat.css(7)、components.css(2)、layout.css(8)、polish.css(7)、settings.css(6)、assistant.css(2) 等 16 个文件。

### 7. 代码高亮色未适配浅色主题

`--hl-keyword/string/comment/number/func/type/variable` 7 个变量在 `:root` 中定义（深色优化值），但 light 块未覆盖。`--hl-comment: #52526E` 在浅灰背景上几乎不可读，`--hl-string: #86EFAC`（浅绿）在白色上对比度极低。

### 8. 4 个主色 rgba 变量未在 light 覆盖

| 变量 | `:root` 值 | 问题 |
|------|-----------|------|
| `--aether-border-focus` | `rgba(124, 111, 255, 0.4)` | light 下 primary 变为 `#5B4EE8` 但此值未更新 |
| `--selection-bg` | `rgba(124, 111, 255, 0.35)` | 同上 |
| `--sidebar-hover` | `rgba(124, 111, 255, 0.06)` | 同上 |
| `--sidebar-active` | `rgba(124, 111, 255, 0.10)` | 同上 |

### 9. Hermes 引擎 80+ 处硬编码 hex 颜色

`hermes.css` 中虽有 `--hm-*` 变量定义，但实际 CSS 规则中大量直接使用 hex 值（如 `color: #1C1917` 而非 `var(--hm-text-primary)`），影响主题切换一致性。

### 10. 46 处 `!important`

其中 15 处为可重构的非动画类，涉及 layout.css(8)、expert-teams.css(5)、misc.css(4)、models.css(2) 等。

### 11. 113 处 `transition: all`

性能问题：`transition: all` 会监听所有属性变化，触发不必要的重排。chat.css 30 处最严重。hermes.css 有 9 处同时使用硬编码 `0.15s ease`。

### 12. 重复 @keyframes 定义

| 动画名 | 重复定义位置 |
|--------|-------------|
| `modalIn` | variables.css + components.css + site-message-center.css（三重） |
| `btn-spin` | chat.css + components.css |
| `skillsShimmer` | polish.css + settings.css |
| `skillsFadeSlideIn` | polish.css + settings.css |

### 13. `main.js` 6 处 console.log

生产代码中直接调用 `console.log`，输出 WebSocket 地址、实例名称等内部状态。

### 14. 可访问性 — div onclick 缺少键盘支持

| 文件 | 位置 | 问题 |
|------|------|------|
| `communication.js:41` | 标签页 | `<div>` + onclick，无 role/tabindex/键盘事件 |
| `logs.js:54` | 标签页 | 同上 |
| `chat.js:1565,1611,2042` | 会话列表/命令面板 | 事件委托 div 缺少键盘可访问性 |

---

## 三、P2 中等优先级问题

### 15. z-index 硬编码

| 文件 | 行号 | 值 | 说明 |
|------|------|-----|------|
| `polish.css` | 1014 | `9200` | 超出 `--z-max`(1000) |
| `hermes.css` | 6292 | `10000` | 同上 |
| `polish.css` | 1029 | `80` | 应使用变量 |
| `settings.css` | 420,425 | `1, 2` | 应使用变量 |

### 16. 缺少 `color-scheme` CSS 属性

未在 `:root` 声明 `color-scheme: light dark`，原生表单控件/滚动条不随主题自适应。

### 17. ~50+ 处导航图标色未在 light 覆盖

`--nav-assistant/chat/route-map/services/logs/models/agents/gateway/channels/memory` 等 16 个导航图标色仅在 `:root` 定义（深色优化值），light 块只覆盖了 `--nav-settings/debug/diagnose/about`。

### 18. JS 内联硬编码样式

- `gateway-ownership.js`：~40 处硬编码 px/font-size/border-radius
- `sidebar.js:353-358`：骨架屏硬编码 `32px/200px/28px/24px`
- `hermes/dashboard.js`：~30 处硬编码骨架屏尺寸

### 19. Hermes CSS 回退值与实际变量值不一致

| 变量 | 实际值 | 回退值 |
|------|--------|--------|
| `--hm-surface-0` | `#FAFAF9` | `#FFFCF5` |
| `--hm-border` | `rgba(28,25,23,0.08)` | `#E5E0D0` |

---

## 四、统计汇总

| 类别 | P0 | P1 | P2 | 合计 |
|------|:--:|:--:|:--:|:----:|
| 主题一致性 | 3 | 3 | 2 | 8 |
| XSS 安全 | 5 | 3 | 0 | 8 |
| 内存泄漏 | 1 | 1 | 0 | 2 |
| 可访问性 | 0 | 4 | 2 | 6 |
| 大文件 | 3 | 2 | 1 | 6 |
| CSS 质量 | 0 | 4 | 3 | 7 |
| JS 质量 | 0 | 1 | 3 | 4 |
| **合计** | **12** | **18** | **11** | **41** |

---

## 五、建议修复顺序

### 第一批（P0，立即）
1. **chat.css / assistant.css 组件级浅色主题** — 脱离 `@media` 查询
2. **`--aether-ground` 变量定义** — 3 个主题块各加一行
3. **XSS 漏洞** — 5 处 innerHTML 补 escapeHtml
4. **main.js console.log** — 改用 devLog 或移除

### 第二批（P0-P1，近期）
5. 代码高亮色 light 适配（7 个 `--hl-*` 变量）
6. 4 个主色 rgba 变量 light 覆盖
7. `color: white` → `var(--text-inverse)`（~40 处）
8. `color-scheme` 声明 + 16 个导航图标色 light 覆盖

### 第三批（P1，计划）
9. 事件监听器清理（AbortController 模式）
10. 重复 @keyframes 合并
11. `transition: all` 逐步替换为具体属性
12. assistant.js / config.js 大文件拆分

### 第四批（P2，有空再做）
13. hermes.css 硬编码 hex → 变量（80+ 处）
14. `!important` 重构（15 处）
15. z-index 变量化
16. JS 内联样式变量化
