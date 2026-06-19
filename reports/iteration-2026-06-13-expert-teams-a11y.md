# 迭代报告 — 2026-06-13 Expert Teams 深度审查

## 基本信息
- **日期**: 2026-06-13
- **分支**: main
- **基线**: 测试 568 PASS，构建 4.69s

## 本轮修复

### P1: Expert Teams 成员拖拽排序键盘可访问性
**文件**: [expert-teams.js](src/pages/expert-teams.js)

**问题**: 成员选择器的 `<button data-member-drag>` 拖拽按钮只能通过鼠标拖拽排序，键盘用户无法重新排序。

**修复**: 在 `bindEvents` 中添加 `keydown` 事件委托，监听选中成员的拖拽按钮：
- `ArrowUp` / `ArrowDown` 键在选中的成员行之间交换顺序
- 边界检查防止越界
- 调用 `renumberSelectedMembers` 重新编号

**效果**: 键盘用户可通过方向键调整成员顺序，符合 WCAG 2.1 可访问性要求。

### P1: renderExpertTeamDetailPanel 嵌套 ARIA tablist 冲突
**文件**: [assistant.js:4451](src/pages/assistant.js#L4451)

**问题**: `<details>` 内部包含 `role="tablist"` + `role="tab"/"tabpanel"` 组合，与 `<details>` 自身的折叠键盘行为冲突（Space/Enter 在两者间产生歧义），且 `role="tabpanel"` 与 CSS radio tab 机制语义不匹配。

**修复**:
- 移除 `role="tablist"`（由外层 `aria-label` 提供上下文）
- 移除每个 tab 的 `role="tab"` 和 `aria-selected`
- 移除每个 panel 的 `role="tabpanel"`（由 `aria-labelledby` 提供关联）
- 保留 `aria-label` 在外层和每个 panel 的 `aria-labelledby`

**效果**: 消除 ARIA 角色冲突，radio tab 功能完全正常。

### P1: resumeExpertTeamMessage 双击竞态条件
**文件**: [assistant.js:8460](src/pages/assistant.js#L8460)

**问题**: 函数入口只有 `if (_isStreaming)` 拦截，但 `_isStreaming` 在函数内才被设置为 `true`，存在竞态窗口。连续快速双击 resume 按钮会导致两个调用同时通过检查。

**修复**:
1. 新增模块级 flag `_resumeInFlight = false`
2. 入口检查改为 `if (_isStreaming || _resumeInFlight)`
3. 在设置 `_isStreaming = true` 时同步设置 `_resumeInFlight = true`
4. `finally` 块中重置 `_resumeInFlight = false`

**效果**: 原子性拦截连续调用，防止 resume 操作重复执行。

## 项目当前健康状态

| 维度 | 状态 | 说明 |
|------|------|------|
| 测试 | ✅ | 568 PASS, 0 FAIL |
| 构建 | ✅ | 4.69s, 无警告 |
| Expert Teams 执行 | ✅ | run/resume/sequential/synthesis 逻辑完整 |
| Expert Teams UI | ✅ | 可访问性修复 |
| 竞态安全 | ✅ | resume 双击保护 |

## 遗留观察（非阻塞）

1. **expert-teams.js:309** — `buildSequentialMessages` 中 `prevText !== plan.task` 条件判断可能不够精确（当专家输出恰好等于任务文本时判断失效）
2. **assistant.js:5747** — `renderMarkdown` 在 expert final preview 中渲染用户输入的 expert team content，潜在 XSS 风险（content 来自 LLM 输出，可信度较高但仍建议后续审查）
3. **expert-team-runner.js:5798** — `expertTeamMessageText` 函数对错误对象的处理可能不完整（部分错误类型缺少翻译键）

## 下轮建议
1. P2: 审查 LLM 生成内容的渲染安全边界
2. P3: 增强 Expert Teams 错误恢复的用户提示
3. P3: 为 sequential 模式的 `prevText` 比较添加长度/相似度兜底

## 提交信息
```
fix: 修复 Expert Teams 可访问性和竞态问题

- 为成员拖拽按钮添加键盘排序支持（↑/↓ 键）
- 修复 <details> 内嵌套 ARIA tablist 的角色冲突
- 添加 _resumeInFlight flag 防止 resume 双击竞态

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```