import { useCallback, useEffect, useMemo, useState } from 'react'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { parseConnectionLogLine } from '@/utils/connection-log'

import type { ConnectionHistoryItem } from './use-connection-data'

const MAX_LOG_CONNECTIONS = 2_000
const DEFAULT_REFRESH_MS = 5_000
const RECONNECT_DELAY_MS = 1_000
const EMPTY_CONNECTIONS: ConnectionHistoryItem[] = []

/**
 * Connection records parsed out of the core log stream.
 *
 * The log is an event stream, while the connections API only reports a
 * snapshot once per second, so short lived connections are only visible here.
 */
let records: ConnectionHistoryItem[] = []
let socket: MihomoWebSocket | null = null
let connecting = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let subscriberCount = 0

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
  if (subscriberCount === 0 || reconnectTimer) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    void connect()
  }, RECONNECT_DELAY_MS)
}

const reconnect = async () => {
  if (subscriberCount === 0) return
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
  if (socket || connecting || subscriberCount === 0) return

  clearReconnectTimer()
  connecting = true

  try {
    const connected = await MihomoWebSocket.connect_logs('INFO')
    if (subscriberCount === 0) {
      await connected.close()
      return
    }

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

const startSubscription = () => {
  subscriberCount += 1
  void connect()
}

const stopSubscription = () => {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount > 0) return

  clearReconnectTimer()
  void closeSocket()
}

export const clearConnectionLogData = () => {
  records = []
}

/**
 * Connections seen in the core log within the last `durationMs`.
 *
 * Recomputed on a fixed interval instead of on every log line, and the log
 * subscription only lives while `enabled`. Active and closed lists are not
 * involved.
 */
export const useConnectionLogHistory = (
  durationMs: number,
  options?: { enabled?: boolean; refreshMs?: number },
) => {
  const enabled = options?.enabled ?? true
  const refreshMs = options?.refreshMs ?? DEFAULT_REFRESH_MS
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return

    startSubscription()
    return stopSubscription
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    const timer = window.setInterval(() => setNow(Date.now()), refreshMs)
    return () => window.clearInterval(timer)
  }, [enabled, refreshMs])

  const clear = useCallback(() => {
    clearConnectionLogData()
    setNow((prev) => Math.max(Date.now(), prev + 1))
  }, [])

  const connections = useMemo(
    () =>
      enabled
        ? records.filter((item) => item.startAt >= now - durationMs)
        : EMPTY_CONNECTIONS,
    [enabled, now, durationMs],
  )

  return { connections, clear }
}
