export function countMcpServers(mcpConfig) {
  if (!mcpConfig || typeof mcpConfig !== 'object' || Array.isArray(mcpConfig)) return 0
  if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object' && !Array.isArray(mcpConfig.mcpServers)) {
    return Object.keys(mcpConfig.mcpServers).length
  }
  if (mcpConfig.servers && typeof mcpConfig.servers === 'object' && !Array.isArray(mcpConfig.servers)) {
    return Object.keys(mcpConfig.servers).length
  }
  return Object.values(mcpConfig).filter(v => v && typeof v === 'object' && !Array.isArray(v)).length
}
