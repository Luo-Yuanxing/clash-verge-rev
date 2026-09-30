import {
  ContentCopyRounded,
  SaveRounded,
  SortRounded,
} from '@mui/icons-material'
import { Box, Button, Chip, Menu, MenuItem, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage, BaseSearchBox, Switch } from '@/components/base'
import {
  compareRulesByHostLevel,
  moveItem,
} from '@/components/profile/rule-fields'
import {
  applyRuleEnabled,
  findFirstNonEmptyRulesUid,
  readSeqRulesDocument,
  removeSeqRule,
  type SeqRulesConfig,
  serializeSeqRules,
  toSeqConfig,
  updateSeqRule,
} from '@/components/profile/seq-rules-document'
import { migrateSeqRules } from '@/components/profile/seq-rules-migrate'
import {
  type SeqRuleRow,
  type SeqRuleSource,
  SeqRulesTable,
  type SeqRuleVisibility,
} from '@/components/profile/seq-rules-table'
import { useSeqRuleConfig } from '@/components/profile/use-seq-rule-config'
import { useProfiles } from '@/hooks/use-profiles'
import { useVisibility } from '@/hooks/use-visibility'
import { restartCore, saveRulesFile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const CustomRulesPage = () => {
  const { t } = useTranslation()
  const { profiles, current, mutateProfiles } = useProfiles()
  const pageVisible = useVisibility()

  const items = useMemo(
    () =>
      (profiles?.items ?? []).filter(
        (item): item is IProfileItem => !!item && !!item.option?.rules,
      ),
    [profiles],
  )

  const [pickedUid, setPickedUid] = useState('')
  /** 自动定位到的、第一个真正有自定义规则的订阅 */
  const [autoUid, setAutoUid] = useState('')
  /** 默认按域名层级排序，可切回规则命中的原始顺序 */
  const [order, setOrder] = useState<'domain' | 'original'>('domain')
  /** 列表默认显示全部规则，可切换到只看启用或只看已关闭的规则 */
  const [visibility, setVisibility] = useState<SeqRuleVisibility>('all')
  /** 未保存改动的所属订阅：切换订阅后改动自动失效 */
  const [dirtyUid, setDirtyUid] = useState('')
  /** 迁移目标订阅下拉菜单的锚点 */
  const [migrateAnchor, setMigrateAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    void mutateProfiles()
  }, [mutateProfiles, pageVisible])

  // 进入页面时依次查看各订阅，跳过自定义规则为空的，直接选中第一个有内容的
  useEffect(() => {
    if (!pageVisible || items.length === 0) return

    const candidates = items.flatMap((item) => {
      const property = item.option?.rules
      return property ? [{ uid: item.uid, property }] : []
    })

    let cancelled = false
    void (async () => {
      const uid = await findFirstNonEmptyRulesUid(candidates)
      if (!cancelled) setAutoUid(uid)
    })()

    return () => {
      cancelled = true
    }
  }, [items, pageVisible])

  const selectedUid =
    pickedUid && items.some((item) => item.uid === pickedUid)
      ? pickedUid
      : (items.find((item) => item.uid === autoUid)?.uid ??
        items.find((item) => item.uid === current?.uid)?.uid ??
        items[0]?.uid ??
        '')

  const selected = items.find((item) => item.uid === selectedUid)

  /** 当前订阅存在未保存的勾选改动 */
  const dirty = !!selectedUid && dirtyUid === selectedUid

  const {
    visualization,
    match,
    setMatch,
    prependSeq,
    setPrependSeq,
    appendSeq,
    setAppendSeq,
    deleteSeq,
    setDeleteSeq,
    disabledSeq,
    setDisabledSeq,
    savedSeq,
    setSavedSeq,
    excludeSubscriptionRules,
    setExcludeSubscriptionRules,
  } = useSeqRuleConfig(selected?.option?.rules ?? '', !!selected)

  const rulesProperty = selected?.option?.rules

  /** 编辑的是当前订阅的规则文件：后端保存时会顺带更新运行时，内核即已采用 */
  const isCurrentRules =
    !!rulesProperty && rulesProperty === current?.option?.rules

  /** 文件里保存为启用的规则，未保存的勾选不会改变它 */
  const savedEnabledKeys = useMemo(
    () =>
      new Set([
        ...savedSeq.prepend.map((rule) => `prepend\u0000${rule}`),
        ...savedSeq.append.map((rule) => `append\u0000${rule}`),
      ]),
    [savedSeq],
  )

  const rows = useMemo<SeqRuleRow[]>(() => {
    const build = (
      rules: string[],
      source: SeqRuleSource,
      enabled: boolean,
    ): SeqRuleRow[] =>
      rules.map((rule) => ({
        rule,
        source,
        enabled,
        savedEnabled: savedEnabledKeys.has(`${source}\u0000${rule}`),
      }))

    return [
      ...build(prependSeq, 'prepend', true),
      ...build(appendSeq, 'append', true),
      ...build(disabledSeq.prepend, 'prepend', false),
      ...build(disabledSeq.append, 'append', false),
    ]
  }, [prependSeq, appendSeq, disabledSeq, savedEnabledKeys])

  const filteredRows = useMemo(() => {
    const matched = rows.filter(
      ({ rule, savedEnabled }) =>
        (visibility === 'all' ||
          (visibility === 'enabled' ? savedEnabled : !savedEnabled)) &&
        match(rule),
    )
    // 原始顺序即规则命中的顺序（prepend → append）
    if (order === 'original') return matched

    return [...matched].sort((a, b) => compareRulesByHostLevel(a.rule, b.rule))
  }, [rows, match, order, visibility])

  /** 本地草稿：勾选只改这里，点保存才写回文件 */
  const draft = useMemo<SeqRulesConfig>(
    () => ({
      prepend: prependSeq,
      append: appendSeq,
      delete: deleteSeq,
      disabled: disabledSeq,
      excludeSubscriptionRules,
    }),
    [prependSeq, appendSeq, deleteSeq, disabledSeq, excludeSubscriptionRules],
  )

  /** 把草稿同步回本地状态 */
  const applyDraft = (next: SeqRulesConfig) => {
    setPrependSeq(next.prepend)
    setAppendSeq(next.append)
    setDeleteSeq(next.delete)
    setDisabledSeq(next.disabled)
    setExcludeSubscriptionRules(next.excludeSubscriptionRules)
  }

  /** 写回文件；校验失败时后端已回滚并提示，本地草稿保持不变 */
  const saveDraft = async (next: SeqRulesConfig) => {
    if (!rulesProperty) return false

    try {
      const outcome = await saveRulesFile(
        rulesProperty,
        serializeSeqRules(next),
      )

      if (outcome.status !== 'valid') return false

      // mihomo 的热重载不一定采用新规则，保存后显式重启内核
      await restartCore()

      applyDraft(next)
      setSavedSeq(next)
      setDirtyUid('')

      showNotice.success(
        t(
          isCurrentRules
            ? 'rules.custom.page.feedback.saved'
            : 'rules.custom.page.feedback.savedForProfile',
          { name: selected?.name ?? selectedUid },
        ),
      )

      return true
    } catch (err: any) {
      showNotice.error(err)
      return false
    }
  }

  /** 勾选即启用：只改本地草稿，等保存按钮统一写回 */
  const handleToggleRules = (targets: SeqRuleRow[], enabled: boolean) => {
    if (targets.length === 0) return

    applyDraft(applyRuleEnabled(draft, targets, enabled))
    setDirtyUid(selectedUid)
  }

  /** 删除单条自定义规则，连同未保存的勾选改动一起写回 */
  const handleDeleteRule = useLockFn(async (row: SeqRuleRow) => {
    await saveDraft(removeSeqRule(draft, row))
  })

  /** 编辑规则属性：原位置的规则改成新规则，重复的旧规则一并排除，只改本地草稿 */
  const handleEditRule = (row: SeqRuleRow, nextRule: string) => {
    const next = updateSeqRule(draft, row, nextRule)
    if (next === draft) return

    applyDraft(next)
    setDirtyUid(selectedUid)
  }

  /** 拖动排序后写回，未保存的勾选改动一并落盘 */
  const handleReorderRule = useLockFn(
    async (source: SeqRuleSource, from: number, to: number) => {
      const list = source === 'prepend' ? prependSeq : appendSeq
      const moved = moveItem(list, from, to)
      const next: SeqRulesConfig = {
        ...draft,
        prepend: source === 'prepend' ? moved : prependSeq,
        append: source === 'append' ? moved : appendSeq,
      }

      // 写回失败时让列表回到草稿顺序
      if (!(await saveDraft(next))) {
        setPrependSeq((prev) => [...prev])
      }
    },
  )

  /** 开关连同未保存的勾选改动一起写回 */
  const handleExcludeChange = useLockFn(async (next: boolean) => {
    await saveDraft({ ...draft, excludeSubscriptionRules: next })
  })

  /** 可迁移到的目标订阅：除当前编辑的订阅以外，所有配置了规则文件的订阅 */
  const migrateTargets = items.filter((item) => item.uid !== selectedUid)

  /**
   * 把当前订阅的全部规则（含已关闭的）复制到目标订阅，
   * 主机 / 规则类型 / 代理策略完全一样的规则直接跳过。
   */
  const handleMigrate = useLockFn(async (targetUid: string) => {
    setMigrateAnchor(null)

    const target = items.find((item) => item.uid === targetUid)
    const property = target?.option?.rules
    if (!property) return

    const name = target?.name ?? targetUid

    try {
      const { config } = await readSeqRulesDocument(property)
      const outcome = migrateSeqRules(toSeqConfig(config), rows)

      if (outcome.copied === 0) {
        showNotice.info(
          t('rules.custom.page.migrate.feedback.duplicated', {
            name,
            skipped: outcome.skipped,
          }),
        )
        return
      }

      const saved = await saveRulesFile(
        property,
        serializeSeqRules(outcome.config),
      )

      if (saved.status !== 'valid') {
        showNotice.error(t('rules.custom.page.migrate.feedback.failed'))
        return
      }

      // mihomo 的热重载不一定采用新规则，写回后显式重启内核
      await restartCore()

      showNotice.success(
        t('rules.custom.page.migrate.feedback.migrated', {
          count: outcome.copied,
          skipped: outcome.skipped,
          name,
        }),
      )
    } catch (err: any) {
      showNotice.error(err)
    }
  })

  return (
    <BasePage
      full
      title={t('rules.custom.page.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
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
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {items.map((item) => (
          <Chip
            key={item.uid}
            clickable
            size="small"
            color={item.uid === selectedUid ? 'primary' : 'default'}
            variant={item.uid === selectedUid ? 'filled' : 'outlined'}
            label={item.name ?? item.uid}
            onClick={() => setPickedUid(item.uid)}
            sx={{ flexShrink: 0, maxWidth: '240px' }}
          />
        ))}
      </Box>

      {selected && visualization ? (
        <>
          <Box
            sx={{
              mx: '10px',
              mb: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexShrink: 0,
            }}
          >
            <Switch
              checked={excludeSubscriptionRules}
              onChange={() => {
                void handleExcludeChange(!excludeSubscriptionRules)
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">
                {t('rules.custom.page.excludeSubscription.label')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('rules.custom.page.excludeSubscription.hint')}
              </Typography>
            </Box>
          </Box>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              px: '10px',
              pb: 1,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <BaseSearchBox onSearch={(next) => setMatch(() => next)} />
              </Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SortRounded />}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                onClick={() =>
                  setOrder(order === 'domain' ? 'original' : 'domain')
                }
              >
                {order === 'domain'
                  ? t('rules.custom.page.order.original')
                  : t('rules.custom.page.order.byDomain')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyRounded />}
                disabled={rows.length === 0 || migrateTargets.length === 0}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                onClick={(event) => setMigrateAnchor(event.currentTarget)}
              >
                {t('rules.custom.page.migrate.action')}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={!dirty}
                startIcon={<SaveRounded />}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                onClick={() => {
                  void saveDraft(draft)
                }}
              >
                {t('rules.custom.page.actions.save')}
              </Button>
            </Box>
            <Menu
              anchorEl={migrateAnchor}
              open={!!migrateAnchor}
              onClose={() => setMigrateAnchor(null)}
            >
              {migrateTargets.map((item) => (
                <MenuItem
                  key={item.uid}
                  selected={item.uid === current?.uid}
                  onClick={() => {
                    void handleMigrate(item.uid)
                  }}
                >
                  {item.name ?? item.uid}
                </MenuItem>
              ))}
            </Menu>
            <Box sx={{ height: 'calc(100% - 32px)', marginTop: '8px' }}>
              <SeqRulesTable
                rows={filteredRows}
                sortable={order === 'original'}
                visibility={visibility}
                onVisibilityChange={setVisibility}
                onToggle={handleToggleRules}
                onEdit={handleEditRule}
                onDelete={(row) => {
                  void handleDeleteRule(row)
                }}
                onReorder={(source, from, to) => {
                  void handleReorderRule(source, from, to)
                }}
              />
            </Box>
          </Box>
        </>
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BaseEmpty
            textKey={
              items.length === 0
                ? 'rules.custom.page.emptyProfile'
                : 'rules.custom.page.emptyRules'
            }
          />
        </Box>
      )}
    </BasePage>
  )
}

export default CustomRulesPage
