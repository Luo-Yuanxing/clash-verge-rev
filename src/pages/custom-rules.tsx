import {
  ContentCopyRounded,
  DeleteForeverRounded,
  RestoreRounded,
  SaveRounded,
  SortRounded,
} from '@mui/icons-material'
import { Box, Button, Chip, Menu, MenuItem, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BaseDialog,
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  Switch,
} from '@/components/base'
import {
  compareRulesByHostLevel,
  moveItem,
} from '@/components/profile/rule-fields'
import {
  type SeqRulesBackup,
  SeqRulesBackupDialog,
} from '@/components/profile/seq-rules-backup-dialog'
import {
  applyRuleEnabled,
  findFirstNonEmptyRulesUid,
  isSameSeqRulesConfig,
  readSeqRulesDocument,
  removeSeqRule,
  type SeqRulesConfig,
  seqRuleRowId,
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
  /** 表格里勾选「删除」的行 id，连同所属订阅一起记，切换订阅后自动失效 */
  const [deletePicked, setDeletePicked] = useState<{
    uid: string
    ids: string[]
  }>({ uid: '', ids: [] })
  /** 一键删除前的确认对话框 */
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** 规则存档弹窗 */
  const [backupOpen, setBackupOpen] = useState(false)
  /** 正在用存档覆盖规则文件 */
  const [restoring, setRestoring] = useState(false)

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
    resetContent,
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

  /** 最近一次显示在界面上的草稿：判断后台写回失败时是否还能回滚 */
  const draftRef = useRef<SeqRulesConfig>(draft)
  /** 规则文件是异步读入的，草稿在首次渲染之后才成形，每次渲染都要把最新草稿记下来 */
  draftRef.current = draft
  /** 后台写回队列：连续操作串行落盘，避免两次写同一个文件互相覆盖 */
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  /** 把草稿同步回本地状态 */
  const applyDraft = (next: SeqRulesConfig) => {
    draftRef.current = next
    setPrependSeq(next.prepend)
    setAppendSeq(next.append)
    setDeleteSeq(next.delete)
    setDisabledSeq(next.disabled)
    setExcludeSubscriptionRules(next.excludeSubscriptionRules)
  }

  /**
   * 落盘：校验失败或异常时回到写之前的草稿（后端已回滚文件）。
   * 已经被更新的草稿取代时不回滚、不重启、不提示，交给最后那次写回处理。
   */
  const persistDraft = async (next: SeqRulesConfig, prev: SeqRulesConfig) => {
    if (!rulesProperty) return false

    try {
      const outcome = await saveRulesFile(
        rulesProperty,
        serializeSeqRules(next),
      )

      if (outcome.status !== 'valid') {
        if (isSameSeqRulesConfig(draftRef.current, next)) applyDraft(prev)
        return false
      }

      if (!isSameSeqRulesConfig(draftRef.current, next)) return true

      // mihomo 的热重载不一定采用新规则，保存后显式重启内核
      await restartCore()

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
      if (isSameSeqRulesConfig(draftRef.current, next)) applyDraft(prev)
      showNotice.error(err)
      return false
    }
  }

  /**
   * 先更新界面再串行落盘：删除 / 排序 / 开关立即生效，写回与内核重启在后台完成。
   * 草稿里有未保存的勾选改动时一并写回，成功后才清掉未保存标记。
   */
  const saveDraft = (next: SeqRulesConfig) => {
    const prev = draftRef.current
    if (prev !== next) applyDraft(next)

    const task = writeQueueRef.current.then(() => persistDraft(next, prev))
    writeQueueRef.current = task.catch(() => undefined)
    return task
  }

  /** 勾选即启用：只改本地草稿，等保存按钮统一写回 */
  const handleToggleRules = (targets: SeqRuleRow[], enabled: boolean) => {
    if (targets.length === 0) return

    applyDraft(applyRuleEnabled(draft, targets, enabled))
    setDirtyUid(selectedUid)
  }

  /** 当前订阅里勾选待删除的行 id */
  const deleteIds = deletePicked.uid === selectedUid ? deletePicked.ids : []

  /** 勾选 / 取消勾选待删除的行，表头全选也走这里 */
  const handleDeleteSelect = (targets: SeqRuleRow[], selected: boolean) => {
    const picked = new Set(deleteIds)
    for (const row of targets) {
      const id = seqRuleRowId(row)
      if (selected) picked.add(id)
      else picked.delete(id)
    }

    setDeletePicked({ uid: selectedUid, ids: [...picked] })
  }

  /** 一键删除勾选的行：一次性写回并只重启一次内核 */
  const handleDeleteSelected = () => {
    setConfirmDelete(false)

    const picked = new Set(deleteIds)
    const targets = rows.filter((row) => picked.has(seqRuleRowId(row)))
    if (targets.length === 0) return

    // 必须从界面上正在显示的草稿出发：规则文件异步读入，挂载时的草稿还是空的
    const next = targets.reduce(
      (config, row) => removeSeqRule(config, row),
      draft,
    )

    setDeletePicked({ uid: selectedUid, ids: [] })
    void saveDraft(next)
  }

  /**
   * 用存档覆盖规则文件：写回前当前版本会由后端先存为一份存档，
   * 写回成功后重启内核并重新读取规则，界面回到该存档的内容。
   */
  const handleRestoreBackup = useLockFn(async (backup: SeqRulesBackup) => {
    if (!rulesProperty) return

    setRestoring(true)
    try {
      const task = writeQueueRef.current.then(async () => {
        const outcome = await saveRulesFile(rulesProperty, backup.content)
        if (outcome.status !== 'valid') return false

        // mihomo 的热重载不一定采用新规则，写回后显式重启内核
        await restartCore()
        return true
      })
      writeQueueRef.current = task.catch(() => undefined)

      if (!(await task)) return

      setDeletePicked({ uid: selectedUid, ids: [] })
      setDirtyUid('')
      await resetContent()
      showNotice.success(t('rules.custom.page.backup.feedback.restored'))
      setBackupOpen(false)
    } catch (err: any) {
      showNotice.error(err)
    } finally {
      setRestoring(false)
    }
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
                variant="outlined"
                startIcon={<RestoreRounded />}
                disabled={!rulesProperty}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                onClick={() => setBackupOpen(true)}
              >
                {t('rules.custom.page.backup.action')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteForeverRounded />}
                disabled={deleteIds.length === 0}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                onClick={() => setConfirmDelete(true)}
              >
                {t('rules.custom.page.delete.action')}
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
                deleteIds={deleteIds}
                onDeleteSelect={handleDeleteSelect}
                onReorder={(source, from, to) => {
                  void handleReorderRule(source, from, to)
                }}
              />
            </Box>
          </Box>
          <BaseDialog
            open={confirmDelete}
            title={t('rules.custom.page.delete.confirmTitle')}
            okBtn={t('shared.actions.confirm')}
            cancelBtn={t('shared.actions.cancel')}
            onOk={handleDeleteSelected}
            onCancel={() => setConfirmDelete(false)}
            onClose={() => setConfirmDelete(false)}
          >
            <Typography variant="body2">
              {t('rules.custom.page.delete.confirmText', {
                count: deleteIds.length,
              })}
            </Typography>
          </BaseDialog>
          <SeqRulesBackupDialog
            open={backupOpen}
            property={rulesProperty ?? ''}
            restoring={restoring}
            onClose={() => setBackupOpen(false)}
            onRestore={(backup) => {
              void handleRestoreBackup(backup)
            }}
          />
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
