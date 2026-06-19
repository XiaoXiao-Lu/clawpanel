# ChatCraw 项目问题分析报告

**项目**: ClawPanel - Claude Code 可视化管理面板  
**分析日期**: 2026-06-12  
**分析范围**: 前端 JS、CSS、核心功能完整性

---

## 一、项目概览

| 指标 | 数值 |
|------|------|
| 前端 JS 文件 | 30 pages + 13 components + 36 lib modules |
| CSS 文件 | 14 主样式 + 8 pages 样式 |
| 测试文件 | 60+ 个 hermes 配置测试 |
| 技术栈 | Tauri v2 + Vite + Vanilla JS |

---

## 二、发现的问题

### P2: Expert Teams 键盘可访问性 Bug (中等)

**位置**: `src/pages/expert-teams.js:263`

**问题描述**: 成员拖拽排序的键盘移动逻辑存在冗余条件，总是返回相同的行索引。

```javascript
// 当前代码（有 bug）
const movedRow = e.key === 'ArrowUp' ? selectedRows[currentIndex] : selectedRows[currentIndex]
```

无论按上还是下箭头，都返回 `currentIndex`，应该返回移动后的目标行 `targetIndex`。

**影响**: 
- 键盘用户按方向键移动成员后，焦点不会正确聚焦到移动后的行
- 视觉反馈 `is-keyboard-moving` 会应用到错误的元素

**修复方案**:
```javascript
const movedRow = selectedRows[targetIndex]
```

---

### P2: CSS 变量别名一致性（已兼容）

**观察**: `variables.css` 已定义完整的向后兼容变量别名：

```css
--text-1:           var(--text-primary);
--text-3:           var(--text-tertiary);
--border-1:         var(--aether-border);
--border-2:         var(--aether-border-soft);
--bg-primary:       var(--aether-base);
--bg-secondary:     var(--aether-elevated);
--bg-tertiary:      var(--aether-raised);
--brand:            var(--aether-primary);
```

**结论**: 变量系统设计合理，向后兼容良好，无需修改。

---

### P3: 成员选择器空状态

**位置**: `src/pages/expert-teams.js`

**问题描述**: 当没有可用专家时，成员选择器没有友好的空状态提示。

**建议**: 添加空状态 UI：
```javascript
if (state.experts.length === 0) {
  return `<div class="expert-teams-empty">
    <strong>${t('expertTeams.noExpertsAvailable')}</strong>
    <span>${t('expertTeams.noExpertsHint')}</span>
  </div>`
}
```

---

## 三、安全性评估

### ✅ 良好实践

1. **XSS 防护**: `markdown.js` 使用 DOMPurify 进行内容消毒
2. **输入转义**: 所有用户输入通过 `escapeHtml()` / `escapeAttr()` 转义
3. **无内联事件处理**: 未发现 `onclick=` / `onerror=` 等危险模式
4. **无敏感数据泄露**: 未发现 localStorage/cookie 中的敏感信息暴露

### ⚠️ 建议改进

1. **ALLOWED_ATTR 白名单**: `markdown.js:256` 的属性白名单较宽松，建议移除非必要的 `data-*` 属性：
   ```javascript
   ALLOWED_ATTR: ['class','type','disabled','checked','href','target','rel','src','alt','loading'],
   ```

---

## 四、代码质量观察

### 优点

1. **模块化设计**: 清晰的页面/组件/库分离
2. **i18n 支持**: 完整的国际化框架
3. **错误处理**: 关键操作都有 try-catch 和 toast 反馈
4. **无 console.log**: 生产代码中没有调试输出

### 可优化点

1. **expert-teams.js:814**: 动态构建 HTML 字符串时直接拼接数据，可考虑使用模板函数
2. **部分函数较长**: 建议拆分超过 200 行的函数

---

## 五、功能完整性

### Expert Teams 功能清单

| 功能 | 状态 |
|------|------|
| 专家列表展示 | ✅ |
| 专家搜索过滤 | ✅ |
| 专家增删改查 | ✅ |
| 团队模板选择器 | ✅ |
| 成员拖拽排序（鼠标） | ✅ |
| 成员键盘排序（方向键） | ⚠️ 有 bug |
| 成员勾选与顺序控制 | ✅ |
| 工具/技能标签选择器 | ✅ |
| Tab 切换键盘可访问性 | ✅ |
| 焦点管理与恢复 | ✅ |

---

## 六、修复优先级建议

| 优先级 | 问题 | 工作量 |
|--------|------|--------|
| P2 | 键盘移动 bug 修复 | 1 行 |
| P3 | 成员选择器空状态 | 中等 |
| P3 | markdown 属性白名单收紧 | 1 行 |

---

## 七、测试建议

1. 运行现有测试套件：`npm test`
2. 手动测试 Expert Teams 键盘排序
3. 验证构建：`npm run build`

---

*报告生成时间: 2026-06-12*