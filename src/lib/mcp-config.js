function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value
  return JSON.parse(JSON.stringify(value))
}

function getServerContainer(mcpConfig) {
  if (!isPlainObject(mcpConfig)) {
    return { wrapperKey: 'mcpServers', servers: {}, topLevel: false, serverIds: [] }
  }
  if (isPlainObject(mcpConfig.mcpServers)) {
    return {
      wrapperKey: 'mcpServers',
      servers: mcpConfig.mcpServers,
      topLevel: false,
      serverIds: Object.keys(mcpConfig.mcpServers),
    }
  }
  if (isPlainObject(mcpConfig.servers)) {
    return {
      wrapperKey: 'servers',
      servers: mcpConfig.servers,
      topLevel: false,
      serverIds: Object.keys(mcpConfig.servers),
    }
  }
  const servers = {}
  for (const [key, value] of Object.entries(mcpConfig)) {
    if (isPlainObject(value)) servers[key] = value
  }
  return { wrapperKey: null, servers, topLevel: true, serverIds: Object.keys(servers) }
}

function classifyTransport(server) {
  if (!isPlainObject(server)) return 'unknown'
  if (typeof server.command === 'string' && server.command.trim()) return 'stdio'
  if (typeof server.url === 'string' && server.url.trim()) return 'http'
  if (typeof server.type === 'string' && server.type.trim()) return server.type.trim()
  if (typeof server.transport === 'string' && server.transport.trim()) return server.transport.trim()
  return 'unknown'
}

function countSecretKeys(obj) {
  if (!isPlainObject(obj)) return 0
  return Object.keys(obj).filter(key => /token|secret|password|api[_-]?key|authorization|bearer/i.test(key)).length
}

export function getMcpServerMap(mcpConfig) {
  return getServerContainer(mcpConfig).servers
}

export function countMcpServers(mcpConfig) {
  return Object.keys(getMcpServerMap(mcpConfig)).length
}

export function validateMcpServer(id, server) {
  const issues = []
  const warnings = []
  const normalizedId = String(id || '').trim()
  if (!normalizedId) issues.push('missing_id')
  else if (!/^[A-Za-z0-9_.-]+$/.test(normalizedId)) issues.push('invalid_id')
  if (!isPlainObject(server)) {
    issues.push('invalid_server')
    return { issues, warnings }
  }

  const transport = classifyTransport(server)
  if (transport === 'stdio') {
    const command = typeof server.command === 'string' ? server.command.trim() : ''
    if (!command) issues.push('missing_command')
    if (server.args != null && !Array.isArray(server.args)) issues.push('invalid_args')
    if (server.cwd != null && typeof server.cwd !== 'string') issues.push('invalid_cwd')
  } else if (transport === 'http') {
    const serverUrl = typeof server.url === 'string' ? server.url.trim() : ''
    if (!serverUrl) issues.push('missing_url')
    else {
      try {
        const url = new URL(serverUrl)
        if (!['http:', 'https:'].includes(url.protocol)) warnings.push('non_http_url')
      } catch {
        issues.push('invalid_url')
      }
    }
    if (server.headers != null && !isPlainObject(server.headers)) issues.push('invalid_headers')
  } else {
    issues.push('unknown_transport')
  }

  if (server.env != null && !isPlainObject(server.env)) issues.push('invalid_env')
  if (server.timeout != null && (!Number.isFinite(Number(server.timeout)) || Number(server.timeout) <= 0)) {
    issues.push('invalid_timeout')
  }
  if (countSecretKeys(server.env) || countSecretKeys(server.headers)) warnings.push('secret_fields')
  return { issues, warnings }
}

export function normalizeMcpServers(mcpConfig) {
  const container = getServerContainer(mcpConfig)
  return Object.entries(container.servers).map(([id, raw]) => {
    const server = isPlainObject(raw) ? raw : {}
    const transport = classifyTransport(server)
    const validation = validateMcpServer(id, server)
    const disabled = server.disabled === true || server.enabled === false
    const status = disabled
      ? 'disabled'
      : validation.issues.length
        ? 'error'
        : validation.warnings.length
          ? 'warn'
          : 'ok'
    return {
      id,
      raw: cloneJson(server),
      transport,
      disabled,
      status,
      issues: validation.issues,
      warnings: validation.warnings,
      command: typeof server.command === 'string' ? server.command : '',
      url: typeof server.url === 'string' ? server.url : '',
      argsCount: Array.isArray(server.args) ? server.args.length : 0,
      envCount: isPlainObject(server.env) ? Object.keys(server.env).length : 0,
      headerCount: isPlainObject(server.headers) ? Object.keys(server.headers).length : 0,
      secretCount: countSecretKeys(server.env) + countSecretKeys(server.headers),
      description: typeof server.description === 'string' ? server.description : '',
    }
  })
}

export function summarizeMcpConfig(mcpConfig) {
  const servers = normalizeMcpServers(mcpConfig)
  return {
    total: servers.length,
    enabled: servers.filter(s => !s.disabled).length,
    disabled: servers.filter(s => s.disabled).length,
    stdio: servers.filter(s => s.transport === 'stdio').length,
    http: servers.filter(s => s.transport === 'http').length,
    needsReview: servers.filter(s => s.status === 'error' || s.status === 'warn').length,
    secrets: servers.reduce((sum, s) => sum + s.secretCount, 0),
  }
}

export function getMcpConfigShape(mcpConfig) {
  const container = getServerContainer(mcpConfig)
  return {
    wrapperKey: container.wrapperKey,
    topLevel: container.topLevel,
    serverIds: [...container.serverIds],
  }
}

export function buildMcpConfigWithServers(baseConfig, serverEntries, shape = null) {
  const detected = shape || getMcpConfigShape(baseConfig)
  const next = isPlainObject(baseConfig) ? cloneJson(baseConfig) : {}
  const servers = {}

  for (const entry of serverEntries || []) {
    const id = String(entry?.id || '').trim()
    if (!id) continue
    const raw = isPlainObject(entry.raw) ? cloneJson(entry.raw) : {}
    servers[id] = raw
  }

  if (detected.topLevel) {
    for (const id of detected.serverIds || []) delete next[id]
    Object.assign(next, servers)
    return next
  }

  next[detected.wrapperKey || 'mcpServers'] = servers
  return next
}
