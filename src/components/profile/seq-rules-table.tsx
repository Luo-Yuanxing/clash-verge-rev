import { DeleteForeverRounded } from '@mui/icons-material'
import {
  Box,
  Checkbox,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseRule } from './rule-fields'

export type SeqRuleSource = 'prepend' | 'append'

export interface SeqRuleRow {
  rule: string
  source: SeqRuleSource
}

/** 表头与数据行共用同一套勾选单元格布局，保证复选框对齐 */
const selectionCellSx = { width: 88, px: 1, py: 0 }
const selectionBoxSx = { display: 'flex', alignItems: 'center', minHeight: 40 }
const checkboxSx = { p: 0.5 }

interface Props {
  rows: SeqRuleRow[]
  onDelete: (row: SeqRuleRow) => void
}

/** 自定义规则表格：全选 / 主机 / 规则类型 / 代理策略 */
export const SeqRulesTable = (props: Props) => {
  const { rows, onDelete } = props
  const { t } = useTranslation()

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const keys = useMemo(
    () => rows.map(({ rule, source }) => `${source}\u0000${rule}`),
    [rows],
  )

  // 只统计仍然存在的规则，被删除规则的历史勾选不影响全选状态
  const selectedCount = useMemo(
    () =>
      keys.reduce((count, key) => (selected.has(key) ? count + 1 : count), 0),
    [keys, selected],
  )

  const allSelected = keys.length > 0 && selectedCount === keys.length
  const partiallySelected = selectedCount > 0 && !allSelected

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(keys))
  }

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  return (
    <TableContainer sx={{ height: '100%', overflowX: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={selectionCellSx}>
              <Box sx={{ ...selectionBoxSx, gap: 0.5 }}>
                <Checkbox
                  size="small"
                  sx={checkboxSx}
                  checked={allSelected}
                  indeterminate={partiallySelected}
                  onChange={toggleAll}
                />
                <Typography variant="body2" noWrap>
                  {t('rules.custom.page.columns.selectAll')}
                </Typography>
              </Box>
            </TableCell>
            <TableCell>{t('rules.custom.page.columns.host')}</TableCell>
            <TableCell>{t('rules.custom.page.columns.type')}</TableCell>
            <TableCell>{t('rules.custom.page.columns.policy')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const key = `${row.source}\u0000${row.rule}`
            const { type, host, policy } = parseRule(row.rule)

            return (
              <TableRow key={key} hover selected={selected.has(key)}>
                <TableCell sx={selectionCellSx}>
                  <Box sx={selectionBoxSx}>
                    <Checkbox
                      size="small"
                      sx={checkboxSx}
                      checked={selected.has(key)}
                      onChange={() => toggleOne(key)}
                    />
                  </Box>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {host || '-'}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{type}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{policy}</TableCell>
                <TableCell align="right" padding="none">
                  <IconButton size="small" onClick={() => onDelete(row)}>
                    <DeleteForeverRounded fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
