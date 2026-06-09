# Agent Office Design

## Goal

Build an "Agent digital office" for the Agents page: a fun, spatial, Three.js based operations view that also works as a real monitoring surface. It should make multi-agent status readable at a glance, while preserving the existing Agent management list and CRUD flows.

## Product Principles

- Fun is a feature, but every animation must map to useful state.
- The 3D scene is read-only in v1; it must not change agent execution, routing, or task dispatch behavior.
- Users should identify active, idle, blocked, and error agents in under three seconds.
- One click on an agent should explain what it is doing, where it works, and how to inspect it further.
- The experience must degrade gracefully on small screens and low-performance machines.

## Current Data Sources

The current codebase can already provide:

- `api.listAgents()`: agent id, display name, model, workspace, runtime.
- `api.readOpenclawConfig()`: bindings and global agent defaults.
- `docker_task_list` in `scripts/dev-api.js`: existing in-memory Docker dispatch task history.
- `api.getAgentDetail(id)`: detailed configuration, workspace, bindings, tools, skills, defaults.

Limitations:

- There is no single authoritative "agent activity" stream yet.
- Most real conversational progress, tool calls, and blocked states are not normalized into a frontend-friendly activity contract.
- The first version should not infer too much from logs. It should show unknown state honestly.

## Target Activity Contract

For production-grade real-time monitoring, add a read-only activity API in a later phase:

```js
{
  agentId: "main",
  state: "idle | queued | walking | working | tool_call | thinking | blocked | error | done | offline",
  taskTitle: "Handle incoming message",
  progressText: "Reading workspace files",
  toolName: "assistant_read_file",
  source: "weixin",
  sessionId: "session-id",
  startedAt: 1780810000000,
  updatedAt: 1780810030000,
  error: null
}
```

Recommended endpoints:

- `list_agent_activity`: current snapshot for all agents.
- `agent_activity_stream`: SSE stream for state updates.

## Scene Design

Use Three.js directly because the project is plain JS/Vite and does not use React.

Office areas:

- Workstations: desk, chair, monitor, status lamp for each agent.
- Lounge: idle agents rest here when no task is active.
- Alert rail: visual emphasis for blocked and error states.
- Overview board: compact global counters.

Agent states:

- `idle`: agent rests in lounge or near its workstation; monitor dim.
- `queued`: agent stands up and prepares to move.
- `walking`: agent moves from lounge to desk.
- `working`: agent sits at workstation; monitor glows; typing animation.
- `tool_call`: workstation screen shows a tool pulse.
- `thinking`: subtle screen wave and slower motion.
- `blocked`: amber lamp and pause pose.
- `error`: red lamp and stopped pose.
- `done`: green completion pulse, then returns to idle.
- `offline`: greyed workstation and translucent agent.

## Interaction

- Click an agent or workstation to select it.
- Selected agent panel shows: name, id, status, model, workspace, bindings, task title, progress text, source, tool, and updated time.
- Detail actions should use existing routes, especially `#/agent-detail?id=...`.
- Hover should show a compact tooltip with name and state.

## Performance

Commercial usability requires predictable performance:

- Use low-poly procedural geometry for v1; avoid heavy GLB assets initially.
- Reuse materials and meshes where possible.
- Use a fixed orthographic camera for an isometric feel.
- Pause rendering when the tab is hidden.
- Lower animation rate when there are no active state changes.
- Keep v1 comfortable for about 50 agents; switch to simplified layout for larger counts.

## Implementation Phases

### Phase 1: Static Office Snapshot

- Add Three.js dependency.
- Add `AgentOfficeScene` component.
- Render workstations and agents from `listAgents()`.
- Show idle/working/error/blocked states from lightweight local state.
- Add selected-agent detail panel.
- Keep the existing list below the scene.

Success criteria:

- `/agents` renders with no console errors.
- Agent count matches the existing agent list.
- Clicking an agent updates the detail panel.
- Existing add/edit/delete/list behavior still works.
- Build and syntax checks pass.

### Phase 2: Activity Snapshot

- Add read-only `list_agent_activity`.
- Aggregate known task data and agent config.
- Connect activity state to office behavior.
- Show recent task and progress where available.

Success criteria:

- Working agents are visually distinct.
- Blocked/error states are explicit.
- Activity data is honest when unavailable.

### Phase 3: Real-Time Activity

- Add `agent_activity_stream`.
- Animate transitions when tasks start, update, complete, or fail.
- Add task wall and alert rail interactions.

Success criteria:

- The scene updates without manual refresh.
- Movement and status changes match runtime events.
- Long-running page sessions remain stable.

### Phase 4: Commercial Polish

- Add branded low-poly assets.
- Add replay timeline and global metrics.
- Add density modes for large teams.
- Add accessibility fallback and reduced-motion support.

Success criteria:

- Demo-ready visual quality.
- Useful for real multi-agent operations.
- Stable on typical laptops.
