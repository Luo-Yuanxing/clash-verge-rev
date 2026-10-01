import { useMemo, useRef } from 'react'

import type { ConnectionDialFlags } from '@/hooks/use-connection-data'

const TRAFFIC_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

export interface ConnectionRowView {
  id: string
  /** 选择框的稳定 key，见 getConnectionSelectKey */
  selectKey: string
  host: string
  process: string
  network: string
  type: string
  chains: string
  rule: string
  time: string
  source: string
  destination: string
  uploadText: string
  downloadText: string
  uploadSpeedText: string
  downloadSpeedText: string
  upload: number
  download: number
  uploadSpeed: number
  downloadSpeed: number
  startTime: number
  /** The dial failed, so this row never had a live connection */
  failed: boolean
  /** Reason the core printed for the failed dial */
  dialError: string
  searchableHost: string
  searchableDestinationIP: string
  searchableProcess: string
}

/**
 * 失败信息只存在于日志解析出来的历史记录里，内核返回的连接没有这两个字段。
 */
export const getConnectionDialFlags = (
  connection: IConnectionsItem,
): ConnectionDialFlags =>
  connection as IConnectionsItem & ConnectionDialFlags

export const formatConnectionTraffic = (value?: number) => {
  if (typeof value !== 'number') return 'NaN'

  const exp =
    value < 1
      ? 0
      : Math.min(Math.floor(Math.log2(value) / 10), TRAFFIC_UNITS.length - 1)
  const data = value / 1024 ** exp
  const text = Math.round(data) >= 1000 ? data.toFixed(0) : data.toPrecision(3)
  return `${text} ${TRAFFIC_UNITS[exp]}`
}

export const formatConnectionChains = (chains: string[]) => {
  let value = ''
  for (let i = chains.length - 1; i >= 0; i -= 1) {
    if (value) value += ' / '
    value += chains[i]
  }
  return value
}

export const getConnectionDestination = (connection: IConnectionsItem) => {
  const { metadata } = connection
  return metadata.destinationIP
    ? `${metadata.destinationIP}:${metadata.destinationPort}`
    : `${metadata.remoteDestination}:${metadata.destinationPort}`
}

export const getConnectionHost = (connection: IConnectionsItem) => {
  const { metadata } = connection
  const host =
    metadata.host || metadata.destinationIP || metadata.remoteDestination
  return `${host}:${metadata.destinationPort}`
}

/** 只取主机名本身，不带目标端口，例如 example.com */
export const getConnectionHostName = (connection: IConnectionsItem) => {
  const { metadata } = connection
  return (
    metadata.host || metadata.destinationIP || metadata.remoteDestination || ''
  )
}

/**
 * 选择框的稳定 key：历史列表按主机名压缩成一行，行的 id 会随着并入的新记录变化，
 * 所以这里用主机名；没有主机名时该行不会被合并，退回连接 id。
 */
export const getConnectionSelectKey = (connection: IConnectionsItem) => {
  const host = connection.metadata?.host?.trim().toLowerCase() ?? ''
  return host || `id:${connection.id}`
}

export const getConnectionProcess = (connection: IConnectionsItem) => {
  const { metadata } = connection
  return metadata.process || metadata.processPath || ''
}

export const getConnectionRule = (connection: IConnectionsItem) => {
  const { rulePayload } = connection
  return rulePayload ? `${connection.rule}(${rulePayload})` : connection.rule
}

export const getConnectionSource = (connection: IConnectionsItem) => {
  const { metadata } = connection
  return `${metadata.sourceIP}:${metadata.sourcePort}`
}

export const getConnectionTypeLabel = (connection: IConnectionsItem) => {
  const { metadata } = connection
  return `${metadata.type}(${metadata.network})`
}

export const getConnectionStartTime = (connection: IConnectionsItem) =>
  Date.parse(connection.start || '') || 0

const createConnectionRowView = (
  connection: IConnectionsItem,
  options?: ConnectionRowViewOptions,
) => {
  const uploadSpeed = connection.curUpload ?? 0
  const downloadSpeed = connection.curDownload ?? 0
  const { failed, dialError } = getConnectionDialFlags(connection)

  return {
    id: connection.id,
    selectKey: options?.selectByHost
      ? getConnectionSelectKey(connection)
      : connection.id,
    host: options?.hostWithoutPort
      ? getConnectionHostName(connection)
      : getConnectionHost(connection),
    process: getConnectionProcess(connection),
    network: connection.metadata.network,
    type: connection.metadata.type,
    chains: formatConnectionChains(connection.chains),
    rule: getConnectionRule(connection),
    time: connection.start,
    source: getConnectionSource(connection),
    destination: getConnectionDestination(connection),
    uploadText: formatConnectionTraffic(connection.upload),
    downloadText: formatConnectionTraffic(connection.download),
    uploadSpeedText: `${formatConnectionTraffic(uploadSpeed)}/s`,
    downloadSpeedText: `${formatConnectionTraffic(downloadSpeed)}/s`,
    upload: connection.upload ?? 0,
    download: connection.download ?? 0,
    uploadSpeed,
    downloadSpeed,
    startTime: getConnectionStartTime(connection),
    failed: Boolean(failed),
    dialError: dialError ?? '',
    searchableHost: connection.metadata.host || '',
    searchableDestinationIP: connection.metadata.destinationIP || '',
    searchableProcess: connection.metadata.process || '',
  } satisfies ConnectionRowView
}

const sameConnectionRowView = (
  left: ConnectionRowView,
  right: ConnectionRowView,
) =>
  left.selectKey === right.selectKey &&
  left.host === right.host &&
  left.process === right.process &&
  left.network === right.network &&
  left.type === right.type &&
  left.chains === right.chains &&
  left.rule === right.rule &&
  left.time === right.time &&
  left.source === right.source &&
  left.destination === right.destination &&
  left.uploadText === right.uploadText &&
  left.downloadText === right.downloadText &&
  left.uploadSpeedText === right.uploadSpeedText &&
  left.downloadSpeedText === right.downloadSpeedText &&
  left.upload === right.upload &&
  left.download === right.download &&
  left.uploadSpeed === right.uploadSpeed &&
  left.downloadSpeed === right.downloadSpeed &&
  left.failed === right.failed &&
  left.dialError === right.dialError &&
  left.searchableHost === right.searchableHost &&
  left.searchableDestinationIP === right.searchableDestinationIP &&
  left.searchableProcess === right.searchableProcess

export interface ConnectionRowViewOptions {
  /** 主机名不拼目标端口，历史列表按域名聚合时使用 */
  hostWithoutPort?: boolean
  /** 选择状态按主机名而不是连接 id 记录，历史列表按域名聚合时使用 */
  selectByHost?: boolean
}

export const useConnectionRowViews = (
  connections: IConnectionsItem[],
  options?: ConnectionRowViewOptions,
) => {
  const hostWithoutPort = options?.hostWithoutPort ?? false
  const selectByHost = options?.selectByHost ?? false
  const previousRowsRef = useRef(new Map<string, ConnectionRowView>())
  const previousConnectionsRef = useRef(new Map<string, IConnectionsItem>())
  const previousHostWithoutPortRef = useRef(hostWithoutPort)
  const previousSelectByHostRef = useRef(selectByHost)

  return useMemo(() => {
    const cacheValid =
      previousHostWithoutPortRef.current === hostWithoutPort &&
      previousSelectByHostRef.current === selectByHost
    previousHostWithoutPortRef.current = hostWithoutPort
    previousSelectByHostRef.current = selectByHost

    const previousRows = cacheValid
      ? previousRowsRef.current
      : new Map<string, ConnectionRowView>()
    const previousConnections = cacheValid
      ? previousConnectionsRef.current
      : new Map<string, IConnectionsItem>()
    const nextRows = new Map<string, ConnectionRowView>()
    const nextConnections = new Map<string, IConnectionsItem>()
    const rows: ConnectionRowView[] = []

    connections.forEach((connection) => {
      nextConnections.set(connection.id, connection)

      const previousRow = previousRows.get(connection.id)
      const previousConnection = previousConnections.get(connection.id)

      let row: ConnectionRowView
      if (previousRow && previousConnection === connection) {
        row = previousRow
      } else {
        const nextRow = createConnectionRowView(connection, {
          hostWithoutPort,
          selectByHost,
        })
        row =
          previousRow && sameConnectionRowView(previousRow, nextRow)
            ? previousRow
            : nextRow
      }

      nextRows.set(connection.id, row)
      rows.push(row)
    })

    previousRowsRef.current = nextRows
    previousConnectionsRef.current = nextConnections
    return rows
  }, [connections, hostWithoutPort, selectByHost])
}
