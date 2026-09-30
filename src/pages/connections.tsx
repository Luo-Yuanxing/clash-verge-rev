import {
  DeleteForeverRounded,
  FilterAltRounded,
  NetworkCheckRounded,
  PauseRounded,
  PlayArrowRounded,
  RuleRounded,
  TableChartRounded,
  TableRowsRounded,
  ViewColumnRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  ButtonGroup,
  Fab,
  IconButton,
  MenuItem,
  Tooltip,
  Zoom,
} from '@mui/material'
import { useLockFn, useInterval } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import {
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  BaseStyledSelect,
  type SearchState,
  VirtualList,
} from '@/components/base'
import {
  ConnectionDetail,
  ConnectionDetailRef,
} from '@/components/connection/connection-detail'
import { ConnectionFilterDialog } from '@/components/connection/connection-filter-dialog'
import { mergeHistoryConnections } from '@/components/connection/connection-history-merge'
import { ConnectionRowItem } from '@/components/connection/connection-row-item'
import {
  getConnectionStartTime,
  useConnectionRowViews,
} from '@/components/connection/connection-row-view'
import { ConnectionRuleDialog } from '@/components/connection/connection-rule-dialog'
import { ConnectionTable } from '@/components/connection/connection-table'
import {
  DEFAULT_HISTORY_WINDOW_MS,
  pruneConnectionHistory,
  setConnectionHistoryWindow,
  useConnectionData,
} from '@/hooks/use-connection-data'
import {
  HISTORY_WINDOW_OPTIONS,
  useConnectionSetting,
} from '@/hooks/use-connection-setting'
import { useCustomRuleCoverage } from '@/hooks/use-custom-rule-coverage'
import { useHostProbe } from '@/hooks/use-host-probe'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVisibility } from '@/hooks/use-visibility'
import { type HostProbeTarget, probeUrlOf } from '@/utils/connection-probe'
import { isIpAddress } from '@/utils/network'
import parseTraffic from '@/utils/parse-traffic'

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[]

const ORDER_OPTIONS = [
  {
    id: 'default',
    labelKey: 'connections.components.order.default',
    fn: (list: IConnectionsItem[]) =>
      list.sort(
        (a, b) => getConnectionStartTime(b) - getConnectionStartTime(a),
      ),
  },
  {
    id: 'uploadSpeed',
    labelKey: 'connections.components.order.uploadSpeed',
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => (b.curUpload ?? 0) - (a.curUpload ?? 0)),
  },
  {
    id: 'downloadSpeed',
    labelKey: 'connections.components.order.downloadSpeed',
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => (b.curDownload ?? 0) - (a.curDownload ?? 0)),
  },
] as const

type OrderKey = (typeof ORDER_OPTIONS)[number]['id']

type ConnectionsType = 'active' | 'closed' | 'history'

const orderFunctionMap = ORDER_OPTIONS.reduce<Record<OrderKey, OrderFunc>>(
  (acc, option) => {
    acc[option.id] = option.fn
    return acc
  },
  {} as Record<OrderKey, OrderFunc>,
)

const EMPTY_CONNECTIONS: IConnectionsItem[] = []

/** 工具条上的按钮与下拉不参与压缩，空间不够时整块换到下一行 */
const TOOLBAR_ITEM_SHRINK = { flexShrink: 0 } as const

/** 目标是不是裸 IP：没有主机名，或主机名本身就是 IP */
const isIpConnection = (connection: IConnectionsItem) => {
  const { host, destinationIP, remoteDestination } = connection.metadata
  const target =
    host.trim() || destinationIP?.trim() || remoteDestination?.trim() || ''
  return Boolean(target) && isIpAddress(target)
}

/** 探测键与列表里显示的主机一致：优先主机名，其次目标 IP */
const hostKeyOfConnection = (connection: IConnectionsItem) =>
  connection.metadata.host.trim() ||
  connection.metadata.destinationIP?.trim() ||
  ''

const ConnectionsPage = () => {
  const { t } = useTranslation()
  const pageVisible = useVisibility()
  const [match, setMatch] = useState<(input: string) => boolean>(
    () => () => true,
  )
  const [hasSearch, setHasSearch] = useState(false)
  const [curOrderOpt, setCurOrderOpt] = useState<OrderKey>('default')
  const [connectionsType, setConnectionsType] =
    useState<ConnectionsType>('history')

  const {
    response: { data: connections },
    clearClosedConnections,
    clearHistoryConnections,
  } = useConnectionData({ enabled: pageVisible })
  const { data: traffic } = useTrafficData({ enabled: pageVisible })

  const [setting, setSetting] = useConnectionSetting()

  const isHostCovered = useCustomRuleCoverage(pageVisible)

  const historyWindowMs = setting.historyWindowMs ?? DEFAULT_HISTORY_WINDOW_MS
  /** 默认排除裸 IP 的历史记录 */
  const excludeIpConnections = setting.excludeIpConnections ?? true
  /** 默认隐藏主机已被自定义规则覆盖的记录 */
  const hideCovered = setting.hideCoveredHosts ?? true

  useEffect(() => {
    setConnectionHistoryWindow(historyWindowMs)
  }, [historyWindowMs])

  useEffect(() => {
    pruneConnectionHistory()
  }, [])

  const isTableLayout = setting.layout === 'table'

  const [isColumnManagerOpen, setIsColumnManagerOpen] = useState(false)
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const frozenRef = useRef<{
    activeConnections: IConnectionsItem[]
    closedConnections: IConnectionsItem[]
    historyConnections: IConnectionsItem[]
  }>({
    activeConnections: [],
    closedConnections: [],
    historyConnections: [],
  })

  /** 历史列表：可选排除裸 IP 记录，再按主机压缩（连接时间取最近、流量累加） */
  const historyConnections = useMemo(() => {
    const source = connections?.historyConnections ?? EMPTY_CONNECTIONS
    return mergeHistoryConnections(
      excludeIpConnections
        ? source.filter((connection) => !isIpConnection(connection))
        : source,
    )
  }, [connections, excludeIpConnections])

  const togglePause = useCallback(() => {
    if (!paused) {
      frozenRef.current = {
        activeConnections: connections?.activeConnections ?? EMPTY_CONNECTIONS,
        closedConnections: connections?.closedConnections ?? EMPTY_CONNECTIONS,
        historyConnections,
      }
      setPaused(true)
      return
    }
    setPaused(false)
  }, [paused, connections, historyConnections])

  useInterval(
    () => pruneConnectionHistory(),
    connectionsType === 'history' && !paused ? 1_000 : undefined,
  )

  const viewConnections = useMemo(
    () =>
      paused
        ? frozenRef.current
        : {
            activeConnections:
              connections?.activeConnections ?? EMPTY_CONNECTIONS,
            closedConnections:
              connections?.closedConnections ?? EMPTY_CONNECTIONS,
            historyConnections,
          },
    [paused, connections, historyConnections],
  )

  const selectedConnections =
    connectionsType === 'history'
      ? viewConnections.historyConnections
      : connectionsType === 'closed'
        ? viewConnections.closedConnections
        : viewConnections.activeConnections

  const activeConnectionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const conn of viewConnections.activeConnections) ids.add(conn.id)
    return ids
  }, [viewConnections])

  const filterConn = useMemo(() => {
    const orderFunc = orderFunctionMap[curOrderOpt]

    let list = selectedConnections
    if (connectionsType === 'history' && hideCovered) {
      list = list.filter((conn) => !isHostCovered(conn.metadata?.host ?? ''))
    }

    if (isTableLayout && !hasSearch) return list
    if (!hasSearch) return orderFunc([...list])

    const matchConns = list.filter((conn) => {
      const { host, destinationIP, process } = conn.metadata
      return (
        match(host || '') || match(destinationIP || '') || match(process || '')
      )
    })

    return orderFunc ? orderFunc(matchConns) : matchConns
  }, [
    selectedConnections,
    isTableLayout,
    hasSearch,
    match,
    curOrderOpt,
    connectionsType,
    hideCovered,
    isHostCovered,
  ])

  const displayRows = useConnectionRowViews(
    isTableLayout ? EMPTY_CONNECTIONS : filterConn,
    { hostWithoutPort: connectionsType === 'history' },
  )

  const { states: hostProbeStates, run: runHostProbe } = useHostProbe()

  const probeTargets = useMemo(() => {
    const targets = new Map<string, HostProbeTarget>()
    for (const connection of filterConn) {
      const host = hostKeyOfConnection(connection)
      if (!host || targets.has(host)) continue
      const url = probeUrlOf(
        host,
        connection.metadata.network,
        connection.metadata.destinationPort,
      )
      if (url) targets.set(host, { host, url })
    }
    return [...targets.values()]
  }, [filterConn])

  const getHostProbeState = useCallback(
    (host: string) => hostProbeStates.get(host.trim().toLowerCase()),
    [hostProbeStates],
  )

  const runProbe = useLockFn(() => runHostProbe(probeTargets))

  const probingCount = useMemo(() => {
    let count = 0
    for (const target of probeTargets) {
      if (getHostProbeState(target.host)?.status === 'probing') count += 1
    }
    return count
  }, [getHostProbeState, probeTargets])

  const detailRef = useRef<ConnectionDetailRef>(null!)

  const selectConnectionsType = useCallback(
    (type: ConnectionsType) => {
      if (type === connectionsType) return
      detailRef.current?.close()
      setIsColumnManagerOpen(false)
      setSelectedIds(new Set())
      setConnectionsType(type)
    },
    [connectionsType],
  )

  const isConnectionClosed = useCallback(
    (id: string) =>
      connectionsType === 'closed' ||
      (connectionsType === 'history' && !activeConnectionIds.has(id)),
    [connectionsType, activeConnectionIds],
  )

  const showDetailById = useCallback(
    (id: string) => {
      const connection = filterConn.find((item) => item.id === id)
      if (connection) {
        detailRef.current?.open(connection, isConnectionClosed(id))
      }
    },
    [filterConn, isConnectionClosed],
  )

  const onCloseAll = useLockFn(closeAllConnections)

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allSelected) {
          next.delete(id)
        } else {
          next.add(id)
        }
      }
      return next
    })
  }, [])

  const { ruleHosts, skippedHosts } = useMemo(() => {
    const hosts = new Set<string>()
    let skipped = 0

    for (const connection of selectedConnections) {
      if (!selectedIds.has(connection.id)) continue
      const host = (connection.metadata?.host ?? '').trim()
      if (!host || isIpAddress(host)) {
        skipped += 1
        continue
      }
      hosts.add(host)
    }

    return { ruleHosts: [...hosts], skippedHosts: skipped }
  }, [selectedConnections, selectedIds])

  const handleSearch = useCallback(
    (match: (content: string) => boolean, state: SearchState) => {
      setMatch(() => match)
      setHasSearch(state.text.length > 0)
    },
    [],
  )
  const hasTableData = filterConn.length > 0

  return (
    <BasePage
      full
      title={
        <span style={{ whiteSpace: 'nowrap' }}>
          {t('connections.page.title')}
        </span>
      }
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: '8px',
        minHeight: 0,
      }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ mx: 1 }}>
            {t('shared.labels.downloaded')}:{' '}
            {parseTraffic(traffic?.downTotal || 0)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t('shared.labels.uploaded')}: {parseTraffic(traffic?.upTotal || 0)}
          </Box>
          <IconButton
            color="inherit"
            size="small"
            onClick={() =>
              setSetting((o) =>
                o?.layout !== 'table'
                  ? { ...o, layout: 'table' }
                  : { ...o, layout: 'list' },
              )
            }
          >
            {isTableLayout ? (
              <TableRowsRounded titleAccess={t('shared.actions.listView')} />
            ) : (
              <TableChartRounded titleAccess={t('shared.actions.tableView')} />
            )}
          </IconButton>
          <Button size="small" variant="contained" onClick={onCloseAll}>
            <span style={{ whiteSpace: 'nowrap' }}>
              {t('shared.actions.closeAll')}
            </span>
          </Button>
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: '10px',
          minHeight: '36px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          userSelect: 'text',
          position: 'sticky',
          top: 0,
          zIndex: 2,
        }}
      >
        {/* 第一组：列表切换、时间窗口、筛选与主动探测 */}
        <ButtonGroup sx={{ mr: 1, flexShrink: 0 }}>
          <Button
            size="small"
            variant={connectionsType === 'history' ? 'contained' : 'outlined'}
            onClick={() => selectConnectionsType('history')}
          >
            {t('connections.components.actions.history')}{' '}
            {viewConnections.historyConnections.length}
          </Button>
          <Button
            size="small"
            variant={connectionsType === 'active' ? 'contained' : 'outlined'}
            onClick={() => selectConnectionsType('active')}
          >
            {t('connections.components.actions.active')}{' '}
            {viewConnections.activeConnections.length}
          </Button>
          <Button
            size="small"
            variant={connectionsType === 'closed' ? 'contained' : 'outlined'}
            onClick={() => selectConnectionsType('closed')}
          >
            {t('connections.components.actions.closed')}{' '}
            {viewConnections.closedConnections.length}
          </Button>
        </ButtonGroup>
        {connectionsType === 'history' && (
          <BaseStyledSelect
            value={String(historyWindowMs)}
            onChange={(e) =>
              setSetting((o) => ({
                layout: o?.layout ?? 'table',
                ...o,
                historyWindowMs: Number(e.target.value),
              }))
            }
            sx={{ mr: 1, flexShrink: 0 }}
          >
            {HISTORY_WINDOW_OPTIONS.map((windowMs) => (
              <MenuItem key={windowMs} value={windowMs}>
                <span style={{ fontSize: 14 }}>
                  {t('connections.components.history.window', {
                    count: windowMs / 60_000,
                  })}
                </span>
              </MenuItem>
            ))}
          </BaseStyledSelect>
        )}
        {connectionsType === 'history' && (
          <Tooltip title={t('connections.components.filters.title')}>
            <IconButton
              size="small"
              color={
                excludeIpConnections || hideCovered ? 'primary' : 'inherit'
              }
              aria-label={t('connections.components.filters.title')}
              onClick={() => setIsFilterDialogOpen(true)}
              sx={{ flex: '0 0 auto', mr: 1 }}
            >
              <FilterAltRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip
          title={t(
            probingCount > 0
              ? 'connections.components.actions.probing'
              : 'connections.components.actions.probe',
          )}
        >
          <span style={TOOLBAR_ITEM_SHRINK}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<NetworkCheckRounded fontSize="small" />}
              disabled={probeTargets.length === 0}
              loading={probingCount > 0}
              onClick={() => void runProbe()}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {/* 文字固定占一行，内容多时只压缩其他控件 */}
              <span style={{ whiteSpace: 'nowrap' }}>
                {t('connections.components.actions.probe')}
              </span>
            </Button>
          </span>
        </Tooltip>
        {!isTableLayout && (
          <BaseStyledSelect
            value={curOrderOpt}
            onChange={(e) => setCurOrderOpt(e.target.value as OrderKey)}
            sx={TOOLBAR_ITEM_SHRINK}
          >
            {ORDER_OPTIONS.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                <span style={{ fontSize: 14 }}>{t(option.labelKey)}</span>
              </MenuItem>
            ))}
          </BaseStyledSelect>
        )}
        {/* 第二组：搜索与创建规则、暂停、列设置 */}
        <Box
          sx={{
            flex: '1 1 320px',
            minWidth: 200,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            '& > *': { flex: 1 },
          }}
        >
          <BaseSearchBox onSearch={handleSearch} />
        </Box>
        <span style={TOOLBAR_ITEM_SHRINK}>
          <Button
            size="small"
            variant="contained"
            startIcon={<RuleRounded fontSize="small" />}
            disabled={ruleHosts.length === 0}
            onClick={() => setIsRuleDialogOpen(true)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            <span style={{ whiteSpace: 'nowrap' }}>
              {t('connections.components.actions.createRule')}
              {ruleHosts.length > 0 ? ` (${ruleHosts.length})` : ''}
            </span>
          </Button>
        </span>
        <Tooltip
          title={t(
            paused
              ? 'connections.components.actions.resume'
              : 'connections.components.actions.pause',
          )}
        >
          <IconButton
            size="small"
            color={paused ? 'primary' : 'inherit'}
            aria-label={t(
              paused
                ? 'connections.components.actions.resume'
                : 'connections.components.actions.pause',
            )}
            onClick={togglePause}
            sx={TOOLBAR_ITEM_SHRINK}
          >
            {paused ? (
              <PlayArrowRounded fontSize="small" />
            ) : (
              <PauseRounded fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        {isTableLayout && hasTableData && (
          <Tooltip title={t('connections.components.columnManager.title')}>
            <IconButton
              size="small"
              aria-label={t('connections.components.columnManager.title')}
              onClick={() => setIsColumnManagerOpen(true)}
              sx={TOOLBAR_ITEM_SHRINK}
            >
              <ViewColumnRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {!hasTableData ? (
        <BaseEmpty />
      ) : isTableLayout ? (
        <ConnectionTable
          connections={filterConn}
          onShowDetail={showDetailById}
          columnManagerOpen={isColumnManagerOpen}
          onCloseColumnManager={() => setIsColumnManagerOpen(false)}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          getHostProbeState={getHostProbeState}
          hostWithoutPort={connectionsType === 'history'}
        />
      ) : (
        <VirtualList
          key={connectionsType}
          count={displayRows.length}
          estimateSize={56}
          renderItem={(i) => (
            <ConnectionRowItem
              row={displayRows[i]}
              closed={isConnectionClosed(displayRows[i]?.id ?? '')}
              onShowDetail={showDetailById}
              selected={selectedIds.has(displayRows[i]?.id ?? '')}
              onToggleSelect={toggleSelect}
              probeState={getHostProbeState(
                displayRows[i]?.searchableHost ??
                  displayRows[i]?.searchableDestinationIP ??
                  '',
              )}
            />
          )}
          style={{
            flex: 1,
            borderRadius: '8px',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          }}
        />
      )}
      <ConnectionDetail ref={detailRef} />
      <ConnectionRuleDialog
        open={isRuleDialogOpen}
        hosts={ruleHosts}
        skippedCount={skippedHosts}
        onClose={() => setIsRuleDialogOpen(false)}
        onCreated={() => setSelectedIds(new Set())}
      />
      <Zoom
        in={
          (connectionsType === 'closed' || connectionsType === 'history') &&
          filterConn.length > 0
        }
        unmountOnExit
      >
        <Fab
          size="medium"
          variant="extended"
          sx={{
            position: 'absolute',
            right: 16,
            bottom: isTableLayout ? 70 : 16,
          }}
          color="primary"
          onClick={() =>
            connectionsType === 'history'
              ? clearHistoryConnections()
              : clearClosedConnections()
          }
        >
          <DeleteForeverRounded sx={{ mr: 1 }} fontSize="small" />
          {t('shared.actions.clear')}
        </Fab>
      </Zoom>
      <ConnectionFilterDialog
        open={isFilterDialogOpen}
        filters={{ excludeIp: excludeIpConnections, hideCovered }}
        onClose={() => setIsFilterDialogOpen(false)}
        onApply={({ excludeIp, hideCovered: nextHideCovered }) =>
          setSetting((o) => ({
            layout: o?.layout ?? 'table',
            ...o,
            excludeIpConnections: excludeIp,
            hideCoveredHosts: nextHideCovered,
          }))
        }
      />
    </BasePage>
  )
}

export default ConnectionsPage
