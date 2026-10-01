import { CloseRounded } from '@mui/icons-material'
import { Checkbox, IconButton, Tooltip } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useLockFn } from 'ahooks'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { closeConnection } from 'tauri-plugin-mihomo-api'

import type { HostProbeState } from '@/hooks/use-host-probe'
import { HOST_PROBE_WINDOW_MS } from '@/utils/connection-probe'

import { RelativeTime } from './connection-relative-time'
import type { ConnectionRowView } from './connection-row-view'

interface Props {
  row: ConnectionRowView
  closed: boolean
  onShowDetail: (id: string) => void
  selected: boolean
  onToggleSelect: (id: string) => void
  /** 主动探测结果：未响应（连接失败或被墙）的主机标红 */
  probeState?: HostProbeState
}

const tagStyle = {
  boxSizing: 'border-box',
  maxWidth: '100%',
  padding: '0 4px',
  border: '1px solid rgba(128,128,128,0.35)',
  borderRadius: 4,
  fontSize: 10,
  lineHeight: 1.375,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const itemStyle = {
  boxSizing: 'border-box',
  minHeight: 56,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 48px 6px 4px',
  borderBottom: '1px solid var(--divider-color)',
  position: 'relative',
  overflow: 'hidden',
} as const

const contentStyle = {
  minWidth: 0,
  flex: 1,
  cursor: 'pointer',
  userSelect: 'text',
} as const

const primaryStyle = {
  fontSize: 14,
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const tagsStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 4,
  overflow: 'hidden',
} as const

const actionStyle = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
} as const

/** dial 失败原因可能有多行（每次尝试一行） */
const tooltipTextStyle = { whiteSpace: 'pre-line' } as const

export const ConnectionRowItem = memo(
  function ConnectionRowItem({
    row,
    closed,
    onShowDetail,
    selected,
    onToggleSelect,
    probeState,
  }: Props) {
    const { t } = useTranslation()
    const onDelete = useLockFn(async () => closeConnection(row.id))
    const handleShowDetail = useCallback(
      () => onShowDetail(row.id),
      [onShowDetail, row.id],
    )
    const handleToggleSelect = useCallback(
      () => onToggleSelect(row.selectKey),
      [onToggleSelect, row.selectKey],
    )
    const showTraffic = row.uploadSpeed >= 100 || row.downloadSpeed >= 100
    // dial 失败是内核报出来的，探测失败是主动探测出来的，两者都标红
    const probeFailed = probeState?.status === 'fail'
    const failed = row.failed || probeFailed
    const errorColor = useTheme().palette.error.main
    const failedReason = row.failed
      ? row.dialError
      : probeFailed
        ? t('connections.components.probe.error', {
            seconds: HOST_PROBE_WINDOW_MS / 1000,
          })
        : ''

    return (
      <div style={itemStyle}>
        <Checkbox
          size="small"
          checked={selected}
          onChange={handleToggleSelect}
          sx={{ flexShrink: 0, p: 0.5 }}
        />
        <div style={contentStyle} onClick={handleShowDetail}>
          <Tooltip
            title={
              failedReason ? (
                <span style={tooltipTextStyle}>{failedReason}</span>
              ) : (
                ''
              )
            }
          >
            <div
              style={{
                ...primaryStyle,
                color: failed ? errorColor : undefined,
              }}
            >
              {row.host}
            </div>
          </Tooltip>
          <div style={tagsStyle}>
            <span style={tagStyle}>{row.network}</span>
            <span style={tagStyle}>{row.type}</span>
            {row.process && <span style={tagStyle}>{row.process}</span>}
            {row.chains && <span style={tagStyle}>{row.chains}</span>}
            <span style={tagStyle}>
              <RelativeTime start={row.time} />
            </span>
            {row.failed && (
              <span
                style={{
                  ...tagStyle,
                  color: errorColor,
                  borderColor: errorColor,
                }}
              >
                {t('connections.components.fields.failed')}
              </span>
            )}
            {showTraffic && (
              <span style={tagStyle}>
                {row.uploadSpeedText} / {row.downloadSpeedText}
              </span>
            )}
          </div>
        </div>
        {!closed && (
          <IconButton
            size="small"
            color="inherit"
            onClick={onDelete}
            title={t('connections.components.actions.closeConnection')}
            aria-label={t('connections.components.actions.closeConnection')}
            sx={actionStyle}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        )}
      </div>
    )
  },
  (prev, next) =>
    prev.row === next.row &&
    prev.closed === next.closed &&
    prev.onShowDetail === next.onShowDetail &&
    prev.selected === next.selected &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.probeState === next.probeState,
)
