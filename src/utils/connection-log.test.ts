import { describe, expect, it } from 'vitest'

import { parseConnectionLogLine } from './connection-log'

const line = (message: string) =>
  `time="2026-09-21T02:04:58.599456900+08:00" level=info msg="${message}"`

describe('parseConnectionLogLine', () => {
  it('parses a tcp line with rule payload, process and proxy chain', () => {
    const record = parseConnectionLogLine(
      line(
        '[TCP] 127.0.0.1:63006(chrome.exe) --> zh.aznudelive.com:443 match DomainKeyword(aznude) using Proxy[IPv6 新加坡]',
      ),
      0,
    )

    expect(record?.metadata.host).toBe('zh.aznudelive.com')
    expect(record?.metadata.destinationPort).toBe('443')
    expect(record?.metadata.sourceIP).toBe('127.0.0.1')
    expect(record?.metadata.sourcePort).toBe('63006')
    expect(record?.metadata.process).toBe('chrome.exe')
    expect(record?.rule).toBe('DomainKeyword')
    expect(record?.rulePayload).toBe('aznude')
    expect(record?.chains).toEqual(['Proxy', 'IPv6 新加坡'])
    expect(record?.startAt).toBe(Date.parse('2026-09-21T02:04:58.599+08:00'))
    expect(record?.active).toBe(false)
  })

  it('keeps a plain outbound as the only chain entry', () => {
    const record = parseConnectionLogLine(
      line(
        '[TCP] 127.0.0.1:52000(chrome.exe) --> x.com:443 match Match using DIRECT',
      ),
      0,
    )

    expect(record?.chains).toEqual(['DIRECT'])
    expect(record?.rulePayload).toBe('')
  })

  it('parses udp lines and bracketed ipv6 destinations', () => {
    const record = parseConnectionLogLine(
      line(
        '[UDP] 127.0.0.1:5000 --> [2606:4700::1111]:443 match GeoIP(CN) using Proxy[DIRECT]',
      ),
      7,
    )

    expect(record?.metadata.network).toBe('udp')
    expect(record?.metadata.host).toBe('2606:4700::1111')
    expect(record?.metadata.destinationPort).toBe('443')
  })

  it('falls back to the receive time when the line carries no timestamp', () => {
    const record = parseConnectionLogLine(
      '[TCP] 127.0.0.1:1 --> example.com:80 match Match using DIRECT',
      999,
    )

    expect(record?.startAt).toBe(999)
    expect(record?.lastSeen).toBe(999)
  })

  it('records a failed dial, which a successful line never covers', () => {
    const record = parseConnectionLogLine(
      line(
        '[TCP] dial DIRECT (match Match/) 127.0.0.1:52341 --> web.telegram.org:443 error: connect failed: dial tcp 157.240.20.8:443: i/o timeout',
      ),
      0,
    )

    expect(record?.failed).toBe(true)
    expect(record?.dialError).toBe(
      'connect failed: dial tcp 157.240.20.8:443: i/o timeout',
    )
    expect(record?.metadata.host).toBe('web.telegram.org')
    expect(record?.metadata.sourcePort).toBe('52341')
    expect(record?.rule).toBe('Match')
    expect(record?.rulePayload).toBe('')
    expect(record?.chains).toEqual(['DIRECT'])
    expect(record?.active).toBe(false)
    expect(record?.startAt).toBe(Date.parse('2026-09-21T02:04:58.599+08:00'))
  })

  it('parses a failed dial with an ipv6 source and no rule', () => {
    const record = parseConnectionLogLine(
      line(
        '[TCP] dial Proxy[HK-01] [fdfe:dcba:9876::1]:52755 --> web.telegram.org:443 error: connect failed: dial tcp [2a03:2880:f107:83:face:b00c:0:25de]:443: i/o timeout',
      ),
      5,
    )

    expect(record?.failed).toBe(true)
    expect(record?.metadata.sourceIP).toBe('fdfe:dcba:9876::1')
    expect(record?.metadata.sourcePort).toBe('52755')
    expect(record?.rule).toBe('')
    expect(record?.chains).toEqual(['Proxy', 'HK-01'])
  })

  it('ignores unrelated log lines', () => {
    expect(
      parseConnectionLogLine(line('[DNS] resolve www.google.com'), 0),
    ).toBeNull()
    expect(parseConnectionLogLine('not a log line', 0)).toBeNull()
  })
})
