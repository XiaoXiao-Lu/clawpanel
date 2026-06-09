export const DOCKER_TASK_TIMEOUT_MS = 10 * 60 * 1000

function normalizeDockerId(value, label) {
  const id = String(value || '').trim()
  if (!id) throw new Error(`${label} is required`)
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`${label} contains invalid characters`)
  return id
}

function normalizeDockerPort(value, label) {
  const raw = String(value ?? '').trim()
  const port = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a valid TCP port`)
  }
  return port
}

export function buildDockerDispatchTargets(containers = []) {
  return containers.map(container => ({
    containerId: container.id,
    containerName: container.name,
    nodeId: container.nodeId,
  }))
}

export function buildDockerInstanceSwitchContext(container = {}) {
  const containerId = normalizeDockerId(container.containerId || container.id, 'container ID')
  const port = normalizeDockerPort(container.port, 'panel port')
  const gatewayPort = normalizeDockerPort(container.gatewayPort, 'Gateway port')
  const instanceId = `docker-${containerId.slice(0, 12)}`

  return {
    instanceId,
    reloadRoute: true,
    registration: {
      name: container.name,
      type: 'docker',
      endpoint: `http://127.0.0.1:${port}`,
      gatewayPort,
      containerId,
      nodeId: container.nodeId,
      note: 'Added from Docker page',
    },
  }
}
