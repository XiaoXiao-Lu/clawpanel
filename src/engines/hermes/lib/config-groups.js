/**
 * Hermes Configuration Groups — sidebar grouping schema.
 *
 * Defines the 9 configuration groups with their panels. Each panel maps to a
 * section in the config page with a CSS class for scoped styling.
 *
 * Usage:
 *   import { CONFIG_GROUPS, getGroupByPanelId, getGroupById, getAllPanelIds }
 *     from './config-groups.js'
 */

/* eslint-disable max-len */

export const CONFIG_GROUPS = [
  {
    id: 'core-runtime',
    titleKey: 'engine.configGroupCoreRuntime',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    panels: [
      { id: 'runtime', cssClass: 'hm-config-runtime-panel' },
      { id: 'agent-runtime', cssClass: 'hm-config-agent-runtime-panel' },
      { id: 'unauthorized-dm', cssClass: 'hm-config-unauthorized-dm-panel' },
    ],
  },
  {
    id: 'sessions',
    titleKey: 'engine.configGroupSessions',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
    panels: [
      { id: 'sessions-maintenance', cssClass: 'hm-config-sessions-maintenance-panel' },
      { id: 'updates', cssClass: 'hm-config-updates-panel' },
    ],
  },
  {
    id: 'execution',
    titleKey: 'engine.configGroupExecution',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 12 10 17 19 8"/></svg>',
    panels: [
      { id: 'execution-limits', cssClass: 'hm-config-execution-limits-panel' },
      { id: 'io-safety', cssClass: 'hm-config-io-safety-panel' },
      { id: 'streaming', cssClass: 'hm-config-streaming-panel' },
      { id: 'terminal', cssClass: 'hm-config-terminal-panel' },
      { id: 'checkpoints', cssClass: 'hm-config-checkpoints-panel' },
    ],
  },
  {
    id: 'models',
    titleKey: 'engine.configGroupModels',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
    panels: [
      { id: 'model-config', cssClass: 'hm-config-model-panel' },
      { id: 'model-catalog', cssClass: 'hm-config-model-catalog-panel' },
      { id: 'x-search', cssClass: 'hm-config-x-search-panel' },
      { id: 'context-config', cssClass: 'hm-config-context-panel' },
      { id: 'model-aliases', cssClass: 'hm-config-model-aliases-panel' },
    ],
  },
  {
    id: 'tools-skills',
    titleKey: 'engine.configGroupToolsSkills',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
    panels: [
      { id: 'skills-config', cssClass: 'hm-config-skills-config-panel' },
      { id: 'agent-toolsets', cssClass: 'hm-config-agent-toolsets-panel' },
      { id: 'platform-toolsets', cssClass: 'hm-config-platform-toolsets-panel' },
      { id: 'hooks', cssClass: 'hm-config-hooks-panel' },
      { id: 'curator-config', cssClass: 'hm-config-curator-config-panel' },
      { id: 'quick-commands', cssClass: 'hm-config-quick-commands-panel' },
    ],
  },
  {
    id: 'memory-context',
    titleKey: 'engine.configGroupMemoryContext',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    panels: [
      { id: 'memory', cssClass: 'hm-config-memory-panel' },
      { id: 'compression', cssClass: 'hm-config-compression-panel' },
      { id: 'prompt-caching', cssClass: 'hm-config-prompt-caching-panel' },
    ],
  },
  {
    id: 'ui-display',
    titleKey: 'engine.configGroupUiDisplay',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    panels: [
      { id: 'display', cssClass: 'hm-config-display-panel' },
      { id: 'human-delay', cssClass: 'hm-config-human-delay-panel' },
      { id: 'approvals', cssClass: 'hm-config-approvals-panel' },
    ],
  },
  {
    id: 'integrations',
    titleKey: 'engine.configGroupIntegrations',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    panels: [
      { id: 'browser', cssClass: 'hm-config-browser-panel' },
      { id: 'web-config', cssClass: 'hm-config-web-config-panel' },
      { id: 'lsp', cssClass: 'hm-config-lsp-panel' },
      { id: 'stt', cssClass: 'hm-config-stt-panel' },
      { id: 'tts-voice', cssClass: 'hm-config-tts-voice-panel' },
      { id: 'provider-routing', cssClass: 'hm-config-provider-routing-panel' },
      { id: 'openrouter-cache', cssClass: 'hm-config-openrouter-cache-panel' },
      { id: 'auxiliary', cssClass: 'hm-config-auxiliary-panel' },
    ],
  },
  {
    id: 'advanced',
    titleKey: 'engine.configGroupAdvanced',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
    panels: [
      { id: 'security', cssClass: 'hm-config-security-panel' },
      { id: 'privacy', cssClass: 'hm-config-privacy-panel' },
      { id: 'kanban', cssClass: 'hm-config-kanban-panel' },
      { id: 'cron', cssClass: 'hm-config-cron-panel' },
      { id: 'logging', cssClass: 'hm-config-logging-panel' },
      { id: 'tool-guardrails', cssClass: 'hm-config-tool-guardrails-panel' },
      { id: 'mcp-servers', cssClass: 'hm-config-mcp-servers-panel' },
      { id: 'provider-overrides', cssClass: 'hm-config-provider-overrides-panel' },
    ],
  },
]

/**
 * Find the group that contains a given panel id.
 * @param {string} panelId
 * @returns {{ id: string, titleKey: string, icon: string, panels: Array } | undefined}
 */
export function getGroupByPanelId(panelId) {
  return CONFIG_GROUPS.find(g => g.panels.some(p => p.id === panelId))
}

/**
 * Find a group by its id.
 * @param {string} groupId
 * @returns {{ id: string, titleKey: string, icon: string, panels: Array } | undefined}
 */
export function getGroupById(groupId) {
  return CONFIG_GROUPS.find(g => g.id === groupId)
}

/**
 * Return a flat array of all panel ids across all groups.
 * @returns {string[]}
 */
export function getAllPanelIds() {
  /** @type {string[]} */
  const ids = []
  for (const g of CONFIG_GROUPS) {
    for (const p of g.panels) {
      ids.push(p.id)
    }
  }
  return ids
}
