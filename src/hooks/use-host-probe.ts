import { useCallback, useRef, useSyncExternalStore } from 'react'

import {
  runHostProbes,
  type HostProbeResult,
  type HostProbeTarget,
} from '@/utils/connection-probe'

export type HostProbeState =
  | { status: 'probing' }
  | { status: 'ok'; elapsed: number }
  | { status: 'fail'; error: 'timeout' | 'unreachable'; elapsed: number }

const probingState: HostProbeState = { status: 'probing' }

let hostProbeStates: ReadonlyMap<string, HostProbeState> = new Map()

const hostProbeListeners = new Set<() => void>()

const notifyHostProbeListeners = () => {
  hostProbeListeners.forEach((listener) => listener())
}

const updateHostProbeStates = (
  hosts: readonly string[],
  state: HostProbeState,
) => {
  const next = new Map(hostProbeStates)
  hosts.forEach((host) => next.set(host, state))
  hostProbeStates = next
  notifyHostProbeListeners()
}

const subscribeHostProbes = (listener: () => void) => {
  hostProbeListeners.add(listener)
  return () => {
    hostProbeListeners.delete(listener)
  }
}

const getHostProbeStates = () => hostProbeStates

let hostProbeAbort: AbortController | null = null

/** 页面卸载时中止尚未发出的探测，避免离开页面后继续打请求 */
const abortHostProbes = () => {
  hostProbeAbort?.abort()
  hostProbeAbort = null
}

/** 开始新一轮探测：中断上一轮尚未发出的请求 */
const beginHostProbes = () => {
  abortHostProbes()
  hostProbeAbort = new AbortController()
  return hostProbeAbort
}

const endHostProbes = (controller: AbortController) => {
  if (hostProbeAbort === controller) hostProbeAbort = null
}

export const useHostProbe = () => {
  const states = useSyncExternalStore(
    subscribeHostProbes,
    getHostProbeStates,
    getHostProbeStates,
  )

  const onResultRef = useRef<
    ((host: string, result: HostProbeResult) => void) | undefined
  >(undefined)

  const run = useCallback(
    async (
      targets: readonly HostProbeTarget[],
      onResult?: (host: string, result: HostProbeResult) => void,
    ) => {
      onResultRef.current = onResult
      const fresh = targets.filter(
        (target) => hostProbeStates.get(target.host)?.status !== 'probing',
      )
      if (fresh.length === 0) return

      const hosts = fresh.map((target) => target.host)
      updateHostProbeStates(hosts, probingState)

      const controller = beginHostProbes()

      try {
        await runHostProbes(fresh, {
          signal: controller.signal,
          onResult: (host, result) => {
            updateHostProbeStates(
              [host],
              result.ok
                ? { status: 'ok', elapsed: result.elapsed }
                : {
                    status: 'fail',
                    error: result.error,
                    elapsed: result.elapsed,
                  },
            )
            onResultRef.current?.(host, result)
          },
        })
      } finally {
        endHostProbes(controller)
      }
    },
    [],
  )

  return {
    states,
    run,
    stop: abortHostProbes,
  }
}
