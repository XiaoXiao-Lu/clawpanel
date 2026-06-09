# ClawPanel 项目记忆

## 项目概况
- **名称**: ClawPanel
- **版本**: 0.17.0
- **类型**: Tauri v2 跨平台桌面应用（AI Agent 管理面板）
- **技术栈**: 原生 JavaScript + CSS + Tauri v2
- **设计系统**: Precision Noir（暖色深色主题）

## 设计系统关键点
- **主色调**: Electric Indigo (#818cf8) + Warm Amber (#f59e0b)
- **背景色系**: 暖色深色（#0A0A14 到 #1A1A30）
- **字体**: PingFang SC（主要） + JetBrains Mono（代码）
- **命名约定**: 使用 `--brand-*` 命名品牌色，避免使用 `--accent-*` 和 `--primary-*`
- **圆角层级**: 6→8→12→16→20px（sm/md/lg/xl/2xl）

## 已知 UI 问题（2026-06-09 分析）
1. **CSS 变量命名不一致**: 混用新旧命名约定 — ⚠️ 已添加 deprecated 注释，待逐步迁移
2. **间距系统混乱**: 数字和语义两种命名容易混淆
3. **表单可访问性差**: 大量输入框缺少标签关联 — ✅ 已为 15+ 组件添加 focus-visible
4. **模态框焦点管理不完整**: showModal() 缺少焦点陷阱 — ✅ engagement.js 已修复
5. **响应式断点不完整**: 缺少 768px-1024px 平板适配 — ✅ 已新增 tablet 断点
6. **颜色对比度不足**: 部分文本颜色低于 WCAG AA 标准 — ✅ 已提升 text-2/text-3 对比度
7. **未定义 CSS 变量**: --success-border 等 15+ 变量被引用但未定义 — ✅ 已添加
8. **Badge 类冲突**: agents.css 与 components.css 定义冲突 — ✅ 已限定作用域
9. **导航图标硬编码颜色**: 4 个导航项颜色未使用变量 — ✅ 已替换
10. **status-dot 硬编码颜色**: chat.css 使用硬编码十六进制 — ✅ 已替换为语义变量
11. **重复选择器**: layout.css .nav-section、dashboard.css .quick-actions/.dashboard-log-viewer、models.css model-row-highlight — ✅ 已合并/删除
12. **channels.css toggle-switch 冲突**: 与 components.css 重复定义 — ✅ 已删除 channels.css 版本
13. **agents.css 30+ 处硬编码颜色**: #2dd4bf/#22c55e/#f59e0b/#ef4444 等 — ✅ 新增 agent 状态变量并替换
14. **chat.css 17 处硬编码过渡时间**: 0.2s/0.18s/0.15s 等 — ✅ 统一为 var(--ease-fast)
15. **响应式断点不一致**: 760px vs 768px — ✅ 统一为 768px
16. **variables.css 缺失变量**: --topbar-height/--z-titlebar/--toast-duration 等 10 个 — ✅ 已添加
17. **layout.css z-index:100000 硬编码** — ✅ 已替换为 var(--z-titlebar)
18. **assistant.css 28 处硬编码 font-size** — ✅ 已替换为 var(--text-xxs/xs/base)
19. **assistant.css 12 处硬编码颜色** — ✅ 已替换为 var(--text-inverse/brand/muted)
20. **assistant.css 8 处硬编码过渡时间** — ✅ 已替换为 var(--transition-*)
21. **engagement.js 模态框缺少可访问性** — ✅ 已添加 ARIA/focus trap/Escape
22. **3 个页面 max-width 不一致** — ✅ 已统一为 1400px
23. **about.css 无响应式** — ✅ 已添加 768px 断点
24. **XSS 安全漏洞**: 9 个 JS 文件 catch 块错误信息未转义 — ✅ 已添加 escapeHtml 转义
25. **assistant.css transition: all 残留**: 6 处未修复 — ✅ 已替换为具体属性
26. **Modal min-width 380px 溢出**: 小屏设备弹窗超出视口 — ✅ 已改为 min(380px, calc(100vw-32px))
27. **Chat 搜索面板 min-width 360px 溢出** — ✅ 已改为 min(360px, calc(100vw-32px))
28. **Chat 侧边栏宽度冲突**: 同一 @media 两处声明 — ✅ 已删除重复声明
29. **硬编码 z-index**: 5 处使用 9200/9000/1050/1000 — ✅ 已替换为 CSS 变量
30. **13 个非标响应式断点**: 散布在 11 个文件 — ✅ 已全部收敛为标准断点
31. **JS 内联硬编码颜色**: assistant.js 12 处 + dreaming.js 9 处 — ✅ 已替换为 CSS 变量
32. **variables.css 变量重复定义**: --font-size-md 和 --accent-rgb — ✅ 已移除
33. **chat.css prefers-reduced-motion 重复**: 与 layout.css 相同 — ✅ 已删除
34. **XSS 残留漏洞**: security.js/services.js catch 块 e.message 未转义 — ✅ 已修复
35. **21 处重复 escapeHtml 定义**: 20 个 JS 文件各自定义本地版本 — ✅ 统一从 utils.js 导入
36. **assistant.css 23 处 !important**: 全部移除，通过提高选择器特异性替代
37. **agents.css 61 处硬编码 rgba**: 新增 19 个 CSS 变量，替换 25+ 处（消除率 65%）
38. **13 处图标按钮缺少 aria-label**: modal/assistant/chat/channels — ✅ 已添加
39. **30+ 处 JS 内联硬编码颜色**: main/channels/gateway-ownership 等 — ✅ 已替换为 CSS 变量
40. **variables.css 10+ 个未使用变量**: --brand-500/--accent-warm 等 — ✅ 已清理

## 开发规范
- **文件路径**: 所有文件使用绝对路径
- **CSS 组织**: variables.css → reset.css → layout.css → components.css → pages/*.css
- **组件命名**: 使用 BEM-like 命名（如 `.sidebar-header`、`.nav-item`）
- **动画**: 优先使用 CSS 过渡，避免复杂 JavaScript 动画
- **可访问性**: 所有交互元素必须有焦点状态，表单必须有标签

## 最近修改
- 2026-06-09: 深度 UI 审查第十轮 — 统一 38 处 escapeHtml、agents.css 33 处 rgba 清理、polish.css 拆分、11 处键盘可访问性修复，修改 55 个文件
- 2026-06-09: 深度 UI 审查第九轮 — 修复 2 个 P0 + 3 个 P1 + 3 个 P2 问题，修改 27 个文件
- 2026-06-09: 生成报告 reports/ui-review-2026-06-09-121014.md
- 2026-06-09: 深度 UI 审查第八轮 — 修复 5 个 P0 + 5 个 P1 问题，修改 26 个文件
- 2026-06-09: 生成报告 reports/ui-review-2026-06-09-111233.md
- 2026-06-09: 深度 UI 审查第七轮 — 修复 11 个 P0 + 5 个 P1 问题，修改 21 个文件
- 2026-06-09: 生成报告 reports/ui-review-2026-06-09-094336.md
- 2026-06-09: 深度 UI 审查第六轮 — 修复 4 个 P0 + 5 个 P1 问题，修改 11 个文件（10 CSS + 1 JS）
- 2026-06-09: 深度 UI 审查第五轮 — 修复 6 个 P0 + 5 个 P1 问题，修改 10 个 CSS 文件
- 2026-06-09: 生成报告 reports/ui-review-2026-06-09-074958.md
- 2026-06-09: 深度 UI 审查第四轮 — 修复 6 个 P0 + 4 个 P1 问题，修改 5 个 CSS 文件
- 2026-06-09: 深度 UI 审查第三轮 — 修复 6 个 P0 + 5 个 P1 问题
- 2026-06-09: 深度 UI 审查第二轮 — 修复 5 个 P0 + 12 个 P1 问题
- 2026-06-09: 修复 15 项 UI 问题（Toast 定位、focus-visible 冲突等）
- 2026-06-08: 初始 UI 审查和代码质量检查

## 性能优化记录
- **骨架屏**: 统一使用 `.skeleton` 类，避免重复定义
- **动画性能**: 暗色主题使用 `clip-path` 动画，需注意低端设备性能
- **触摸设备**: 移动端触摸目标最小 44px，需要视觉反馈

## 可访问性改进计划
1. 为所有表单控件添加 `id` 和关联的 `<label>` — ✅ channels.js/modal.js 已添加 for/id 关联
2. 确保模态框焦点陷阱完整 — ✅ engagement.js/ciao-bug-warning.js/floor-blocker.js/command-palette.js/about.js 已添加
3. 提升颜色对比度至 WCAG AA 标准（4.5:1） — ✅ --text-3 已提升至 #9090B0/#6b6b80
4. 添加 `prefers-reduced-motion` 支持验证 — ✅ 已补充 toggle/spinner 组件
5. 图标按钮添加 aria-label — ✅ engagement.js/expert-teams.js close 按钮已添加
6. 自定义交互元素支持键盘操作 — ✅ sidebar.js/sidebar-nav.js 已改为原生 button

## 文件结构关键点
- **CSS 入口**: `src/style/` 目录，按功能组织
- **页面组件**: `src/pages/` 目录，按功能命名
- **工具库**: `src/lib/` 目录，包含核心功能模块
- **国际化**: `src/locales/` 目录，支持 11 种语言

## 下次审查建议
- **时间**: 2026-06-16（一周后）
- **重点**: 验证 P0/P1 问题修复，检查新功能 UI 质量
- **工具**: 继续使用 Anthropic Frontend Design + Code Reviewer 技能

## 待处理高优先级问题
1. **assistant.js 8321 行巨型文件**: 需拆分为 3-5 个子模块（settings/messages/experts/commands）
2. **engines/hermes/pages/config.js 5008 行**: 需要拆分
3. **事件监听器泄漏**: 635 处 addEventListener vs 32 处 removeEventListener，应引入 AbortController 模式
4. **hermes.css 7803 行**: 全项目最大 CSS 文件，需按子页面拆分
5. **50+ 处 DOM innerHTML 全量更新**: 聊天消息等高频更新区域应改用增量更新
6. **100+ 处图标按钮缺少 aria-label**: 需逐步补充（本轮修复 4 个）
7. **50+ 处可点击 div 缺少键盘事件**: 需添加 onkeydown 支持（本轮修复 11 处）

## 图标系统（2026-06-09 审计）

- **集中化图标库**: `src/lib/icons.js` (85个图标) + `src/components/sidebar-icons.js` (24个) + `src/engines/hermes/lib/svg-icons.js` (30个)
- **核心导出函数**: `icon(name, size)` / `statusIcon(type, size)` / `logIcon(name, size)` — 生成统一 SVG (stroke-width:2, fill:none, currentColor)
- **风格**: Lucide/Feather 线性风格
- **已知问题**: 
  - Hermes引擎20+文件各自内联SVG，stroke-width 0.9~2.5 不统一
  - 413+ 处 emoji/unicode 用作UI图标，仅替换了约 22 处
  - 3个图标库（icons.js/svg-icons.js/sidebar-icons.js）功能大量重复
- **修改 history**:
  - 2026-06-09 23:28 — 重设计BOT_ICON + 站内信3图标 + 新增8个图标路径 + about/setup/dashboard去emoji化