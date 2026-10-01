import { Checkbox, Tooltip } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useLocalStorage } from 'foxact/use-local-storage'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type UIEvent as ReactUIEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import type { HostProbeState } from '@/hooks/use-host-probe'
import { HOST_PROBE_WINDOW_MS } from '@/utils/connection-probe'

import {
  ConnectionColumnManager,
  type ConnectionColumnOption,
} from './connection-column-manager'
import { RelativeTime } from './connection-relative-time'
import {
  formatConnectionChains,
  formatConnectionTraffic,
  getConnectionDestination,
  getConnectionDialFlags,
  getConnectionHost,
  getConnectionHostName,
  getConnectionProcess,
  getConnectionRule,
  getConnectionSource,
  getConnectionStartTime,
  getConnectionTypeLabel,
} from './connection-row-view'

const ROW_HEIGHT = 40
const SELECT_COLUMN_WIDTH = 40
const OVERSCAN_ROWS = 6
const MAX_ROW_SNAPSHOT_CACHE_SIZE = 2_000
/** 单元格左右各 8px 内边距 */
const CELL_PADDING_WIDTH = 16
const CELL_FONT_SIZE = 13
const MAX_TEXT_WIDTH_CACHE_SIZE = 2_000

const reconcileColumnOrder = (
  storedOrder: string[],
  baseFields: string[],
): string[] => {
  const filtered = storedOrder.filter((field) => baseFields.includes(field))
  const missing = baseFields.filter((field) => !filtered.includes(field))
  return [...filtered, ...missing]
}

type ColumnField =
  | 'host'
  | 'download'
  | 'upload'
  | 'dlSpeed'
  | 'ulSpeed'
  | 'chains'
  | 'rule'
  | 'process'
  | 'time'
  | 'source'
  | 'remoteDestination'
  | 'type'

/** 历史列表按主机聚合，不再展示上下行总量与实时速度这几列 */
const TRAFFIC_FIELDS: readonly ColumnField[] = [
  'download',
  'upload',
  'dlSpeed',
  'ulSpeed',
]

type VisibilityState = Record<string, boolean>

interface BaseColumn {
  field: ColumnField
  headerName: string
  /** 内容宽度量不出来时的兜底宽度 */
  width: number
  minWidth: number
  align?: 'left' | 'right'
  /** 默认不显示，需要时可在列设置里打开 */
  defaultHidden?: boolean
  cell?: (row: IConnectionsItem, snapshot: TableRowSnapshot) => string
}

interface DisplayColumn extends BaseColumn {
  size: number
}

interface SortingState {
  id: ColumnField
  desc: boolean
}

interface TableRowSnapshot {
  row: IConnectionsItem
  /** 生成该快照时是否隐藏主机端口，用于切换视图时重建 */
  hostWithoutPort: boolean
  host: string
  process: string
  source: string
  destination: string
  chainsText: string
  ruleText: string
  typeLabel: string
  startTime: number
  uploadText: string
  downloadText: string
  uploadSpeedText: string
  downloadSpeedText: string
}

/**
 * 列宽优先按内容算：内容量不出来时才用固定宽度。
 * 内容宽度不做 maxWidth 截断，否则链路这类长文本会被硬截成 “IPv6 • 剩”。
 */
const resolveColumnSize = (
  column: BaseColumn,
  autoSize: number | undefined,
) => {
  if (typeof autoSize === 'number' && Number.isFinite(autoSize)) {
    return Math.max(column.minWidth, autoSize)
  }

  return column.width
}

/** 列是否可见：手动开关优先，否则看默认隐藏 */
const isColumnVisible = (
  column: BaseColumn,
  model: VisibilityState | undefined,
) => {
  const explicit = model?.[column.field]
  if (explicit !== undefined) return explicit !== false
  return !column.defaultHidden
}

const sameStaticConnection = (
  left: IConnectionsItem,
  right: IConnectionsItem,
) =>
  left.metadata === right.metadata &&
  left.chains === right.chains &&
  left.rule === right.rule &&
  left.rulePayload === right.rulePayload &&
  left.start === right.start

const sameTrafficConnection = (
  left: IConnectionsItem,
  right: IConnectionsItem,
) =>
  left.upload === right.upload &&
  left.download === right.download &&
  left.curUpload === right.curUpload &&
  left.curDownload === right.curDownload

const createTableRowSnapshot = (
  row: IConnectionsItem,
  hostWithoutPort: boolean,
  previous?: TableRowSnapshot,
) => {
  const reusable =
    previous && previous.hostWithoutPort === hostWithoutPort
      ? previous
      : undefined
  const previousRow = reusable?.row
  const sameStatic = previousRow && sameStaticConnection(previousRow, row)
  const sameTraffic = previousRow && sameTrafficConnection(previousRow, row)

  if (sameStatic && sameTraffic && reusable) return reusable

  const upload = row.upload ?? 0
  const download = row.download ?? 0
  const curUpload = row.curUpload ?? 0
  const curDownload = row.curDownload ?? 0

  return {
    row,
    hostWithoutPort,
    host:
      sameStatic && reusable
        ? reusable.host
        : hostWithoutPort
          ? getConnectionHostName(row)
          : getConnectionHost(row),
    process:
      sameStatic && reusable ? reusable.process : getConnectionProcess(row),
    source: sameStatic && reusable ? reusable.source : getConnectionSource(row),
    destination:
      sameStatic && reusable
        ? reusable.destination
        : getConnectionDestination(row),
    chainsText:
      sameStatic && reusable
        ? reusable.chainsText
        : formatConnectionChains(row.chains),
    ruleText:
      sameStatic && reusable ? reusable.ruleText : getConnectionRule(row),
    typeLabel:
      sameStatic && reusable ? reusable.typeLabel : getConnectionTypeLabel(row),
    startTime:
      sameStatic && reusable ? reusable.startTime : getConnectionStartTime(row),
    uploadText:
      sameTraffic && reusable
        ? reusable.uploadText
        : formatConnectionTraffic(upload),
    downloadText:
      sameTraffic && reusable
        ? reusable.downloadText
        : formatConnectionTraffic(download),
    uploadSpeedText:
      sameTraffic && reusable
        ? reusable.uploadSpeedText
        : `${formatConnectionTraffic(curUpload)}/s`,
    downloadSpeedText:
      sameTraffic && reusable
        ? reusable.downloadSpeedText
        : `${formatConnectionTraffic(curDownload)}/s`,
  }
}

const getConnectionCellValue = (
  field: ColumnField,
  snapshot: TableRowSnapshot,
) => {
  switch (field) {
    case 'host':
      return snapshot.host
    case 'download':
      return snapshot.row.download ?? 0
    case 'upload':
      return snapshot.row.upload ?? 0
    case 'dlSpeed':
      return snapshot.row.curDownload ?? 0
    case 'ulSpeed':
      return snapshot.row.curUpload ?? 0
    case 'chains':
      return snapshot.chainsText
    case 'rule':
      return snapshot.ruleText
    case 'process':
      return snapshot.process
    case 'time':
      return snapshot.startTime
    case 'source':
      return snapshot.source
    case 'remoteDestination':
      return snapshot.destination
    case 'type':
      return snapshot.typeLabel
    default:
      return ''
  }
}

const compareConnectionCellValue = (
  field: ColumnField,
  left: IConnectionsItem,
  right: IConnectionsItem,
  getSnapshot: (row: IConnectionsItem) => TableRowSnapshot,
) => {
  const leftValue = getConnectionCellValue(field, getSnapshot(left))
  const rightValue = getConnectionCellValue(field, getSnapshot(right))

  if (typeof leftValue === 'number' || typeof rightValue === 'number') {
    return (Number(leftValue) || 0) - (Number(rightValue) || 0)
  }

  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''))
}

/** 主机行的探测键：与列里显示的内容一致 */
const hostKeyOf = (snapshot: TableRowSnapshot) =>
  snapshot.row.metadata.host.trim() ||
  snapshot.row.metadata.destinationIP?.trim() ||
  ''

/** dial 失败原因可能有多行（每次尝试一行） */
const reasonTextStyle = { whiteSpace: 'pre-line' } as const

const renderCell = (
  column: DisplayColumn,
  row: IConnectionsItem,
  snapshot: TableRowSnapshot,
  probeErrorColor: string,
  hostProbeError: string,
  getHostProbeState?: (host: string) => HostProbeState | undefined,
) => {
  if (column.cell) return column.cell(row, snapshot)
  if (column.field === 'time')
    return <RelativeTime start={snapshot.row.start} />

  const value = getConnectionCellValue(column.field, snapshot)
  if (column.field !== 'host') return value

  // 探测不到回应（连接失败或被墙）与内核报出的 dial 失败都在悬浮时说明原因
  const { failed, dialError } = getConnectionDialFlags(row)
  const probeFailed =
    getHostProbeState?.(hostKeyOf(snapshot))?.status === 'fail'
  if (!failed && !probeFailed) return value

  return (
    <Tooltip
      title={
        failed ? (
          <span style={reasonTextStyle}>{dialError ?? ''}</span>
        ) : (
          hostProbeError
        )
      }
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: probeErrorColor,
        }}
      >
        {value}
      </span>
    </Tooltip>
  )
}

const selectCellStyle = {
  boxSizing: 'border-box',
  flex: `0 0 ${SELECT_COLUMN_WIDTH}px`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const

interface RowComponentProps {
  row: IConnectionsItem
  columns: DisplayColumn[]
  onShowDetail: (id: string) => void
  getSnapshot: (row: IConnectionsItem) => TableRowSnapshot
  getHostProbeState: (host: string) => HostProbeState | undefined
  hostProbeError: string
  probeErrorColor: string
  borderColor: string
  virtualTop: number
  selected: boolean
  onToggleSelect: (id: string) => void
}

const RowComponent = memo(
  function RowComponent({
    row,
    columns,
    onShowDetail,
    getSnapshot,
    getHostProbeState,
    hostProbeError,
    probeErrorColor,
    borderColor,
    virtualTop,
    selected,
    onToggleSelect,
  }: RowComponentProps) {
    const handleClick = useCallback(
      () => onShowDetail(row.id),
      [onShowDetail, row.id],
    )
    const handleToggleSelect = useCallback(
      () => onToggleSelect(row.id),
      [onToggleSelect, row.id],
    )
    const stopPropagation = useCallback(
      (event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation(),
      [],
    )
    const snapshot = getSnapshot(row)

    return (
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: virtualTop,
          left: 0,
          right: 0,
          height: ROW_HEIGHT,
          cursor: 'pointer',
          borderBottom: `1px solid ${borderColor}`,
        }}
        onClick={handleClick}
      >
        <div style={selectCellStyle} onClick={stopPropagation}>
          <Checkbox
            size="small"
            checked={selected}
            onChange={handleToggleSelect}
          />
        </div>
        {columns.map((column) => (
          <div
            key={column.field}
            style={{
              boxSizing: 'border-box',
              flex: `0 0 ${column.size}px`,
              minWidth: column.minWidth,
              padding: '8px',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                column.align === 'right' ? 'flex-end' : 'flex-start',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {renderCell(
              column,
              row,
              snapshot,
              probeErrorColor,
              hostProbeError,
              getHostProbeState,
            )}
          </div>
        ))}
      </div>
    )
  },
  (prev, next) =>
    prev.row === next.row &&
    prev.columns === next.columns &&
    prev.virtualTop === next.virtualTop &&
    prev.onShowDetail === next.onShowDetail &&
    prev.getSnapshot === next.getSnapshot &&
    prev.getHostProbeState === next.getHostProbeState &&
    prev.hostProbeError === next.hostProbeError &&
    prev.probeErrorColor === next.probeErrorColor &&
    prev.borderColor === next.borderColor &&
    prev.selected === next.selected &&
    prev.onToggleSelect === next.onToggleSelect,
)

interface Props {
  connections: IConnectionsItem[]
  onShowDetail: (id: string) => void
  columnManagerOpen: boolean
  onCloseColumnManager: () => void
  selectedIds: ReadonlySet<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: (ids: string[]) => void
  /** 主动探测结果：未响应（连接失败或被墙）的主机标红 */
  getHostProbeState: (host: string) => HostProbeState | undefined
  /** 历史列表按域名聚合，主机列只显示域名，不带目标端口 */
  hostWithoutPort?: boolean
  /** 历史列表不展示流量相关的列 */
  hideTrafficColumns?: boolean
}

export const ConnectionTable = (props: Props) => {
  const {
    connections,
    onShowDetail: rawOnShowDetail,
    columnManagerOpen,
    onCloseColumnManager,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    getHostProbeState,
    hostWithoutPort = false,
    hideTrafficColumns = false,
  } = props
  const onShowDetailRef = useRef(rawOnShowDetail)
  onShowDetailRef.current = rawOnShowDetail
  const onShowDetail = useCallback(
    (id: string) => onShowDetailRef.current(id),
    [],
  )
  const { t } = useTranslation()
  const theme = useTheme()
  const hostProbeError = t('connections.components.probe.error', {
    seconds: HOST_PROBE_WINDOW_MS / 1000,
  })

  const [columnVisibilityModel, setColumnVisibilityModel] =
    useLocalStorage<VisibilityState>(
      'connection-table-visibility',
      {},
      {
        serializer: JSON.stringify,
        deserializer: (value) => {
          try {
            const parsed = JSON.parse(value)
            if (parsed && typeof parsed === 'object') return parsed
          } catch (err) {
            console.warn('Failed to parse connection-table-visibility', err)
          }
          return {}
        },
      },
    )

  const [columnOrder, setColumnOrder] = useLocalStorage<string[]>(
    'connection-table-order',
    [],
    {
      serializer: JSON.stringify,
      deserializer: (value) => {
        try {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed)) return parsed
        } catch (err) {
          console.warn('Failed to parse connection-table-order', err)
        }
        return []
      },
    },
  )

  const baseColumns = useMemo<BaseColumn[]>(() => {
    return [
      {
        field: 'host',
        headerName: t('connections.components.fields.host'),
        width: 180,
        minWidth: 140,
      },
      {
        field: 'download',
        headerName: t('shared.labels.downloaded'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.downloadText,
      },
      {
        field: 'upload',
        headerName: t('shared.labels.uploaded'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.uploadText,
      },
      {
        field: 'dlSpeed',
        headerName: t('connections.components.fields.dlSpeed'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.downloadSpeedText,
      },
      {
        field: 'ulSpeed',
        headerName: t('connections.components.fields.ulSpeed'),
        width: 76,
        minWidth: 60,
        align: 'right',
        cell: (_, snapshot) => snapshot.uploadSpeedText,
      },
      {
        field: 'chains',
        headerName: t('connections.components.fields.chains'),
        width: 56,
        minWidth: 48,
      },
      {
        field: 'rule',
        headerName: t('connections.components.fields.rule'),
        width: 220,
        minWidth: 80,
      },
      {
        field: 'process',
        headerName: t('connections.components.fields.process'),
        width: 180,
        minWidth: 80,
      },
      {
        field: 'time',
        headerName: t('connections.components.fields.time'),
        width: 100,
        minWidth: 80,
        align: 'right',
      },
      {
        field: 'source',
        headerName: t('connections.components.fields.source'),
        width: 160,
        minWidth: 120,
        defaultHidden: true,
      },
      {
        field: 'remoteDestination',
        headerName: t('connections.components.fields.destination'),
        width: 160,
        minWidth: 120,
        defaultHidden: true,
      },
      {
        field: 'type',
        headerName: t('connections.components.fields.type'),
        width: 120,
        minWidth: 80,
        defaultHidden: true,
      },
    ]
  }, [t])

  const hiddenFields = hideTrafficColumns ? TRAFFIC_FIELDS : undefined

  /** 实际可用的列：隐藏的列既不显示，也不参与列设置 */
  const availableColumns = useMemo(
    () =>
      hiddenFields
        ? baseColumns.filter((column) => !hiddenFields.includes(column.field))
        : baseColumns,
    [baseColumns, hiddenFields],
  )

  useEffect(() => {
    setColumnOrder((prevValue) => {
      const baseFields = baseColumns.map((col) => col.field)
      const prev = Array.isArray(prevValue) ? prevValue : []
      const reconciled = reconcileColumnOrder(prev, baseFields)
      if (
        reconciled.length === prev.length &&
        reconciled.every((field, i) => field === prev[i])
      ) {
        return prevValue
      }
      return reconciled
    })
  }, [baseColumns, setColumnOrder])

  const rowSnapshotCacheRef = useRef(new Map<string, TableRowSnapshot>())
  const getRowSnapshot = useCallback(
    (row: IConnectionsItem) => {
      const cache = rowSnapshotCacheRef.current
      const snapshot = createTableRowSnapshot(
        row,
        hostWithoutPort,
        cache.get(row.id),
      )
      cache.set(row.id, snapshot)
      if (cache.size > MAX_ROW_SNAPSHOT_CACHE_SIZE) {
        const oldestKey = cache.keys().next().value
        if (oldestKey && oldestKey !== row.id) cache.delete(oldestKey)
      }
      return snapshot
    },
    [hostWithoutPort],
  )

  const orderedColumns = useMemo(() => {
    const baseFields = baseColumns.map((column) => column.field)
    const reconciledOrder = reconcileColumnOrder(columnOrder, baseFields)
    const byField: Partial<Record<ColumnField, BaseColumn>> = {}
    availableColumns.forEach((column) => {
      byField[column.field] = column
    })

    return reconciledOrder
      .map((field) => byField[field as ColumnField])
      .filter((column): column is BaseColumn => Boolean(column))
  }, [availableColumns, baseColumns, columnOrder])

  /** 测量文本实际宽度，结果按文本缓存 */
  const measureText = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return null

    context.font = `${CELL_FONT_SIZE}px ${theme.typography.fontFamily}`
    const cache = new Map<string, number>()

    return (text: string) => {
      const cached = cache.get(text)
      if (cached !== undefined) return cached

      const width = context.measureText(text).width
      if (cache.size < MAX_TEXT_WIDTH_CACHE_SIZE) cache.set(text, width)
      return width
    }
  }, [theme.typography.fontFamily])

  /** 列宽 = 列名与当前列表内容里最宽的一项，保证文本完整显示 */
  const autoColumnWidths = useMemo(() => {
    const widths = new Map<ColumnField, number>()
    if (!measureText) return widths

    for (const column of availableColumns) {
      let width = measureText(column.headerName) + CELL_PADDING_WIDTH

      for (const connection of connections) {
        const text = String(
          getConnectionCellValue(column.field, getRowSnapshot(connection)) ??
            '',
        )
        const cellWidth = measureText(text) + CELL_PADDING_WIDTH
        if (cellWidth > width) width = cellWidth
      }

      widths.set(column.field, width)
    }

    return widths
  }, [availableColumns, connections, getRowSnapshot, measureText])

  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 0,
    width: 0,
  })

  /**
   * 列宽先按内容算出：内容宽过窗口时整表横向滚动，宽裕时按比例分配、最后一列吸收余量。
   * 溢出的情况下谁也不压缩，保证主机与链路文本都完整。
   */
  const visibleColumns = useMemo(() => {
    const columns = orderedColumns
      .filter((column) => isColumnVisible(column, columnVisibilityModel))
      .map((column) => ({
        ...column,
        size: resolveColumnSize(column, autoColumnWidths.get(column.field)),
      }))

    const total = columns.reduce((sum, column) => sum + column.size, 0)
    const available = viewport.width - SELECT_COLUMN_WIDTH
    if (total === 0 || available <= total) return columns

    const scale = available / total
    let used = 0
    return columns.map((column, index) => {
      // 最后一列吸收取整余量，避免总和超出容器
      if (index === columns.length - 1) {
        return { ...column, size: available - used }
      }

      const size = Math.floor(column.size * scale)
      used += size
      return { ...column, size }
    })
  }, [columnVisibilityModel, orderedColumns, autoColumnWidths, viewport.width])

  const [sorting, setSorting] = useState<SortingState | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const updateViewport = useCallback((element: HTMLDivElement) => {
    setViewport((current) => {
      const next = {
        scrollTop: element.scrollTop,
        height: element.clientHeight,
        width: element.clientWidth,
      }
      return current.scrollTop === next.scrollTop &&
        current.height === next.height &&
        current.width === next.width
        ? current
        : next
    })
  }, [])

  const setScrollContainer = useCallback(
    (element: HTMLDivElement | null) => {
      scrollContainerRef.current = element
      if (element) updateViewport(element)
    },
    [updateViewport],
  )

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateViewport(element)
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }

    const observer = new ResizeObserver(() => updateViewport(element))
    observer.observe(element)
    return () => observer.disconnect()
  }, [updateViewport])

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return

    const maxScrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight,
    )
    if (element.scrollTop <= maxScrollTop) return

    element.scrollTop = maxScrollTop
  }, [connections.length])

  useEffect(() => {
    const cache = rowSnapshotCacheRef.current
    if (cache.size <= connections.length + OVERSCAN_ROWS * 4) return

    const activeIds = new Set<string>()
    for (let i = 0; i < connections.length; i++) {
      activeIds.add(connections[i].id)
    }
    cache.forEach((_, id) => {
      if (!activeIds.has(id)) cache.delete(id)
    })
  }, [connections])

  const sortedConnections = useMemo(() => {
    if (!sorting) return connections
    if (hiddenFields?.includes(sorting.id)) return connections

    const direction = sorting.desc ? -1 : 1
    return [...connections].sort(
      (left, right) =>
        compareConnectionCellValue(sorting.id, left, right, getRowSnapshot) *
        direction,
    )
  }, [connections, hiddenFields, sorting, getRowSnapshot])

  const tableWidth = useMemo(
    () =>
      visibleColumns.reduce((total, column) => total + column.size, 0) +
      SELECT_COLUMN_WIDTH,
    [visibleColumns],
  )

  const selectedCount = useMemo(() => {
    let count = 0
    for (const connection of connections) {
      if (selectedIds.has(connection.id)) count += 1
    }
    return count
  }, [connections, selectedIds])

  const allSelected =
    connections.length > 0 && selectedCount === connections.length
  const partiallySelected = selectedCount > 0 && !allSelected

  const handleToggleSelectAll = useCallback(() => {
    onToggleSelectAll(connections.map((connection) => connection.id))
  }, [connections, onToggleSelectAll])
  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      updateViewport(event.currentTarget)
    },
    [updateViewport],
  )

  const bodyScrollTop = Math.max(0, viewport.scrollTop - ROW_HEIGHT)
  const firstVisibleRow = Math.min(
    sortedConnections.length,
    Math.max(0, Math.floor(bodyScrollTop / ROW_HEIGHT) - OVERSCAN_ROWS),
  )
  const lastVisibleRow = Math.max(
    firstVisibleRow,
    Math.min(
      sortedConnections.length,
      Math.ceil((bodyScrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN_ROWS,
    ),
  )
  const totalRowsHeight = sortedConnections.length * ROW_HEIGHT

  const toggleSorting = useCallback((field: ColumnField) => {
    setSorting((current) => {
      if (!current || current.id !== field) return { id: field, desc: false }
      if (!current.desc) return { id: field, desc: true }
      return null
    })
  }, [])

  const setColumnVisibility = useCallback(
    (field: ColumnField, visible: boolean) => {
      setColumnVisibilityModel((prev) => {
        const current = { ...(prev ?? {}) }
        const visibleCount = availableColumns.reduce(
          (count, column) =>
            column.field === field
              ? count + (visible ? 1 : 0)
              : count + (isColumnVisible(column, current) ? 1 : 0),
          0,
        )
        if (visibleCount === 0) return prev

        current[field] = visible
        return current
      })
    },
    [availableColumns, setColumnVisibilityModel],
  )

  const handleManagerOrderChange = useCallback(
    (order: string[]) => {
      const baseFields = baseColumns.map((col) => col.field)

      if (!hiddenFields) {
        setColumnOrder(reconcileColumnOrder(order, baseFields))
        return
      }

      // 隐藏的列留在原位，其余列按新顺序依次填进空位
      let index = 0
      setColumnOrder(
        reconcileColumnOrder(columnOrder, baseFields).map((field) =>
          hiddenFields.includes(field as ColumnField)
            ? field
            : (order[index++] ?? field),
        ),
      )
    },
    [baseColumns, columnOrder, hiddenFields, setColumnOrder],
  )

  const handleResetColumns = useCallback(() => {
    setColumnVisibilityModel({})
    setColumnOrder(baseColumns.map((column) => column.field))
    setSorting(null)
  }, [baseColumns, setColumnOrder, setColumnVisibilityModel])

  const managerColumns = useMemo<ConnectionColumnOption[]>(() => {
    return orderedColumns.map((column) => ({
      id: column.field,
      label: column.headerName,
      visible: isColumnVisible(column, columnVisibilityModel),
      toggleVisibility: (visible) => setColumnVisibility(column.field, visible),
    }))
  }, [columnVisibilityModel, orderedColumns, setColumnVisibility])

  const borderColor = theme.palette.divider
  const headerBackground = theme.palette.background.paper
  const textSecondary = theme.palette.text.secondary

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          fontFamily: theme.typography.fontFamily,
        }}
      >
        <div
          ref={setScrollContainer}
          onScroll={handleScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              minWidth: '100%',
              width: tableWidth,
            }}
          >
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  borderBottom: `1px solid ${borderColor}`,
                  backgroundColor: headerBackground,
                }}
              >
                <div style={selectCellStyle}>
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={partiallySelected}
                    onChange={handleToggleSelectAll}
                  />
                </div>
                {visibleColumns.map((column) => (
                  <div
                    key={column.field}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      boxSizing: 'border-box',
                      flex: `0 0 ${column.size}px`,
                      minWidth: column.minWidth,
                      fontSize: 13,
                      fontWeight: 600,
                      color: textSecondary,
                      userSelect: 'none',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSorting(column.field)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent:
                          column.align === 'right' ? 'flex-end' : 'flex-start',
                        gap: 4,
                        padding: 8,
                        border: 0,
                        background: 'transparent',
                        color: 'inherit',
                        font: 'inherit',
                        textAlign: column.align === 'right' ? 'right' : 'left',
                        cursor: 'pointer',
                      }}
                    >
                      {column.headerName}
                      {sorting?.id === column.field
                        ? sorting.desc
                          ? '▼'
                          : '▲'
                        : null}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                position: 'relative',
                height: totalRowsHeight,
              }}
            >
              {Array.from(
                { length: lastVisibleRow - firstVisibleRow },
                (_, offset) => {
                  const index = firstVisibleRow + offset
                  const row = sortedConnections[index]
                  if (!row) return null

                  return (
                    <RowComponent
                      key={row.id}
                      row={row}
                      columns={visibleColumns}
                      onShowDetail={onShowDetail}
                      getSnapshot={getRowSnapshot}
                      getHostProbeState={getHostProbeState}
                      hostProbeError={hostProbeError}
                      probeErrorColor={theme.palette.error.main}
                      borderColor={borderColor}
                      virtualTop={index * ROW_HEIGHT}
                      selected={selectedIds.has(row.id)}
                      onToggleSelect={onToggleSelect}
                    />
                  )
                },
              )}
            </div>
          </div>
        </div>
      </div>
      <ConnectionColumnManager
        open={columnManagerOpen}
        columns={managerColumns}
        onClose={onCloseColumnManager}
        onOrderChange={handleManagerOrderChange}
        onReset={handleResetColumns}
      />
    </>
  )
}
