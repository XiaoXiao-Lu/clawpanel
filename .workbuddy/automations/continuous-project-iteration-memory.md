# Continuous Project Iteration Memory

## Purpose

This file stores concise state for the half-hourly ClawPanel / ChatCraw continuous improvement automation.

## Standing Instructions

- Use `.workbuddy/automations/continuous-project-iteration-prompt.md` as the source prompt.
- Treat existing dirty worktree changes as user or prior automation work unless proven otherwise.
- Prefer small, independently verifiable iterations.
- Always run `npm test` and `npm run build` unless blocked.
- Add each completed iteration report under `reports/iteration-YYYY-MM-DD-HHMM.md`.
- Keep this memory concise: record what changed, what passed, what remains, and what the next iteration should consider.

## Current Baseline Snapshot

- Project: ClawPanel / ChatCraw
- Stack: Vite 6, native JavaScript modules, Tauri v2, Rust, Node test, Three.js
- Current known validation baseline from 2026-06-09:
  - `npm test`: 489 tests passed
  - `npm run build`: passed
  - Existing Vite warnings: mixed static/dynamic imports prevent some code splitting; large chunks include main index, agent-office scene, assistant, channels, Hermes config

## Latest Iteration

- 2026-06-09T12:17:34+08:00：修复登录覆盖层默认密码回填的属性注入风险。`src/main.js` 现在先用 `escapeHtml(defaultPw)` 生成 `defaultPwValue` 再写入 `<input value>`；新增 `tests/login-overlay-security.test.js` 锁定该安全边界。
- 验证：`node --test tests/login-overlay-security.test.js` 通过 1/1；`npm test` 通过 489/489；`npm run build` 通过。构建仍有既有混合导入和大 chunk 警告。
- 工作区注意：仍有大量既有 UI/CSS/组件未提交改动和未跟踪目录，本轮只新增/修改登录安全相关两处文件，未处理既有大改。

## Known High-Value Areas

- `src/pages/assistant.js`: large and complex assistant surface
- `src-tauri/src/commands/hermes.rs`: very large Rust command module
- `src/engines/hermes/pages/config.js`: very large Hermes config page
- `src/engines/hermes/style/hermes.css`: very large scoped stylesheet
- `src/main.js`: boot/auth/Gateway/WebSocket/engine switching
- `src/router.js`: route loading, module cache, cleanup, error recovery
- UI/interaction/performance: responsive overflow, focus management, reduced motion, chunk splitting, large list rendering

## Next Iteration Suggestions

- Start with current test/build baseline.
- Prefer a small, high-confidence improvement in one of:
  - Vite code-splitting warnings
  - `innerHTML` safety audit in a focused page/component
  - assistant or Hermes config incremental decomposition
  - UI accessibility/keyboard/focus issue with test coverage
  - large chunk lazy-loading opportunity
