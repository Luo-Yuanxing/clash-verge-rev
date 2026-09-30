/** Folds an endpoint into one comparable key; IPv6 brackets stay irrelevant here. */
export const endpointKey = (address: string, port: number) =>
  `${address}:${port}`.toLowerCase()

export const systemConnectionId = (item: ISystemConnectionsItem) =>
  `sys:${item.protocol}:${item.localAddress}:${item.localPort}:${item.remoteAddress}:${item.remotePort}:${item.pid}`

const metadataFromSystem = (item: ISystemConnectionsItem) => ({
  network: item.protocol,
  type: item.protocol,
  host: '',
  sourceIP: item.localAddress,
  sourcePort: String(item.localPort),
  destinationPort: item.remotePort > 0 ? String(item.remotePort) : '',
  destinationIP: item.remotePort > 0 ? item.remoteAddress : '',
  remoteDestination: item.remotePort > 0 ? item.remoteAddress : '',
  process: item.process || String(item.pid),
  processPath: '',
})

/**
 * Maps OS socket rows onto the connection shape the page already renders.
 *
 * A row counts as core-routed when the core holds an outbound connection to the same
 * remote endpoint and the local ports agree, or when the core itself owns the row.
 * Without that agreement the row is a direct connection that bypasses the core.
 */
export const mapSystemConnections = (
  items: ISystemConnectionsItem[],
  coreConnections: IConnectionsItem[],
): IConnectionsItem[] => {
  const coreByEndpoint = new Map<
    string,
    { item: IConnectionsItem; localPorts: Set<string> }
  >()

  for (const core of coreConnections) {
    const { destinationIP, remoteDestination, destinationPort, sourcePort } =
      core.metadata
    const address = destinationIP || remoteDestination
    if (!address || !destinationPort) continue

    const key = endpointKey(address, Number(destinationPort))
    const entry = coreByEndpoint.get(key)
    if (entry) {
      entry.localPorts.add(sourcePort)
    } else {
      coreByEndpoint.set(key, { item: core, localPorts: new Set([sourcePort]) })
    }
  }

  return items.map((item) => {
    const core =
      item.remotePort > 0
        ? coreByEndpoint.get(endpointKey(item.remoteAddress, item.remotePort))
        : undefined
    const routed =
      core !== undefined &&
      (core.localPorts.has(String(item.localPort)) ||
        core.item.metadata.process === item.process)

    return {
      id: systemConnectionId(item),
      metadata: metadataFromSystem(item),
      upload: 0,
      download: 0,
      curUpload: 0,
      curDownload: 0,
      start: '',
      chains: routed ? ['CORE'] : [],
      rule: routed ? core.item.rule : '',
      rulePayload: routed ? core.item.rulePayload : '',
    } satisfies IConnectionsItem
  })
}
