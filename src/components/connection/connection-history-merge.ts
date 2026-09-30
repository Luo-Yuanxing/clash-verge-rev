import type { ConnectionHistoryItem } from '@/hooks/use-connection-data'

import { getConnectionStartTime } from './connection-row-view'

/** 合并键：同一主机压缩成一行，没有主机名的连接各自保留 */
const historyMergeKey = (connection: ConnectionHistoryItem) => {
  const host = connection.metadata.host.trim().toLowerCase()
  return host || `id:${connection.id}`
}

/**
 * 合并同一主机的两条历史连接：
 * 连接时间取最近的一次，上下行总量相加，速度只算仍在连接的那些。
 */
export const mergeHistoryConnection = (
  left: ConnectionHistoryItem,
  right: ConnectionHistoryItem,
): ConnectionHistoryItem => {
  const latest =
    getConnectionStartTime(right) >= getConnectionStartTime(left) ? right : left
  const live = left.active ? left : right.active ? right : null

  return {
    ...latest,
    // 仍在连接时以它为准，上层据此判断这一行是否还活着
    id: live?.id ?? latest.id,
    upload: left.upload + right.upload,
    download: left.download + right.download,
    // 都已关闭时这里自然为 0
    curUpload:
      (left.active ? (left.curUpload ?? 0) : 0) +
      (right.active ? (right.curUpload ?? 0) : 0),
    curDownload:
      (left.active ? (left.curDownload ?? 0) : 0) +
      (right.active ? (right.curDownload ?? 0) : 0),
    lastSeen: Math.max(left.lastSeen, right.lastSeen),
    active: left.active || right.active,
  }
}

/** 按主机压缩历史连接，行顺序沿用各主机首次出现的位置 */
export const mergeHistoryConnections = (
  connections: ConnectionHistoryItem[],
): ConnectionHistoryItem[] => {
  const merged: ConnectionHistoryItem[] = []
  const indexByKey = new Map<string, number>()

  for (const connection of connections) {
    const key = historyMergeKey(connection)
    const index = indexByKey.get(key)

    if (index === undefined) {
      indexByKey.set(key, merged.length)
      merged.push(connection)
      continue
    }

    const previous = merged[index]
    if (!previous) continue
    merged[index] = mergeHistoryConnection(previous, connection)
  }

  return merged
}
