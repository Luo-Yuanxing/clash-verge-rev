import {
  DeleteForeverRounded,
  DragIndicatorRounded,
  FilterListRounded,
} from '@mui/icons-material'
import {
  Box,
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  GroupedVirtualList,
  type GroupedVirtualItem,
} from './grouped-virtual-list'
import { parseRule } from './rule-fields'
import type { SeqRuleRef, SeqRuleSource } from './seq-rules-document'

export type { SeqRuleSource }

/** 列表筛选视图：全部 / 只看启用 / 只看已关闭 */
export type SeqRuleVisibility = 'all' | 'enabled' | 'disabled'

export type SeqRuleRow = SeqRuleRef

interface Props {
  rows: SeqRuleRow[]
  /** 原始顺序模式：启用中的规则可拖动排序 */
  sortable?: boolean
  visibility: SeqRuleVisibility
  onVisibilityChange: (next: SeqRuleVisibility) => void
  /** 勾选/取消勾选：批量启用或关闭这些规则 */
  onToggle: (rows: SeqRuleRow[], enabled: boolean) => void
  onDelete: (row: SeqRuleRow) => void
  onReorder: (source: SeqRuleSource, from: number, to: number) => void
}

const ROW_HEIGHT = 40
/** 勾选列需同时容纳勾选框与筛选下拉 */
const SELECT_COLUMN = 64

/** 筛选视图选项，顺序即菜单顺序 */
const visibilityOptions: { value: SeqRuleVisibility; labelKey: string }[] = [
  { value: 'all', labelKey: 'rules.custom.page.visibility.all' },
  { value: 'enabled', labelKey: 'rules.custom.page.visibility.enabled' },
  { value: 'disabled', labelKey: 'rules.custom.page.visibility.disabled' },
]

/** 勾选（+手柄）列 + 主机 + 规则类型 + 代理策略 + 操作列 */
const gridSx = (sortable?: boolean) =>
  ({
    display: 'grid',
    gridTemplateColumns: sortable
      ? `24px ${SELECT_COLUMN}px minmax(0, 1fr) 150px 200px 48px`
      : `${SELECT_COLUMN}px minmax(0, 1fr) 150px 200px 48px`,
    alignItems: 'center',
    gap: 1,
    px: 1,
  }) as const

/** 自定义规则表格：勾选即启用 / 主机 / 规则类型 / 代理策略 */
export const SeqRulesTable = (props: Props) => {
  const {
    rows,
    sortable,
    visibility,
    onVisibilityChange,
    onToggle,
    onDelete,
    onReorder,
  } = props
  const { t } = useTranslation()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  const items = useMemo<GroupedVirtualItem<SeqRuleRow>[]>(
    () =>
      rows.map((row) => ({
        id: `${row.enabled ? 'on' : 'off'}\u0000${row.source}\u0000${row.rule}`,
        // 关闭的规则不属于可排序序列，借 original 类别置为不可拖动
        category: row.enabled ? row.source : 'original',
        item: row,
      })),
    [rows],
  )

  const enabledCount = rows.reduce(
    (count, row) => (row.enabled ? count + 1 : count),
    0,
  )
  const allEnabled = rows.length > 0 && enabledCount === rows.length
  const partiallyEnabled = enabledCount > 0 && !allEnabled

  const renderItem = (entry: GroupedVirtualItem<SeqRuleRow>) => {
    const { rule, enabled } = entry.item
    const { type, host, policy } = parseRule(rule)

    return (
      <Box
        sx={{
          ...gridSx(sortable),
          minHeight: ROW_HEIGHT,
          borderBottom: 1,
          borderColor: 'divider',
          ...(!enabled && { opacity: 0.55 }),
        }}
      >
        {sortable ? (
          enabled ? (
            <Box
              data-sortable-handle
              sx={{
                display: 'flex',
                justifyContent: 'center',
                cursor: 'grab',
                color: 'text.secondary',
              }}
            >
              <DragIndicatorRounded fontSize="small" />
            </Box>
          ) : (
            <Box />
          )
        ) : null}
        <Checkbox
          size="small"
          sx={{ p: 0, justifySelf: 'start' }}
          slotProps={{ input: { 'aria-label': rule } }}
          checked={enabled}
          onChange={() => onToggle([entry.item], !enabled)}
        />
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
          {host || '-'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {type}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ wordBreak: 'break-word' }}
        >
          {policy}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          {!sortable && (
            <IconButton size="small" onClick={() => onDelete(entry.item)}>
              <DeleteForeverRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>
    )
  }

  const visibilityLabel = t(
    visibilityOptions.find((option) => option.value === visibility)?.labelKey ??
      visibilityOptions[0].labelKey,
  )

  const header = (
    <Box
      sx={{
        ...gridSx(sortable),
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      {sortable ? <Box /> : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Checkbox
          size="small"
          sx={{ p: 0 }}
          slotProps={{
            input: { 'aria-label': t('rules.custom.page.columns.selectAll') },
          }}
          checked={allEnabled}
          indeterminate={partiallyEnabled}
          onChange={() => onToggle(rows, !allEnabled)}
        />
        <Tooltip title={visibilityLabel}>
          <IconButton
            size="small"
            sx={{ p: 0, width: 24, height: 24 }}
            aria-label={visibilityLabel}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <FilterListRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2">
        {t('rules.custom.page.columns.host')}
      </Typography>
      <Typography variant="body2">
        {t('rules.custom.page.columns.type')}
      </Typography>
      <Typography variant="body2">
        {t('rules.custom.page.columns.policy')}
      </Typography>
      <Box />
    </Box>
  )

  return (
    <>
      <GroupedVirtualList
        items={items}
        gap={0}
        estimateSize={ROW_HEIGHT}
        header={header}
        renderItem={renderItem}
        onReorder={onReorder}
        readOnly={!sortable}
        style={{ height: '100%' }}
      />
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        {visibilityOptions.map(({ value, labelKey }) => (
          <MenuItem
            key={value}
            selected={visibility === value}
            onClick={() => {
              onVisibilityChange(value)
              setMenuAnchor(null)
            }}
          >
            {t(labelKey)}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
