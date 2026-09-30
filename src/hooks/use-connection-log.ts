import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { parseConnectionLogLine } from '@/utils/connection-log'

import type { ConnectionHistoryItem } from './use-connection-data'

const MAX_LOG_CONNECTIONS = 2_000
/** Log rescan period while the connections history list is on screen */
const ACTIVE_REFRESH_MS = 5_000
/** Log rescan period for the rest of the app lifetime */
const IDLE_REFRESH_MS = 60_000
const RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000
/** Safety net for a socket that dies without reporting an error */
const KEEP_ALIVE_CHECK_MS = 30_000

/**
 * Connection records parsed out of the core log stream.
 *
 * The log is an event stream, while the connections API only reports a
 * snapshot once per second, so short lived connections are only visible here.
 */
let records: ConnectionHistoryItem[] = []
/** Records already handed to the list; the reference only changes with the content */
let published: ConnectionHistoryItem[] = []
/** Records collected since the last refresh, appended to the list tail in one batch */
let pending: ConnectionHistoryItem[] = []
let publishedWindowMs = 0
let socket: MihomoWebSocket | null = null
let connecting = false
let scanning = false
let reconnectDelayMs = RECONNECT_DELAY_MS
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const windowListeners = new Set<() => void>()

const appendRecord = (record: ConnectionHistoryItem) => {
  records.push(record)
  if (records.length > MAX_LOG_CONNECTIONS) {
    records.splice(0, records.length - MAX_LOG_CONNECTIONS)
  }
  pending.push(record)
}

const sameList = (
  left: ConnectionHistoryItem[],
  right: ConnectionHistoryItem[],
) => {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

/** Notify the list only when the content really changed, so the table stays still */
const publish = (next: ConnectionHistoryItem[]) => {
  if (sameList(published, next)) return
  published = next
  windowListeners.forEach((listener) => {
    listener()
  })
}

/**
 * Append the newly collected records to the tail of the list and drop the ones
 * that slid out of the window.
 *
 * Called on a fixed period instead of on every log line: new records are
 * batched, so a burst of connections costs a single table update, and a period
 * without new or expired records leaves the reference untouched.
 */
const refreshPublished = (durationMs: number) => {
  const cutoff = Date.now() - durationMs

  if (durationMs > publishedWindowMs) {
    // The window grew: records dropped earlier have to come back, rebuild it
    publishedWindowMs = durationMs
    pending = []
    publish(records.filter((item) => item.startAt >= cutoff))
    return
  }

  publishedWindowMs = durationMs

  if (pending.length > 0) {
    const appended = published.concat(pending)
    pending = []
    publish(
      appended.some((item) => item.startAt < cutoff)
        ? appended.filter((item) => item.startAt >= cutoff)
        : appended,
    )
    return
  }

  if (published.some((item) => item.startAt < cutoff)) {
    publish(published.filter((item) => item.startAt >= cutoff))
  }
}

const subscribeWindow = (listener: () => void) => {
  windowListeners.add(listener)
  return () => {
    windowListeners.delete(listener)
  }
}

const getWindowSnapshot = () => published

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
    console.warn('Failed to close connection log websocket', err)
  }
}

const scheduleReconnect = () => {
  if (!scanning || reconnectTimer) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS)
    void connect()
  }, reconnectDelayMs)
}

const reconnect = async () => {
  if (!scanning) return
  await closeSocket()
  scheduleReconnect()
}

const handleMessage = (data: string) => {
  if (data.startsWith('Websocket error')) {
    void reconnect()
    return
  }

  let payload: string
  try {
    payload = (JSON.parse(data) as ILogItem).payload ?? ''
  } catch {
    return
  }

  const record = parseConnectionLogLine(payload, Date.now())
  if (record) appendRecord(record)
}

const connect = async () => {
  if (socket || connecting || !scanning) return

  clearReconnectTimer()
  connecting = true

  try {
    const connected = await MihomoWebSocket.connect_logs('INFO')
    if (!scanning) {
      await connected.close()
      return
    }

    reconnectDelayMs = RECONNECT_DELAY_MS
    socket = connected
    connected.addListener((message) => {
      if (socket !== connected) return
      if (message.type !== 'Text') return
      handleMessage(message.data)
    })
  } catch {
    scheduleReconnect()
  } finally {
    connecting = false
  }
}

/**
 * Subscribe to the core log stream for the whole app lifetime.
 *
 * Scanning never stops: the subscription survives page switches and window
 * hiding, and a keep-alive check reconnects a socket that went away silently.
 */
export const startConnectionLogScanning = () => {
  if (scanning) return
  scanning = true
  void connect()

  window.setInterval(() => {
    if (socket || connecting || reconnectTimer) return
    void connect()
  }, KEEP_ALIVE_CHECK_MS)
}

export const clearConnectionLogData = () => {
  records = []
  pending = []
  publish([])
}

/**
 * Connections seen in the core log within the last `durationMs`.
 *
 * The list is kept as a published array: newly collected records join it at the
 * tail, every 5s while the connections history list is on screen and every 60s
 * otherwise, so the table is only touched when something actually changed.
 */
export const useConnectionLogHistory = (
  durationMs: number,
  options?: { active?: boolean },
) => {
  const active = options?.active ?? false
  const refreshMs = active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS

  useEffect(() => {
    // Refresh once on the first tick as well, so returning to the history list
    // shows the newest records immediately instead of after a full idle period.
    refreshPublished(durationMs)

    const timer = window.setInterval(
      () => refreshPublished(durationMs),
      refreshMs,
    )
    return () => window.clearInterval(timer)
  }, [durationMs, refreshMs])

  const connections = useSyncExternalStore(
    subscribeWindow,
    getWindowSnapshot,
    getWindowSnapshot,
  )

  const clear = useCallback(() => {
    clearConnectionLogData()
  }, [])

  return { connections, clear }
}
