import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

const MAX_CLOSED_CONNS_NUM = 500
const MAX_HISTORY_CONNS_NUM = 2_000
/** Minimum interval between two listener notifications (state updates are not throttled) */
const CONNECTION_UPDATE_THROTTLE_MS = 500
const CONNECTION_RECONNECT_DELAY_MS = 1_000

export const DEFAULT_HISTORY_WINDOW_MS = 10 * 60 * 1_000
const MIN_HISTORY_WINDOW_MS = 5_000

export interface ConnectionHistoryItem extends IConnectionsItem {
  /** Connection start time, parsed from the core-provided start field */
  startAt: number
  /** Last snapshot the connection was observed in, i.e. the end of its closed interval */
  lastSeen: number
  active: boolean
}

type ConnectionMetadata = IConnectionsItem['metadata']
type ConnectionListener = () => void

const metadataValue = (value?: string) => value || ''

const initConnData: ConnectionMonitorData = {
  uploadTotal: 0,
  downloadTotal: 0,
  activeConnections: [],
  closedConnections: [],
  historyConnections: [],
}

interface ConnectionMonitorData {
  uploadTotal: number
  downloadTotal: number
  activeConnections: IConnectionsItem[]
  closedConnections: IConnectionsItem[]
  historyConnections: ConnectionHistoryItem[]
}

interface ConnectionSummaryPayload {
  count?: number
}

interface ConnectionSummaryData {
  activeConnectionCount: number
}

const initConnSummaryData: ConnectionSummaryData = {
  activeConnectionCount: 0,
}

let connectionData: ConnectionMonitorData = initConnData
let connectionSummary: ConnectionSummaryData = initConnSummaryData
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastFlushAt = 0

const connectionListeners = new Set<ConnectionListener>()
const summaryListeners = new Set<ConnectionListener>()

const notifyConnectionListeners = () => {
  connectionListeners.forEach((listener) => listener())
}

const notifySummaryListeners = () => {
  summaryListeners.forEach((listener) => listener())
}

const sameMetadata = (left: ConnectionMetadata, right: ConnectionMetadata) =>
  metadataValue(left.network) === metadataValue(right.network) &&
  metadataValue(left.type) === metadataValue(right.type) &&
  metadataValue(left.host) === metadataValue(right.host) &&
  metadataValue(left.sourceIP) === metadataValue(right.sourceIP) &&
  metadataValue(left.sourcePort) === metadataValue(right.sourcePort) &&
  metadataValue(left.destinationPort) ===
    metadataValue(right.destinationPort) &&
  metadataValue(left.destinationIP) === metadataValue(right.destinationIP) &&
  metadataValue(left.remoteDestination) ===
    metadataValue(right.remoteDestination) &&
  metadataValue(left.process) === metadataValue(right.process) &&
  metadataValue(left.processPath) === metadataValue(right.processPath)

const normalizeMetadata = (
  metadata: ConnectionMetadata,
  previous?: ConnectionMetadata,
): ConnectionMetadata => {
  if (previous && sameMetadata(previous, metadata)) return previous

  return {
    network: metadata.network || '',
    type: metadata.type || '',
    host: metadata.host || '',
    sourceIP: metadata.sourceIP || '',
    sourcePort: metadata.sourcePort || '',
    destinationPort: metadata.destinationPort || '',
    destinationIP: metadata.destinationIP || '',
    remoteDestination: metadata.remoteDestination || '',
    process: metadata.process || '',
    processPath: metadata.processPath || '',
  }
}

const sameChains = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

const normalizeChains = (chains: string[], previous?: string[]) => {
  if (previous && sameChains(previous, chains)) return previous
  return chains.slice()
}

const normalizeConnection = (
  connection: IConnectionsItem,
  previous?: IConnectionsItem,
): IConnectionsItem => {
  const metadata = normalizeMetadata(connection.metadata, previous?.metadata)
  const chains = normalizeChains(connection.chains || [], previous?.chains)
  const upload = connection.upload ?? 0
  const download = connection.download ?? 0
  const curUpload = previous ? upload - previous.upload : 0
  const curDownload = previous ? download - previous.download : 0
  const rule = connection.rule || ''
  const rulePayload = connection.rulePayload || ''
  const start = connection.start || ''

  if (
    previous &&
    previous.metadata === metadata &&
    previous.chains === chains &&
    previous.upload === upload &&
    previous.download === download &&
    previous.curUpload === curUpload &&
    previous.curDownload === curDownload &&
    previous.rule === rule &&
    previous.rulePayload === rulePayload &&
    previous.start === start
  ) {
    return previous
  }

  return {
    id: connection.id,
    metadata,
    upload,
    download,
    start,
    chains,
    rule,
    rulePayload,
    curUpload,
    curDownload,
  }
}

const mergeConnectionSnapshot = (
  payload: IConnections,
  previous: ConnectionMonitorData = initConnData,
): ConnectionMonitorData => {
  const nextConnections = payload.connections ?? []
  const previousActive = previous.activeConnections ?? []
  const previousClosed = previous.closedConnections ?? []
  const previousActiveById = new Map<string, IConnectionsItem>()

  for (let i = 0; i < previousActive.length; i++) {
    const previousConnection = previousActive[i]
    previousActiveById.set(previousConnection.id, previousConnection)
  }

  const activeConnections: IConnectionsItem[] = []
  for (let i = 0; i < nextConnections.length; i++) {
    const connection = nextConnections[i]
    const previousConnection = previousActiveById.get(connection.id)
    if (previousConnection) previousActiveById.delete(connection.id)
    activeConnections.push(normalizeConnection(connection, previousConnection))
  }

  if (previousActiveById.size === 0) {
    return {
      uploadTotal: payload.uploadTotal ?? 0,
      downloadTotal: payload.downloadTotal ?? 0,
      activeConnections,
      closedConnections: previousClosed,
      historyConnections: previous.historyConnections,
    }
  }

  const removedConnectionCount = previousActiveById.size
  const dropFromClosed = Math.max(
    0,
    previousClosed.length + removedConnectionCount - MAX_CLOSED_CONNS_NUM,
  )
  const closedConnections =
    dropFromClosed >= previousClosed.length
      ? []
      : previousClosed.slice(dropFromClosed)

  const keepFromRemoved = MAX_CLOSED_CONNS_NUM - closedConnections.length
  let skipRemoved = Math.max(0, removedConnectionCount - keepFromRemoved)

  for (let i = 0; i < previousActive.length; i++) {
    const connection = previousActive[i]
    if (!previousActiveById.has(connection.id)) continue
    if (skipRemoved > 0) {
      skipRemoved -= 1
      continue
    }
    closedConnections.push(connection)
  }

  return {
    uploadTotal: payload.uploadTotal ?? 0,
    downloadTotal: payload.downloadTotal ?? 0,
    activeConnections,
    closedConnections,
    historyConnections: previous.historyConnections,
  }
}

let historyWindowMs = DEFAULT_HISTORY_WINDOW_MS

/** Connection start time reported by the core, `fallback` when it cannot be parsed */
const connectionStartAt = (connection: IConnectionsItem, fallback: number) =>
  Date.parse(connection.start || '') || fallback

/**
 * Append the latest snapshot to the rolling history window.
 * Active connections are refreshed in place, disappeared ones keep their
 * last seen timestamp and are dropped once they leave the window.
 */
const mergeConnectionHistory = (
  previous: ConnectionHistoryItem[],
  activeConnections: IConnectionsItem[],
  now: number,
): ConnectionHistoryItem[] => {
  const cutoff = now - historyWindowMs
  const activeById = new Map<string, IConnectionsItem>()
  for (let i = 0; i < activeConnections.length; i++) {
    activeById.set(activeConnections[i].id, activeConnections[i])
  }

  const nextHistory: ConnectionHistoryItem[] = []
  const recorded = new Set<string>()

  for (let i = 0; i < previous.length; i++) {
    const item = previous[i]
    if (recorded.has(item.id)) continue

    const active = activeById.get(item.id)
    if (active) {
      recorded.add(item.id)
      nextHistory.push({
        ...active,
        startAt: connectionStartAt(active, item.startAt),
        lastSeen: now,
        active: true,
      })
      continue
    }

    if (item.lastSeen < cutoff) continue
    recorded.add(item.id)
    nextHistory.push(
      item.active ? { ...item, active: false, lastSeen: now } : item,
    )
  }

  for (let i = 0; i < activeConnections.length; i++) {
    const connection = activeConnections[i]
    if (recorded.has(connection.id)) continue
    recorded.add(connection.id)
    nextHistory.push({
      ...connection,
      startAt: connectionStartAt(connection, now),
      lastSeen: now,
      active: true,
    })
  }

  if (nextHistory.length <= MAX_HISTORY_CONNS_NUM) return nextHistory

  nextHistory.sort((a, b) => b.lastSeen - a.lastSeen)
  nextHistory.length = MAX_HISTORY_CONNS_NUM
  return nextHistory
}

export const pruneConnectionHistory = () => {
  const cutoff = Date.now() - historyWindowMs
  const activeIds = new Set<string>()
  for (let i = 0; i < connectionData.activeConnections.length; i++) {
    activeIds.add(connectionData.activeConnections[i].id)
  }

  const nextHistory = connectionData.historyConnections.filter(
    (item) => activeIds.has(item.id) || item.lastSeen >= cutoff,
  )
  if (nextHistory.length === connectionData.historyConnections.length) return

  connectionData = { ...connectionData, historyConnections: nextHistory }
  notifyConnectionListeners()
}

export const setConnectionHistoryWindow = (windowMs: number) => {
  const nextWindowMs = Math.max(MIN_HISTORY_WINDOW_MS, windowMs)
  if (nextWindowMs === historyWindowMs) return
  historyWindowMs = nextWindowMs
  pruneConnectionHistory()
}

export const clearConnectionHistoryData = () => {
  if (connectionData.historyConnections.length === 0) return
  connectionData = { ...connectionData, historyConnections: [] }
  notifyConnectionListeners()
}

/**
 * Connections whose lifetime interval overlaps `[from, to]`.
 *
 * A connection is treated as continuous from `startAt` (the start time
 * reported by the core) until `lastSeen`; connections that are still alive
 * have no end and therefore always overlap. Results are limited to what the
 * history window still holds.
 */
export const getConnectionsInRange = (
  from: number,
  to: number = Date.now(),
): ConnectionHistoryItem[] => {
  const rangeStart = Math.min(from, to)
  const rangeEnd = Math.max(from, to)

  return connectionData.historyConnections.filter((item) => {
    if (item.startAt > rangeEnd) return false
    return item.active || item.lastSeen >= rangeStart
  })
}

const mergeConnectionSummary = (
  payload: ConnectionSummaryPayload,
): ConnectionSummaryData => ({
  activeConnectionCount: payload.count ?? 0,
})

const flushConnectionListeners = () => {
  flushTimer = null
  lastFlushAt = Date.now()
  if (connectionListeners.size === 0) return
  notifyConnectionListeners()
}

/** Only the listener notification is throttled, never the state update. */
const scheduleConnectionNotify = () => {
  if (flushTimer) return

  const elapsed = Date.now() - lastFlushAt
  if (elapsed >= CONNECTION_UPDATE_THROTTLE_MS) {
    flushConnectionListeners()
    return
  }

  flushTimer = window.setTimeout(
    flushConnectionListeners,
    CONNECTION_UPDATE_THROTTLE_MS - elapsed,
  )
}

/**
 * Record every websocket frame, so connections that appear and disappear
 * between two notifications still land in the closed and history lists.
 */
const recordConnectionMessage = (messageData: string) => {
  if (connectionListeners.size === 0) return

  let payload: IConnections
  try {
    payload = JSON.parse(messageData) as IConnections
  } catch (err) {
    console.error('[Connections] Failed to parse websocket payload', err)
    return
  }

  const now = Date.now()
  const nextData = mergeConnectionSnapshot(payload, connectionData)
  connectionData = {
    ...nextData,
    historyConnections: mergeConnectionHistory(
      connectionData.historyConnections,
      nextData.activeConnections,
      now,
    ),
  }
  scheduleConnectionNotify()
}

const clearPendingNotify = () => {
  if (!flushTimer) return
  window.clearTimeout(flushTimer)
  flushTimer = null
}

interface SocketSupervisor {
  start: () => void
  stopIfIdle: () => void
}

const createSocketSupervisor = (options: {
  listeners: Set<ConnectionListener>
  connectSocket: () => Promise<MihomoWebSocket>
  onText: (data: string) => void
  closeLogLabel: string
  onIdle?: () => void
}): SocketSupervisor => {
  const { listeners, connectSocket, onText, closeLogLabel, onIdle } = options
  const hasSubscribers = () => listeners.size > 0
  let socket: MihomoWebSocket | null = null
  let connecting = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const closeSocket = async () => {
    const current = socket
    socket = null
    if (!current) return

    try {
      await current.close()
    } catch (err) {
      console.warn(`Failed to close ${closeLogLabel} websocket`, err)
    }
  }

  const scheduleReconnect = () => {
    if (!hasSubscribers()) return
    if (reconnectTimer) return
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, CONNECTION_RECONNECT_DELAY_MS)
  }

  const reconnect = async () => {
    if (!hasSubscribers()) return
    await closeSocket()
    scheduleReconnect()
  }

  const connect = async () => {
    if (socket || connecting) return
    if (!hasSubscribers()) return

    clearReconnectTimer()
    connecting = true

    try {
      const connected = await connectSocket()
      if (!hasSubscribers()) {
        await connected.close()
        return
      }
      socket = connected
      connected.addListener((message) => {
        if (socket !== connected) return
        if (message.type !== 'Text') return
        if (message.data.startsWith('Websocket error')) {
          void reconnect()
          return
        }

        onText(message.data)
      })
    } catch {
      scheduleReconnect()
    } finally {
      connecting = false
    }
  }

  return {
    start: () => {
      void connect()
    },
    stopIfIdle: () => {
      if (hasSubscribers()) return

      onIdle?.()
      clearReconnectTimer()
      void closeSocket()
    },
  }
}

const handleSummaryText = (messageData: string) => {
  let payload: ConnectionSummaryPayload
  try {
    payload = JSON.parse(messageData) as ConnectionSummaryPayload
  } catch (err) {
    console.error(
      '[Connections] Failed to parse connections count payload',
      err,
    )
    return
  }

  connectionSummary = mergeConnectionSummary(payload)
  notifySummaryListeners()
}

const connectionSupervisor = createSocketSupervisor({
  listeners: connectionListeners,
  connectSocket: () => MihomoWebSocket.connect_connections(),
  onText: recordConnectionMessage,
  closeLogLabel: 'connection',
  onIdle: clearPendingNotify,
})

const summarySupervisor = createSocketSupervisor({
  listeners: summaryListeners,
  connectSocket: () => MihomoWebSocket.connect_connections_count(),
  onText: handleSummaryText,
  closeLogLabel: 'connections count',
})

const getConnectionSnapshot = () => connectionData
const getConnectionSummarySnapshot = () => connectionSummary

const subscribeConnectionData = (listener: ConnectionListener) => {
  connectionListeners.add(listener)
  connectionSupervisor.start()
  return () => {
    connectionListeners.delete(listener)
    connectionSupervisor.stopIfIdle()
  }
}

const subscribeConnectionSummary = (listener: ConnectionListener) => {
  summaryListeners.add(listener)
  summarySupervisor.start()
  return () => {
    summaryListeners.delete(listener)
    summarySupervisor.stopIfIdle()
  }
}

const DEFAULT_RANGE_REFRESH_MS = 5_000
const EMPTY_CONNECTION_LIST: ConnectionHistoryItem[] = []

/**
 * Connections that were alive at any point within the last `durationMs`.
 *
 * The range is recomputed on a fixed interval instead of on every snapshot, so
 * the history view stays cheap; leaving the page stops the timer. The active
 * and closed lists are left untouched.
 */
export const useConnectionHistoryInRange = (
  durationMs: number,
  options?: { enabled?: boolean; refreshMs?: number },
) => {
  const enabled = options?.enabled ?? true
  const refreshMs = options?.refreshMs ?? DEFAULT_RANGE_REFRESH_MS
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return

    const timer = window.setInterval(() => setNow(Date.now()), refreshMs)
    return () => window.clearInterval(timer)
  }, [enabled, refreshMs])

  return useMemo(
    () =>
      enabled
        ? getConnectionsInRange(now - durationMs, now)
        : EMPTY_CONNECTION_LIST,
    [enabled, now, durationMs],
  )
}

const clearClosedConnectionData = () => {
  if (connectionData.closedConnections.length === 0) return
  connectionData = {
    ...connectionData,
    closedConnections: [],
  }
  notifyConnectionListeners()
}

export const useConnectionData = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true
  const subscribe = useCallback(
    (listener: ConnectionListener) =>
      enabled ? subscribeConnectionData(listener) : () => {},
    [enabled],
  )
  const data = useSyncExternalStore(
    subscribe,
    getConnectionSnapshot,
    getConnectionSnapshot,
  )
  const response = useMemo(() => ({ data }), [data])
  const clearClosedConnections = useCallback(() => {
    clearClosedConnectionData()
  }, [])
  const clearHistoryConnections = useCallback(() => {
    clearConnectionHistoryData()
  }, [])

  return {
    response,
    clearClosedConnections,
    clearHistoryConnections,
  }
}

export const useConnectionSummaryData = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true
  const subscribe = useCallback(
    (listener: ConnectionListener) =>
      enabled ? subscribeConnectionSummary(listener) : () => {},
    [enabled],
  )
  const data = useSyncExternalStore(
    subscribe,
    getConnectionSummarySnapshot,
    getConnectionSummarySnapshot,
  )
  const response = useMemo(() => ({ data }), [data])

  return {
    response,
  }
}
