/** Folds an endpoint into one comparable key; IPv6 brackets stay irrelevant here. */
export const endpointKey = (address: string, port: number) =>
  `${address}:${port}`.toLowerCase()

/** Whether the row has a peer at all; UDP rows and listeners have none. */
export const hasSystemRemote = (row?: ISystemConnectionsItem) =>
  row !== undefined &&
  row.remotePort > 0 &&
  row.remoteAddress !== '*' &&
  row.remoteAddress !== ''

export const systemConnectionId = (row: ISystemConnectionsItem) =>
  `sys:${row.protocol}:${row.localAddress}:${row.localPort}:${row.remoteAddress}:${row.remotePort}:${row.pid}`

const metadataFromSystem = (row: ISystemConnectionsItem) => {
  const remote = hasSystemRemote(row)
  return {
    network: row.protocol,
    type: row.protocol,
    // The OS table carries no reverse-resolved name, so the peer is the host.
    host: remote ? row.remoteAddress : '',
    sourceIP: row.localAddress,
    sourcePort: String(row.localPort),
    destinationPort: remote ? String(row.remotePort) : '',
    destinationIP: remote ? row.remoteAddress : '',
    remoteDestination: remote ? row.remoteAddress : '',
    process: row.process || String(row.pid),
    processPath: '',
  }
}

/**
 * Maps OS socket rows onto the connection shape the page already renders.
 *
 * The OS row is returned alongside so the detail panel can show socket state and the
 * owning process instead of core-only fields such as rules and traffic.
 *
 * A row counts as core-routed when the core holds an outbound connection to the same
 * remote endpoint and the local ports agree, or when the core itself owns the row.
 * Without that agreement the row is a direct connection that bypasses the core.
 */
export const mapSystemConnections = (
  rows: ISystemConnectionsItem[],
  coreConnections: IConnectionsItem[],
) => {
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

  const rowById = new Map<string, ISystemConnectionsItem>()
  const connections = rows.map((row) => {
    const core = hasSystemRemote(row)
      ? coreByEndpoint.get(endpointKey(row.remoteAddress, row.remotePort))
      : undefined
    const routed =
      core !== undefined &&
      (core.localPorts.has(String(row.localPort)) ||
        core.item.metadata.process === row.process)

    const id = systemConnectionId(row)
    rowById.set(id, row)

    return {
      id,
      metadata: metadataFromSystem(row),
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

  return { connections, rowById }
}
