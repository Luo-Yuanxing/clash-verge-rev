import { describe, expect, it } from 'vitest'

import type { ConnectionHistoryItem } from '@/hooks/use-connection-data'

import { mergeHistoryConnections } from './connection-history-merge'

const connection = (
  id: string,
  host: string,
  options: Partial<ConnectionHistoryItem> = {},
): ConnectionHistoryItem => ({
  id,
  metadata: {
    network: 'tcp',
    type: 'HTTPS',
    host,
    sourceIP: '127.0.0.1',
    sourcePort: '5000',
    destinationPort: '443',
    destinationIP: '',
    remoteDestination: '',
    process: '',
    processPath: '',
  },
  upload: 0,
  download: 0,
  start: '2026-01-01T00:00:00Z',
  chains: ['DIRECT'],
  rule: '',
  rulePayload: '',
  curUpload: 0,
  curDownload: 0,
  lastSeen: 0,
  active: false,
  ...options,
})

describe('mergeHistoryConnections', () => {
  it('merges the same host into one row', () => {
    const merged = mergeHistoryConnections([
      connection('a', 'example.com', {
        start: '2026-01-01T00:00:00Z',
        upload: 100,
        download: 200,
      }),
      connection('b', 'example.com', {
        start: '2026-01-01T01:00:00Z',
        upload: 10,
        download: 20,
      }),
      connection('c', 'other.com'),
    ])

    expect(merged.map((item) => item.id)).toEqual(['b', 'c'])
    expect(merged[0].upload).toBe(110)
    expect(merged[0].download).toBe(220)
  })

  it('keeps the most recent start time and the latest row identity', () => {
    const merged = mergeHistoryConnections([
      connection('old', 'example.com', { start: '2026-01-01T00:00:00Z' }),
      connection('new', 'example.com', { start: '2026-01-01T02:00:00Z' }),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('new')
    expect(merged[0].start).toBe('2026-01-01T02:00:00Z')
  })

  it('takes speeds from the connections that are still active', () => {
    const merged = mergeHistoryConnections([
      connection('live', 'example.com', {
        active: true,
        curUpload: 5,
        curDownload: 6,
      }),
      connection('gone', 'example.com', { curUpload: 99, curDownload: 99 }),
    ])

    expect(merged[0].active).toBe(true)
    expect(merged[0].curUpload).toBe(5)
    expect(merged[0].curDownload).toBe(6)
  })

  it('keeps the active row identity so the row is not treated as closed', () => {
    const merged = mergeHistoryConnections([
      connection('gone', 'example.com', { start: '2026-01-01T03:00:00Z' }),
      connection('live', 'example.com', { active: true }),
    ])

    expect(merged[0].id).toBe('live')
    expect(merged[0].start).toBe('2026-01-01T03:00:00Z')
  })

  it('reports zero speed when every connection is closed', () => {
    const merged = mergeHistoryConnections([
      connection('a', 'example.com', { curUpload: 12, curDownload: 34 }),
      connection('b', 'example.com', { curUpload: 56, curDownload: 78 }),
    ])

    expect(merged[0].active).toBe(false)
    expect(merged[0].curUpload).toBe(0)
    expect(merged[0].curDownload).toBe(0)
  })

  it('keeps hostless connections separate', () => {
    const merged = mergeHistoryConnections([
      connection('a', ''),
      connection('b', ''),
      connection('c', ''),
    ])

    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores host case when merging', () => {
    const merged = mergeHistoryConnections([
      connection('a', 'Example.COM'),
      connection('b', 'example.com'),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].metadata.host).toBe('example.com')
  })
})
