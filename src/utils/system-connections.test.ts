import { describe, expect, it } from 'vitest'

import { mapSystemConnections } from './system-connections'

const systemRow = (
  overrides: Partial<ISystemConnectionsItem> = {},
): ISystemConnectionsItem => ({
  pid: 4242,
  process: 'chrome.exe',
  protocol: 'tcp',
  family: 'ipv4',
  localAddress: '192.168.1.10',
  localPort: 51000,
  remoteAddress: '1.1.1.1',
  remotePort: 443,
  state: 'ESTABLISHED',
  ...overrides,
})

const coreConnection = (
  overrides: Partial<IConnectionsItem['metadata']> = {},
): IConnectionsItem => ({
  id: 'core-1',
  metadata: {
    network: 'tcp',
    type: 'HTTP',
    host: 'example.com',
    sourceIP: '127.0.0.1',
    sourcePort: '51000',
    destinationPort: '443',
    destinationIP: '1.1.1.1',
    remoteDestination: '1.1.1.1',
    process: 'mihomo.exe',
    processPath: '',
    ...overrides,
  },
  upload: 0,
  download: 0,
  start: '',
  chains: ['DIRECT'],
  rule: 'MATCH',
  rulePayload: '',
})

describe('mapSystemConnections', () => {
  it('keeps rows without a core match as direct connections', () => {
    const [row] = mapSystemConnections([systemRow()], [])
    expect(row.chains).toEqual([])
    expect(row.rule).toBe('')
    expect(row.metadata.sourcePort).toBe('51000')
    expect(row.id).toContain('sys:tcp')
  })

  it('marks a row as core-routed when the local ports agree', () => {
    const [row] = mapSystemConnections([systemRow()], [coreConnection()])
    expect(row.chains).toEqual(['CORE'])
    expect(row.rule).toBe('MATCH')
  })

  it('keeps rows with a mismatched local port direct', () => {
    const [row] = mapSystemConnections(
      [systemRow()],
      [coreConnection({ sourcePort: '52000' })],
    )
    expect(row.chains).toEqual([])
  })

  it('marks rows owned by the core itself as core-routed', () => {
    const core = coreConnection({
      sourcePort: '52000',
      process: 'mihomo.exe',
    })
    const [row] = mapSystemConnections(
      [systemRow({ process: 'mihomo.exe' })],
      [core],
    )
    expect(row.chains).toEqual(['CORE'])
  })

  it('treats connectionless UDP rows as direct without a destination', () => {
    const [row] = mapSystemConnections(
      [
        systemRow({
          protocol: 'udp',
          remoteAddress: '*',
          remotePort: 0,
          process: '',
        }),
      ],
      [coreConnection()],
    )
    expect(row.chains).toEqual([])
    expect(row.metadata.destinationPort).toBe('')
    expect(row.metadata.process).toBe('4242')
  })
})
