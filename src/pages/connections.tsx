import {
  BlockRounded,
  DeleteForeverRounded,
  FilterAltRounded,
  FormatListBulletedRounded,
  NetworkCheckRounded,
  PauseRounded,
  PlayArrowRounded,
  RuleRounded,
  TableChartRounded,
  TableRowsRounded,
  ViewColumnRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Fab,
  FormControlLabel,
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
import { ConnectionBlocklistDialog } from '@/components/connection/connection-blocklist-dialog'
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
import { useConnectionLogHistory } from '@/hooks/use-connection-log'
import {
  HISTORY_WINDOW_OPTIONS,
  useConnectionSetting,
} from '@/hooks/use-connection-setting'
import { useCustomRuleCoverage } from '@/hooks/use-custom-rule-coverage'
import { useHostProbe } from '@/hooks/use-host-probe'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import {
  useAppRefreshers,
  useClashConfigData,
} from '@/providers/app-data-context'
import { patchClashConfig } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import {
  createBlocklistMatcher,
  normalizeBlockHost,
  normalizeBlocklist,
} from '@/utils/connection-blocklist'
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

/** 历史列表完全依赖内核日志：级别不高于 info（debug / info）时连接才会写进日志 */
const HISTORY_LOG_LEVELS = ['debug', 'info']

/** 归一化内核日志级别：warn 与 warning 是同一级别 */
const normalizeCoreLogLevel = (level: unknown) => {
  const value = typeof level === 'string' ? level.trim().toLowerCase() : ''
  return value === 'warn' ? 'warning' : value
}

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
    clearHistoryConnections,
  } = useConnectionData({ enabled: pageVisible })
  const { data: traffic } = useTrafficData({ enabled: pageVisible })

  const [setting, setSetting] = useConnectionSetting()
  const { verge, patchVerge } = useVerge()
  const { clashConfig } = useClashConfigData()
  const { refreshClashConfig } = useAppRefreshers()

  /**
   * 内核日志级别高于 info（debug / info 之外）时历史列表不会有记录，直接把表格关掉并给出修复入口。
   * 注意 BaseConfig 是 camelCase 的 `logLevel`，值形如 `WARNING` / `INFO`。
   */
  const coreLogLevel = normalizeCoreLogLevel(clashConfig?.logLevel)
  const isHistoryLogEnabled = HISTORY_LOG_LEVELS.includes(coreLogLevel)

  /** 历史连接黑名单：只隐藏同名主机，按域名严格匹配 */
  const isBlockedHost = useMemo(
    () => createBlocklistMatcher(verge?.connection_history_blocklist),
    [verge?.connection_history_blocklist],
  )
  const blocklistCount = useMemo(
    () => normalizeBlocklist(verge?.connection_history_blocklist).length,
    [verge?.connection_history_blocklist],
  )

  const isHostCovered = useCustomRuleCoverage(pageVisible)

  const historyWindowMs = setting.historyWindowMs ?? DEFAULT_HISTORY_WINDOW_MS
  /** 默认排除裸 IP 的历史记录 */
  const excludeIpConnections = setting.excludeIpConnections ?? true
  /** 默认隐藏主机已被自定义规则覆盖的记录 */
  const hideCovered = setting.hideCoveredHosts ?? true

  /** 历史列表的数据源是内核日志事件流：日志订阅常驻，列表打开时 5s 重算一次，否则 60s */
  const { connections: rangeConnections, clear: clearRangeConnections } =
    useConnectionLogHistory(historyWindowMs, {
      active: pageVisible && connectionsType === 'history',
    })

  useEffect(() => {
    setConnectionHistoryWindow(historyWindowMs)
  }, [historyWindowMs])

  /** 级别不是 info（且已读到级别）时，历史表格整体停用 */
  const isHistoryLogDisabled =
    connectionsType === 'history' &&
    Boolean(coreLogLevel) &&
    !isHistoryLogEnabled

  useEffect(() => {
    pruneConnectionHistory()
  }, [])

  const isTableLayout = setting.layout === 'table'

  const [isColumnManagerOpen, setIsColumnManagerOpen] = useState(false)
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [isBlocklistDialogOpen, setIsBlocklistDialogOpen] = useState(false)
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

  /** 历史列表：指定时长内出现过的连接，可选排除裸 IP，再按主机压缩并剔除黑名单 */
  const historyConnections = useMemo(
    () =>
      mergeHistoryConnections(
        excludeIpConnections
          ? rangeConnections.filter((connection) => !isIpConnection(connection))
          : rangeConnections,
      ).filter((connection) => !isBlockedHost(connection.metadata.host)),
    [rangeConnections, excludeIpConnections, isBlockedHost],
  )

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

  /** 探测未响应的连接（列表里标红/爆红的那些） */
  const failedConnectionIds = useMemo(() => {
    const ids: string[] = []
    for (const connection of filterConn) {
      const host = hostKeyOfConnection(connection)
      if (host && getHostProbeState(host)?.status === 'fail')
        ids.push(connection.id)
    }
    return ids
  }, [filterConn, getHostProbeState])

  const failedSelectedCount = useMemo(
    () => failedConnectionIds.filter((id) => selectedIds.has(id)).length,
    [failedConnectionIds, selectedIds],
  )

  /** 一键选择爆红：先清空原有选择，只留下探测未响应的连接 */
  const toggleSelectFailed = useCallback(
    (checked: boolean) => {
      setSelectedIds(
        checked ? new Set<string>(failedConnectionIds) : new Set<string>(),
      )
    },
    [failedConnectionIds],
  )

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
      setIsBlocklistDialogOpen(false)
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

  /** 选中连接里可加入黑名单的主机：去端口、去重，已在黑名单里的跳过 */
  const blockHosts = useMemo(() => {
    const hosts: string[] = []
    const seen = new Set<string>()

    for (const connection of selectedConnections) {
      if (!selectedIds.has(connection.id)) continue
      const host = normalizeBlockHost(connection.metadata?.host ?? '')
      if (!host || seen.has(host) || isBlockedHost(host)) continue
      seen.add(host)
      hosts.push(host)
    }

    return hosts
  }, [selectedConnections, selectedIds, isBlockedHost])

  const addToBlocklist = useLockFn(async () => {
    if (blockHosts.length === 0) return

    try {
      await patchVerge({
        connection_history_blocklist: normalizeBlocklist([
          ...(verge?.connection_history_blocklist ?? []),
          ...blockHosts,
        ]),
      })
      setSelectedIds(new Set())
      showNotice.success(
        t('connections.components.blocklist.added', {
          count: blockHosts.length,
        }),
      )
    } catch (err) {
      showNotice.error(err)
    }
  })

  /** 一键把内核日志级别设为 info，历史列表随即能记录到连接 */
  const enableHistoryLog = useLockFn(async () => {
    try {
      await patchClashConfig({ 'log-level': 'info' })
      await refreshClashConfig()
      showNotice.success(t('connections.components.history.logLevel.done'))
    } catch (err) {
      showNotice.error(err)
    }
  })

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
                  {windowMs < 60_000
                    ? t('connections.components.history.rangeSeconds', {
                        count: windowMs / 1_000,
                      })
                    : t('connections.components.history.rangeMinutes', {
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
        {connectionsType === 'history' && (
          <Tooltip
            title={`${t('connections.components.blocklist.title')}${
              blocklistCount > 0 ? ` (${blocklistCount})` : ''
            }`}
          >
            <IconButton
              size="small"
              color={blocklistCount > 0 ? 'primary' : 'inherit'}
              aria-label={t('connections.components.blocklist.title')}
              onClick={() => setIsBlocklistDialogOpen(true)}
              sx={{ flex: '0 0 auto', mr: 1 }}
            >
              <FormatListBulletedRounded fontSize="small" />
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
        <FormControlLabel
          sx={{
            mr: 1,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            '& .MuiFormControlLabel-label': { fontSize: 14 },
          }}
          control={
            <Checkbox
              size="small"
              disabled={failedConnectionIds.length === 0}
              checked={
                failedConnectionIds.length > 0 &&
                failedSelectedCount === failedConnectionIds.length
              }
              indeterminate={
                failedSelectedCount > 0 &&
                failedSelectedCount < failedConnectionIds.length
              }
              onChange={(e) => toggleSelectFailed(e.target.checked)}
            />
          }
          label={t('connections.components.actions.selectFailed')}
        />
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
        {connectionsType === 'history' && (
          <span style={TOOLBAR_ITEM_SHRINK}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<BlockRounded fontSize="small" />}
              disabled={blockHosts.length === 0}
              onClick={() => void addToBlocklist()}
              sx={{ whiteSpace: 'nowrap' }}
            >
              <span style={{ whiteSpace: 'nowrap' }}>
                {t('connections.components.blocklist.add')}
                {blockHosts.length > 0 ? ` (${blockHosts.length})` : ''}
              </span>
            </Button>
          </span>
        )}
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

      {isHistoryLogDisabled && (
        <Alert
          severity="warning"
          sx={{ mx: '10px', mt: '100px', mb: 1, flexShrink: 0 }}
          action={
            <Button
              color="inherit"
              size="small"
              sx={{ whiteSpace: 'nowrap' }}
              onClick={() => void enableHistoryLog()}
            >
              {t('connections.components.history.logLevel.action')}
            </Button>
          }
        >
          <strong>{t('connections.components.history.logLevel.title')}</strong>{' '}
          {t('connections.components.history.logLevel.desc', {
            level: coreLogLevel,
          })}
        </Alert>
      )}

      {/* 级别不是 info 时内核不会记录连接，表格直接关掉，只留上面的提示与一键设置 */}
      {isHistoryLogDisabled ? (
        <BaseEmpty />
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
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
              hideTrafficColumns={connectionsType === 'history'}
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
        </Box>
      )}
      <ConnectionDetail ref={detailRef} />
      <ConnectionRuleDialog
        open={isRuleDialogOpen}
        hosts={ruleHosts}
        skippedCount={skippedHosts}
        onClose={() => setIsRuleDialogOpen(false)}
        onCreated={() => setSelectedIds(new Set())}
      />
      <ConnectionBlocklistDialog
        open={isBlocklistDialogOpen}
        onClose={() => setIsBlocklistDialogOpen(false)}
      />
      <Zoom
        in={
          connectionsType === 'history' &&
          !isHistoryLogDisabled &&
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
          onClick={() => {
            clearRangeConnections()
            clearHistoryConnections()
          }}
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
