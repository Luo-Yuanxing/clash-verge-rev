import { useCallback, useEffect, useMemo, useState } from 'react'
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
let socket: MihomoWebSocket | null = null
let connecting = false
let scanning = false
let reconnectDelayMs = RECONNECT_DELAY_MS
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const appendRecord = (record: ConnectionHistoryItem) => {
  records.push(record)
  if (records.length > MAX_LOG_CONNECTIONS) {
    records.splice(0, records.length - MAX_LOG_CONNECTIONS)
  }
}

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
}

/**
 * Connections seen in the core log within the last `durationMs`.
 *
 * Records are recomputed on a timer instead of on every log line: every 5s
 * while the connections history list is on screen, every 60s otherwise.
 */
export const useConnectionLogHistory = (
  durationMs: number,
  options?: { active?: boolean },
) => {
  const active = options?.active ?? false
  const refreshMs = active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Rescan on the first tick as well, so returning to the history list shows
    // the newest records immediately instead of after a full idle period.
    setNow(Date.now())

    const timer = window.setInterval(() => setNow(Date.now()), refreshMs)
    return () => window.clearInterval(timer)
  }, [refreshMs])

  const clear = useCallback(() => {
    clearConnectionLogData()
    setNow((prev) => Math.max(Date.now(), prev + 1))
  }, [])

  const connections = useMemo(
    () => records.filter((item) => item.startAt >= now - durationMs),
    [now, durationMs],
  )

  return { connections, clear }
}
