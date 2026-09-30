import { cmdTestHostResponse } from '@/services/cmds'
import { formatHostPort, normalizeHost } from '@/utils/network'

/** 主动探测窗口：5s 内没有响应即视为被墙 */
export const HOST_PROBE_WINDOW_MS = 5_000

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

/** 发起一次探测请求，resolve 即代表窗口内收到了响应 */
export type HostProbeRequest = (target: HostProbeTarget) => Promise<unknown>

export const requestHostResponse: HostProbeRequest = (target) =>
  cmdTestHostResponse(target.url, HOST_PROBE_WINDOW_MS)

/**
 * 探测单个主机：请求与 5s 窗口竞速。
 * 后端本身也按同一个窗口超时，这里的定时器保证窗口一到就出结果，
 * 不会出现「5s 之后几秒才变色」。
 */
export const probeHost = async (
  target: HostProbeTarget,
  request: HostProbeRequest = requestHostResponse,
): Promise<HostProbeResult> => {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    const responded = await Promise.race([
      request(target).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), HOST_PROBE_WINDOW_MS)
      }),
    ])
    const elapsed = Date.now() - startedAt

    return responded
      ? { ok: true, elapsed }
      : { ok: false, error: 'timeout', elapsed }
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
    request?: HostProbeRequest
  },
) => {
  const { concurrency = 8, onResult, signal, request } = options ?? {}
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

      const result = await probeHost(target, request)
      if (signal?.aborted) return
      onResult?.(target.host, result)
    }
  }

  const workers = Math.max(1, Math.min(concurrency, unique.length))
  await Promise.all(Array.from({ length: workers }, worker))
}
