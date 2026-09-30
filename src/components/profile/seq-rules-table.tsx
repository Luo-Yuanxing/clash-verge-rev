import {
  DeleteForeverRounded,
  DragIndicatorRounded,
  FilterListRounded,
} from '@mui/icons-material'
import {
  Autocomplete,
  Box,
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  GroupedVirtualList,
  type GroupedVirtualItem,
} from './grouped-virtual-list'
import {
  builtinProxyPolicies,
  parseRuleParts,
  PROXY_POLICY_LABEL_KEYS,
  RULE_TYPE_LABEL_KEYS,
  ruleTypeOptions,
  serializeRuleParts,
} from './rule-fields'
import type { SeqRuleRef, SeqRuleSource } from './seq-rules-document'

export type { SeqRuleSource }

/** 列表筛选视图：全部 / 只看启用 / 只看已关闭 */
export type SeqRuleVisibility = 'all' | 'enabled' | 'disabled'

export interface SeqRuleRow extends SeqRuleRef {
  /** 文件里已保存的启用状态：筛选分组只看它，未保存的勾选不会提前换组 */
  savedEnabled: boolean
}

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
  /** 主机 / 类型 / 策略改完后提交新规则串，重复项由调用方排除 */
  onEdit: (row: SeqRuleRow, nextRule: string) => void
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

/** 单元格输入框统一成表格行高内的紧凑样式 */
const cellFieldProps = {
  variant: 'standard' as const,
  margin: 'none' as const,
  slotProps: {
    input: {
      disableUnderline: true,
      sx: { fontSize: '0.875rem', py: 0.25 },
    },
  },
}
const cellAutocompleteProps = {
  size: 'small' as const,
  disableClearable: true,
}

/** 规则类型下拉选项：值是写入规则的字符串 */
const ruleTypeNames = ruleTypeOptions.map((option) => option.name)

/** 行内编辑草稿：三个属性各存一份，提交时合成新规则串 */
interface RuleDraft {
  type?: string
  host?: string
  policy?: string
}

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
    onEdit,
  } = props
  const { t } = useTranslation()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  /** 正在编辑的行草稿，键为行 id；行消失后草稿自然失效 */
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({})

  /** 编辑某一属性 */
  const editDraft = (id: string, patch: RuleDraft) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  /**
   * 提交整行：任何一项改动都当作一次编辑，未改动的属性沿用原值；
   * 草稿先清掉再算结果，避免把这次提交过的草稿带进下一轮比较。
   * 下拉选择会立刻提交，用 extra 传入刚选中的值，不必等重新渲染。
   */
  const commitDraft = (id: string, row: SeqRuleRow, extra?: RuleDraft) => {
    const draft = extra ?? drafts[id]
    setDrafts((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (!draft) return

    // DOMAIN-SUFFIX 的域名归一化与 no-resolve 保留交给 serializeRuleParts
    const next = serializeRuleParts({ ...parseRuleParts(row.rule), ...draft })
    if (next && next !== row.rule) onEdit(row, next)
  }

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
    const parts = parseRuleParts(rule)
    const draft = drafts[entry.id] ?? {}
    const { host, policy, type } = parts
    /** 下拉只提供已知选项，策略列额外带上这一行当前的值 */
    const policyOptions = builtinProxyPolicies.includes(policy)
      ? builtinProxyPolicies
      : [...builtinProxyPolicies, policy]
    const selectedType: string | null = ruleTypeNames.includes(type)
      ? type
      : null
    const selectedPolicy: string | null = policyOptions.includes(policy)
      ? policy
      : null

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
        <TextField
          {...cellFieldProps}
          value={draft.host ?? host}
          placeholder="-"
          onChange={(event) =>
            editDraft(entry.id, { host: event.target.value })
          }
          onBlur={() => commitDraft(entry.id, entry.item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <Autocomplete
          {...cellAutocompleteProps}
          options={ruleTypeNames}
          value={selectedType}
          getOptionLabel={(option) => t(RULE_TYPE_LABEL_KEYS[option] ?? option)}
          renderInput={(params) => (
            <TextField {...params} {...cellFieldProps} />
          )}
          onChange={(_, value) => {
            commitDraft(entry.id, entry.item, { type: value ?? type })
          }}
          onBlur={() => commitDraft(entry.id, entry.item)}
        />
        <Autocomplete
          {...cellAutocompleteProps}
          options={policyOptions}
          value={selectedPolicy}
          getOptionLabel={(option) =>
            t(PROXY_POLICY_LABEL_KEYS[option] ?? option)
          }
          renderInput={(params) => (
            <TextField {...params} {...cellFieldProps} />
          )}
          onChange={(_, value) => {
            commitDraft(entry.id, entry.item, { policy: value ?? policy })
          }}
          onBlur={() => commitDraft(entry.id, entry.item)}
        />
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
