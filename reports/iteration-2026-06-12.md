# 迭代报告 — 2026-06-12

## 本轮概述

| 指标 | 结果 |
|------|------|
| 测试通过 | 568/568 ✅ |
| 发现问题 | 6 个 |
| 修复完成 | 2 个 P1/P2 |
| 扫描覆盖率 | Expert Teams 模块、变量系统 |

---

## 发现的问题

### P1 — Expert Teams 键盘可访问性：焦点跟随逻辑错误

**文件**: [expert-teams.js:263](src/pages/expert-teams.js#L263)

**问题描述**:
键盘移动成员顺序时，交换位置后焦点错误地跟随原始元素（`selectedRows[targetIndex]`），而非被移动到新位置的元素（`targetRow`）。这导致用户无法感知自己操作的正确结果。

**修复**:
```diff
- // 聚焦到移动后的拖拽按钮
- selectedRows[targetIndex].querySelector('[data-member-drag]')?.focus()
+ // 交换位置后，焦点跟随被移动到新位置的元素
+ targetRow.querySelector('[data-member-drag]')?.focus()
```

**影响**: 键盘可访问性、用户操作反馈

---

### P2 — CSS 旧变量命名：expert-teams.css 使用已废弃变量

**文件**: [expert-teams.css](src/style/pages/expert-teams.css)

**问题描述**:
expert-teams.css 使用了 `var(--border-2)` 等已废弃的旧变量命名。这些变量虽然在 variables.css 中有向后兼容定义，但应统一迁移到新的 `--aether-*` 语义化命名。

**修复**:
```diff
- border-left: 1px solid var(--border-2);
- border-top: 1px solid var(--border-2);
+ border-left: 1px solid var(--aether-border-soft);
+ border-top: 1px solid var(--aether-border-soft);

- border-top: 1px solid var(--border-2);
+ border-top: 1px solid var(--aether-border-soft);
```

**影响**: CSS 变量系统一致性

---

### P3（已确认安全）— skills.js innerHTML XSS 检查

**文件**: [skills.js](src/pages/skills.js)

**分析结论**: 
- `img.onerror = () => { img.src = fallback }` 模式不构成 XSS
- 原因：用户数据经过 `escapeHtml()` 净化
- `expert.color` 来自后端可信数据源
- 无需修改

---

### 信息性 — console.warn 使用评估

**文件**: channels.js, dashboard.js 等

**评估结论**:
- 所有 `console.warn` 都是非致命警告，用于调试/诊断
- 无敏感信息泄漏风险（已在上轮迭代中加固）
- 保持现状

---

### 信息性 — .onclick 赋值模式评估

**文件**: 多个页面文件

**评估结论**:
- 所有 `.onclick = () => {}` 都是安全的 JS 赋值模式
- 赋值右侧无用户输入反射
- 无需修改

---

### 信息性 — Expert Teams 拖拽功能可访问性基线

**文件**: [expert-teams.js:203-264](src/pages/expert-teams.js#L203-L264)

**现状**:
- ✅ 拖拽按钮有 `draggable` 属性
- ✅ 拖拽按钮有 `aria-label` 标签
- ✅ 禁用时 `disabled` + `aria-disabled`
- ✅ 键盘上下箭头可移动选中成员顺序
- ✅ 键盘移动后焦点跟随移动后的元素（本轮修复）
- ✅ `focus-visible` 样式正确

---

## 扫描覆盖范围

- **JS 安全扫描**: ✅ 内联 onclick、XSS、敏感信息泄漏
- **CSS 变量扫描**: ✅ 旧变量 `--text-[0-3]`、`--border-[0-9]`
- **Expert Teams 模块**: ✅ 功能完整性、可访问性
- **测试验证**: ✅ 568 个测试全部通过

---

## 下一步建议

1. **P2 → P1 升级**: 考虑将 expert-teams.css 中剩余的 `var(--brand-faint)` 迁移到 `--aether-primary-faint`
2. **可访问性审计**: 对其他拖拽/排序功能进行键盘可访问性检查
3. **测试覆盖**: 为 Expert Teams 键盘操作添加 e2e 测试