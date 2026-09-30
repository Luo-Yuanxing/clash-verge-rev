import { DeleteForeverRounded, DragIndicatorRounded } from '@mui/icons-material'
import { Box, Checkbox, IconButton, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  GroupedVirtualList,
  type GroupedVirtualItem,
} from './grouped-virtual-list'
import { parseRule } from './rule-fields'

export type SeqRuleSource = 'prepend' | 'append'

export interface SeqRuleRow {
  rule: string
  source: SeqRuleSource
}

interface Props {
  rows: SeqRuleRow[]
  /** 原始顺序模式：可拖动排序，只读且不提供勾选与删除 */
  sortable?: boolean
  onDelete: (row: SeqRuleRow) => void
  onReorder: (source: SeqRuleSource, from: number, to: number) => void
}

const ROW_HEIGHT = 40

/** 选择/手柄列 + 主机 + 规则类型 + 代理策略 + 操作列 */
const gridColumns = '48px minmax(0, 1fr) 150px 200px 48px'
const gridSx = {
  display: 'grid',
  gridTemplateColumns: gridColumns,
  alignItems: 'center',
  gap: 1,
  px: 1,
} as const

/** 自定义规则表格：全选 / 主机 / 规则类型 / 代理策略 */
export const SeqRulesTable = (props: Props) => {
  const { rows, sortable, onDelete, onReorder } = props
  const { t } = useTranslation()

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const items = useMemo<GroupedVirtualItem<string>[]>(
    () =>
      rows.map(({ rule, source }) => ({
        id: `${source}\u0000${rule}`,
        category: source,
        item: rule,
      })),
    [rows],
  )

  // 只统计仍然存在的规则，被删除规则的历史勾选不影响全选状态
  const selectedCount = useMemo(
    () =>
      items.reduce(
        (count, entry) => (selected.has(entry.id) ? count + 1 : count),
        0,
      ),
    [items, selected],
  )

  const allSelected = items.length > 0 && selectedCount === items.length
  const partiallySelected = selectedCount > 0 && !allSelected

  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(items.map((entry) => entry.id)),
    )
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const renderItem = (entry: GroupedVirtualItem<string>) => {
    const { type, host, policy } = parseRule(entry.item)

    return (
      <Box
        sx={{
          ...gridSx,
          minHeight: ROW_HEIGHT,
          borderBottom: 1,
          borderColor: 'divider',
          ...(selected.has(entry.id) && {
            backgroundColor: 'action.hover',
          }),
        }}
      >
        {sortable ? (
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
          <Checkbox
            size="small"
            sx={{ p: 0.5 }}
            checked={selected.has(entry.id)}
            onChange={() => toggleOne(entry.id)}
          />
        )}
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
            <IconButton
              size="small"
              onClick={() =>
                onDelete({
                  rule: entry.item,
                  source: entry.category as SeqRuleSource,
                })
              }
            >
              <DeleteForeverRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>
    )
  }

  const header = (
    <Box
      sx={{
        ...gridSx,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      {sortable ? (
        <Box />
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Checkbox
            size="small"
            sx={{ p: 0.5 }}
            checked={allSelected}
            indeterminate={partiallySelected}
            onChange={toggleAll}
          />
        </Box>
      )}
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
  )
}
