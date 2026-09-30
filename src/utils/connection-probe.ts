import { cmdTestDelay } from '@/services/cmds'
import { formatHostPort, normalizeHost } from '@/utils/network'

/** 主动探测窗口：5s 内没有响应即视为被墙 */
export const HOST_PROBE_WINDOW_MS = 5_000

/** 后端 test_delay 出错时返回的哨兵值 */
const BACKEND_ERROR_DELAY = 10_000

export type HostProbeError = 'timeout' | 'unreachable'

export interface HostProbeSuccess {
  ok: true
  /** 探测耗时 */
  elapsed: number
}

export interface HostProbeFailure {
  ok: false
  error: HostProbeError
  elapsed: number
}

export type HostProbeResult = HostProbeSuccess | HostProbeFailure

export interface HostProbeTarget {
  host: string
  url: string
}

const SCHEME_PORTS: Record<string, number> = { http: 80, https: 443 }

/**
 * 探测地址：沿用这条连接自己的协议与目标端口。
 * 主机名无法用于 URL 时返回 null，由调用方直接记为不可达。
 */
export const probeUrlOf = (
  host: string,
  network?: string,
  destinationPort?: string,
): string | null => {
  const name = normalizeHost(host)
  if (!name) return null

  const scheme =
    (network ?? '').trim().toLowerCase() === 'http' ? 'http' : 'https'
  const parsedPort = Number.parseInt(destinationPort ?? '', 10)
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65_535
      ? parsedPort
      : (SCHEME_PORTS[scheme] ?? 443)

  return `${scheme}://${formatHostPort(name, port)}/`
}

/**
 * 探测单个主机：请求与 5s 窗口竞速。
 * 后端不带超时参数，超出窗口的响应到这里已被判为失败，结果会被丢弃。
 */
export const probeHost = async (
  target: HostProbeTarget,
): Promise<HostProbeResult> => {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    const outcome = await Promise.race([
      cmdTestDelay(target.url).then((delay) => ({ delay }) as const),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), HOST_PROBE_WINDOW_MS)
      }),
    ])
    const elapsed = Date.now() - startedAt

    if (!outcome) return { ok: false, error: 'timeout', elapsed }
    if (outcome.delay >= BACKEND_ERROR_DELAY) {
      return { ok: false, error: 'unreachable', elapsed }
    }
    return { ok: true, elapsed }
  } catch {
    return { ok: false, error: 'unreachable', elapsed: Date.now() - startedAt }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 批量探测：跳过重复主机，并发数受限 */
export const runHostProbes = async (
  targets: readonly HostProbeTarget[],
  options?: {
    concurrency?: number
    onResult?: (host: string, result: HostProbeResult) => void
    signal?: AbortSignal
  },
) => {
  const { concurrency = 8, onResult, signal } = options ?? {}
  const queued = new Set<string>()
  const unique = targets.filter((target) => {
    if (!target.host || queued.has(target.host)) return false
    queued.add(target.host)
    return true
  })

  let cursor = 0
  const worker = async () => {
    while (cursor < unique.length) {
      const target = unique[cursor]
      cursor += 1
      if (signal?.aborted) return

      const result = await probeHost(target)
      if (signal?.aborted) return
      onResult?.(target.host, result)
    }
  }

  const workers = Math.max(1, Math.min(concurrency, unique.length))
  await Promise.all(Array.from({ length: workers }, worker))
}
