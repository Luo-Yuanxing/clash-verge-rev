import { useLocalStorage } from 'foxact/use-local-storage'
import { useCallback, useEffect, useMemo } from 'react'
import { MihomoWebSocket, Traffic } from 'tauri-plugin-mihomo-api'

import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'
import { useTrafficMonitorEnhanced } from './use-traffic-monitor'

const FALLBACK_TRAFFIC: Traffic = { up: 0, down: 0, upTotal: 0, downTotal: 0 }
const DUPLICATE_TRAFFIC_WINDOW_MS = 50

/** 手动清零后保存的累计量基线，显示值 = 内核累计值 - 基线 */
const TRAFFIC_BASELINE_STORAGE_KEY = 'mihomo_traffic_baseline'
const EMPTY_BASELINE: TrafficBaseline = { up: 0, down: 0 }

export interface TrafficBaseline {
  up: number
  down: number
}

let lastTrafficSignature = ''
let lastTrafficTimestamp = 0

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
          appendData(parsed)
          next(null, parsed)
        } catch (error) {
          next(error, FALLBACK_TRAFFIC)
        }
      },
    }),
  })

  const [baseline, setBaseline] = useLocalStorage<TrafficBaseline>(
    TRAFFIC_BASELINE_STORAGE_KEY,
    EMPTY_BASELINE,
  )

  const rawTraffic = response.data
  const rawUpTotal = rawTraffic?.upTotal ?? 0
  const rawDownTotal = rawTraffic?.downTotal ?? 0
  const baselineUp = baseline?.up ?? 0
  const baselineDown = baseline?.down ?? 0

  // 内核重启后累计量会从 0 重新计数，此时旧基线失效，直接丢弃
  useEffect(() => {
    if (rawUpTotal < baselineUp || rawDownTotal < baselineDown) {
      setBaseline(EMPTY_BASELINE)
    }
  }, [rawUpTotal, rawDownTotal, baselineUp, baselineDown, setBaseline])

  const data = useMemo<ITrafficItem>(
    () => ({
      up: rawTraffic?.up ?? 0,
      down: rawTraffic?.down ?? 0,
      upTotal: Math.max(0, rawUpTotal - baselineUp),
      downTotal: Math.max(0, rawDownTotal - baselineDown),
    }),
    [rawTraffic, rawUpTotal, rawDownTotal, baselineUp, baselineDown],
  )

  /** 清零上传量与下载量的累计显示 */
  const resetTraffic = useCallback(() => {
    setBaseline({ up: rawUpTotal, down: rawDownTotal })
  }, [rawUpTotal, rawDownTotal, setBaseline])

  return { response, data, resetTraffic, refreshGetClashTraffic: refresh }
}
