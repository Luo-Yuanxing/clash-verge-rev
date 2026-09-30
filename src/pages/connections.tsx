import {
  DeleteForeverRounded,
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
import { useSystemConnections } from '@/hooks/use-system-connections'
import { useSystemConnectionViews } from '@/hooks/use-system-connections-view'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVisibility } from '@/hooks/use-visibility'
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

type ConnectionsType = 'active' | 'closed' | 'history' | 'system'

const orderFunctionMap = ORDER_OPTIONS.reduce<Record<OrderKey, OrderFunc>>(
  (acc, option) => {
    acc[option.id] = option.fn
    return acc
  },
  {} as Record<OrderKey, OrderFunc>,
)

const EMPTY_CONNECTIONS: IConnectionsItem[] = []
const EMPTY_SYSTEM_CONNECTIONS: ISystemConnectionsItem[] = []
const ConnectionsPage = () => {
  const { t } = useTranslation()
  const pageVisible = useVisibility()
  const [match, setMatch] = useState<(input: string) => boolean>(
    () => () => true,
  )
  const [hasSearch, setHasSearch] = useState(false)
  const [curOrderOpt, setCurOrderOpt] = useState<OrderKey>('default')
  const [connectionsType, setConnectionsType] =
    useState<ConnectionsType>('active')

  const {
    response: { data: connections },
    clearClosedConnections,
    clearHistoryConnections,
  } = useConnectionData({ enabled: pageVisible })
  const { data: systemConnections } = useSystemConnections({
    enabled: pageVisible && connectionsType === 'system',
  })
  const {
    response: { data: traffic },
  } = useTrafficData({ enabled: pageVisible })

  const systemConnectionItems = systemConnections?.connections
  const systemViews = useSystemConnectionViews(
    systemConnectionItems ?? EMPTY_SYSTEM_CONNECTIONS,
    connections?.activeConnections ?? EMPTY_CONNECTIONS,
  )

  const [setting, setSetting] = useConnectionSetting()

  const historyWindowMs = setting.historyWindowMs ?? DEFAULT_HISTORY_WINDOW_MS

  useEffect(() => {
    setConnectionHistoryWindow(historyWindowMs)
  }, [historyWindowMs])

  useEffect(() => {
    pruneConnectionHistory()
  }, [])

  const isTableLayout = setting.layout === 'table'

  const [isColumnManagerOpen, setIsColumnManagerOpen] = useState(false)
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false)
  const [paused, setPaused] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const frozenRef = useRef<{
    activeConnections: IConnectionsItem[]
    closedConnections: IConnectionsItem[]
    historyConnections: IConnectionsItem[]
    systemConnections: IConnectionsItem[]
  }>({
    activeConnections: [],
    closedConnections: [],
    historyConnections: [],
    systemConnections: [],
  })

  const togglePause = useCallback(() => {
    if (!paused) {
      frozenRef.current = {
        activeConnections: connections?.activeConnections ?? EMPTY_CONNECTIONS,
        closedConnections: connections?.closedConnections ?? EMPTY_CONNECTIONS,
        historyConnections:
          connections?.historyConnections ?? EMPTY_CONNECTIONS,
        systemConnections: systemViews.connections,
      }
      setPaused(true)
      return
    }
    setPaused(false)
  }, [paused, connections, systemViews])

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
            historyConnections:
              connections?.historyConnections ?? EMPTY_CONNECTIONS,
            systemConnections: systemViews.connections,
          },
    [paused, connections, systemViews],
  )

  const selectedConnections =
    connectionsType === 'system'
      ? viewConnections.systemConnections
      : connectionsType === 'history'
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

    if (isTableLayout && !hasSearch) return selectedConnections
    if (!hasSearch) return orderFunc([...selectedConnections])

    const matchConns = selectedConnections.filter((conn) => {
      const { host, destinationIP, process } = conn.metadata
      return (
        match(host || '') || match(destinationIP || '') || match(process || '')
      )
    })

    return orderFunc ? orderFunc(matchConns) : matchConns
  }, [selectedConnections, isTableLayout, hasSearch, match, curOrderOpt])

  const displayRows = useConnectionRowViews(
    isTableLayout ? EMPTY_CONNECTIONS : filterConn,
  )

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
      // OS socket rows cannot be closed through the core API, so hide the action.
      connectionsType === 'system' ||
      (connectionsType === 'history' && !activeConnectionIds.has(id)),
    [connectionsType, activeConnectionIds],
  )

  const showDetailById = useCallback(
    (id: string) => {
      const connection = filterConn.find((item) => item.id === id)
      if (connection) {
        detailRef.current?.open(
          connection,
          isConnectionClosed(id),
          systemViews.rowById.get(id),
        )
      }
    },
    [filterConn, isConnectionClosed, systemViews],
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
          alignItems: 'center',
          gap: 1,
          userSelect: 'text',
          position: 'sticky',
          top: 0,
          zIndex: 2,
        }}
      >
        <ButtonGroup sx={{ mr: 1, flexBasis: 'content' }}>
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
            variant={connectionsType === 'system' ? 'contained' : 'outlined'}
            onClick={() => selectConnectionsType('system')}
          >
            {t('connections.components.actions.system')}{' '}
            {viewConnections.systemConnections.length}
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
            sx={{ mr: 1, flexBasis: 'content' }}
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
        {!isTableLayout && (
          <BaseStyledSelect
            value={curOrderOpt}
            onChange={(e) => setCurOrderOpt(e.target.value as OrderKey)}
          >
            {ORDER_OPTIONS.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                <span style={{ fontSize: 14 }}>{t(option.labelKey)}</span>
              </MenuItem>
            ))}
          </BaseStyledSelect>
        )}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            '& > *': {
              flex: 1,
            },
          }}
        >
          <BaseSearchBox onSearch={handleSearch} />
        </Box>
        <Button
          size="small"
          variant="contained"
          startIcon={<RuleRounded fontSize="small" />}
          disabled={ruleHosts.length === 0}
          onClick={() => setIsRuleDialogOpen(true)}
          sx={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
        >
          {t('connections.components.actions.createRule')}
          {ruleHosts.length > 0 ? ` (${ruleHosts.length})` : ''}
        </Button>
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
            sx={{ flex: '0 0 auto' }}
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
              sx={{ flex: '0 0 auto' }}
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
    </BasePage>
  )
}

export default ConnectionsPage
