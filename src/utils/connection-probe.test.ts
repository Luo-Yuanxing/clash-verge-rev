import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  HOST_PROBE_WINDOW_MS,
  probeHost,
  probeUrlOf,
  type HostProbeRequest,
  type HostProbeTarget,
} from './connection-probe'

const target: HostProbeTarget = {
  host: 'mtalk.google.com',
  url: 'https://mtalk.google.com:5228/',
}

describe('probeUrlOf', () => {
  it('沿用连接的协议与目标端口', () => {
    expect(probeUrlOf('mtalk.google.com', 'tcp', '5228')).toBe(
      'https://mtalk.google.com:5228/',
    )
    expect(probeUrlOf('example.com', 'http', '80')).toBe(
      'http://example.com:80/',
    )
  })

  it('端口缺失或非法时退回协议默认端口', () => {
    expect(probeUrlOf('example.com', 'tcp', '')).toBe(
      'https://example.com:443/',
    )
    expect(probeUrlOf('example.com', 'http', 'abc')).toBe(
      'http://example.com:80/',
    )
    expect(probeUrlOf('example.com', 'tcp', '70000')).toBe(
      'https://example.com:443/',
    )
  })

  it('IPv6 主机加方括号，非法主机名返回 null', () => {
    expect(probeUrlOf('2001:db8::1', 'tcp', '443')).toBe(
      'https://[2001:db8::1]:443/',
    )
    expect(probeUrlOf('not a host', 'tcp', '443')).toBeNull()
  })
})

describe('probeHost', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('窗口内有响应算成功', async () => {
    const request: HostProbeRequest = () =>
      new Promise((resolve) =>
        setTimeout(resolve, HOST_PROBE_WINDOW_MS - 1_000),
      )

    const result = probeHost(target, request)
    await vi.advanceTimersByTimeAsync(HOST_PROBE_WINDOW_MS - 1_000)

    await expect(result).resolves.toEqual({ ok: true, elapsed: 4_000 })
  })

  it('5s 窗口一到就判超时，不等迟到的响应', async () => {
    // 模拟彻底没有回应：请求要 30s 后才 settle
    const request: HostProbeRequest = () =>
      new Promise((resolve) => setTimeout(resolve, 30_000))

    const result = probeHost(target, request)
    await vi.advanceTimersByTimeAsync(HOST_PROBE_WINDOW_MS)

    await expect(result).resolves.toEqual({
      ok: false,
      error: 'timeout',
      elapsed: HOST_PROBE_WINDOW_MS,
    })
  })

  it('请求失败算不可达', async () => {
    const request: HostProbeRequest = () =>
      Promise.reject(new Error('connect failed'))

    await expect(probeHost(target, request)).resolves.toMatchObject({
      ok: false,
      error: 'unreachable',
    })
  })
})
