# UI Refactor Coverage

This checklist tracks the visual surfaces that must remain available while the
prototype styling is moved into the live app. The prototype is treated as a
design reference, not as a second implementation.

## OpenClaw Shell

- App shell: desktop titlebar, sidebar, mobile topbar, Gateway banner, update banner.
- Sidebar: engine switcher, feature-gated navigation, kernel upgrade hint, language switcher, theme toggle, collapsed and mobile states.
- Qingchen assistant / global AI helper: keep the assistant entry, floating drawer, registered page contexts, and all existing assistant workflows even when they are absent from the prototype.
- Shared surfaces: page header, cards, stat cards, tables/lists, tabs, forms, option cards, modals, toasts, loading placeholders, empty states.

## OpenClaw Pages

- Dashboard: command center health ring, stat cards, onboarding, quick actions, overview cards, WebSocket status, connected channels, session status, recent logs.
- Assistant: model status, model switcher, prompt/soul/skills sections, helper panels.
- Chat: session list, message stream, model selector, hosted agent panel, file cards, markdown/table rendering.
- Route Map: route visualization and command navigation.
- Services: service status cards, start/stop/restart controls, cleanup and diagnostics flows.
- Logs: log source controls, filters, live/log viewer states.
- Models: provider/model console, presets, overrides, cache and vision indicators.
- Agents and Agent Detail: agent grid/detail, bindings, workspace and hosted-agent controls.
- Gateway: port, access scope, auth token/password, tool permission profile, session visibility, Tailscale advanced settings, save/reload bar.
- Channels: configured channels, multi-account cards, runtime badges/actions, available channel catalog, agent bindings, verification and plugin install modals.
- Communication and Notifications: messaging/push configuration surfaces.
- Security: access password and app security settings.
- Memory, Dreaming, Cron, Usage: data summaries, charts, tables, runtime controls, history lists.
- Skills, Connectors, Plugin Hub: marketplace/store, installed status, dependency health, previews, install/remove flows.
- Settings, Chat Debug, Diagnose, Glossary, About, Setup, Engine Select.

## Hermes Pages

- Setup, dashboard, chat, group chat, sessions, logs, usage.
- Skills, memory, cron, profiles, gateways, channels, kanban, OAuth, files, lazy deps, extensions, services, config, env editor.

## Verification

- Run focused UI tests after each pass.
- Run the full Node test suite for route/config coverage.
- Run `npm run build` before handoff.
