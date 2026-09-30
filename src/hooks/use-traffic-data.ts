import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { MihomoWebSocket, Traffic } from 'tauri-plugin-mihomo-api'

import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'
import { useTrafficMonitorEnhanced } from './use-traffic-monitor'

const FALLBACK_TRAFFIC: Traffic = { up: 0, down: 0, upTotal: 0, downTotal: 0 }
const DUPLICATE_TRAFFIC_WINDOW_MS = 50

export interface TrafficBaseline {
  up: number
  down: number
}

/** 手动清零后保存的累计量基线，显示值 = 内核累计值 - 基线 */
const TRAFFIC_BASELINE_STORAGE_KEY = 'mihomo_traffic_baseline'
const EMPTY_BASELINE: TrafficBaseline = { up: 0, down: 0 }

let lastTrafficSignature = ''
let lastTrafficTimestamp = 0
/** 最近一次收到内核累计值，作为清零时的基线，供不持有订阅的组件（如卡片头部按钮）使用 */
let latestRawTraffic: ITrafficItem = FALLBACK_TRAFFIC

let baselineCache: TrafficBaseline | null = null
const baselineListeners = new Set<() => void>()

const readBaseline = (): TrafficBaseline => {
  if (baselineCache) return baselineCache

  let stored: Partial<TrafficBaseline> | null
  try {
    const raw = localStorage.getItem(TRAFFIC_BASELINE_STORAGE_KEY)
    stored = raw ? (JSON.parse(raw) as Partial<TrafficBaseline>) : null
  } catch {
    stored = null
  }

  baselineCache = {
    up: Number(stored?.up) || 0,
    down: Number(stored?.down) || 0,
  }
  return baselineCache
}

const writeBaseline = (baseline: TrafficBaseline) => {
  baselineCache = baseline

  try {
    localStorage.setItem(TRAFFIC_BASELINE_STORAGE_KEY, JSON.stringify(baseline))
  } catch {
    // 存储不可用时只保留内存中的基线
  }

  baselineListeners.forEach((listener) => listener())
}

const subscribeBaseline = (listener: () => void) => {
  baselineListeners.add(listener)
  return () => {
    baselineListeners.delete(listener)
  }
}

const useTrafficBaseline = (): TrafficBaseline =>
  useSyncExternalStore(subscribeBaseline, readBaseline, readBaseline)

/** 把上传量与下载量的累计显示清零 */
export const resetTrafficTotals = () => {
  writeBaseline({
    up: latestRawTraffic.upTotal ?? 0,
    down: latestRawTraffic.downTotal ?? 0,
  })
}

/** 记录最近一次的内核累计值，清零时以它为新基线 */
const rememberRawTraffic = (traffic: ITrafficItem) => {
  latestRawTraffic = traffic
}

const shouldSkipDuplicateTraffic = (traffic: Traffic) => {
  const now = Date.now()
  const signature = `${traffic.up}:${traffic.down}:${traffic.upTotal}:${traffic.downTotal}`

  if (
    signature === lastTrafficSignature &&
    now - lastTrafficTimestamp <= DUPLICATE_TRAFFIC_WINDOW_MS
  ) {
    return true
  }

  lastTrafficSignature = signature
  lastTrafficTimestamp = now
  return false
}

export const useTrafficData = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true

  const {
    graphData: { appendData },
  } = useTrafficMonitorEnhanced({ subscribe: false, enabled })
  const { response, refresh } = useMihomoWsSubscription<ITrafficItem>({
    storageKey: 'mihomo_traffic_date',
    buildSubscriptKey: (date) => (enabled ? `getClashTraffic-${date}` : null),
    fallbackData: FALLBACK_TRAFFIC,
    connect: () => MihomoWebSocket.connect_traffic(),
    throttleMs: 200,
    setupHandlers: ({ next, scheduleReconnect }) => ({
      handleMessage: (data) => {
        if (data.startsWith('Websocket error')) {
          next(data, FALLBACK_TRAFFIC)
          void scheduleReconnect()
          return
        }

        try {
          const parsed = JSON.parse(data) as Traffic
          if (shouldSkipDuplicateTraffic(parsed)) {
            return
          }
          rememberRawTraffic(parsed)
          appendData(parsed)
          next(null, parsed)
        } catch (error) {
          next(error, FALLBACK_TRAFFIC)
        }
      },
    }),
  })

  const baseline = useTrafficBaseline()

  const rawTraffic = response.data
  const rawUpTotal = rawTraffic?.upTotal ?? 0
  const rawDownTotal = rawTraffic?.downTotal ?? 0
  const baselineUp = baseline.up
  const baselineDown = baseline.down

  // 内核重启后累计量会从 0 重新计数，此时旧基线失效，直接丢弃
  useEffect(() => {
    if (rawUpTotal < baselineUp || rawDownTotal < baselineDown) {
      writeBaseline(EMPTY_BASELINE)
    }
  }, [rawUpTotal, rawDownTotal, baselineUp, baselineDown])

  const data = useMemo<ITrafficItem>(
    () => ({
      up: rawTraffic?.up ?? 0,
      down: rawTraffic?.down ?? 0,
      upTotal: Math.max(0, rawUpTotal - baselineUp),
      downTotal: Math.max(0, rawDownTotal - baselineDown),
    }),
    [rawTraffic, rawUpTotal, rawDownTotal, baselineUp, baselineDown],
  )

  return { response, data, refreshGetClashTraffic: refresh }
}
