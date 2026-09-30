import { SortRounded } from '@mui/icons-material'
import { Box, Button, Chip, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage, BaseSearchBox, Switch } from '@/components/base'
import {
  compareRulesByHostLevel,
  moveItem,
} from '@/components/profile/rule-fields'
import {
  findFirstNonEmptyRulesUid,
  readSeqRulesDocument,
  serializeSeqRules,
  toSeqConfig,
} from '@/components/profile/seq-rules-document'
import {
  type SeqRuleRow,
  type SeqRuleSource,
  SeqRulesTable,
} from '@/components/profile/seq-rules-table'
import { useSeqRuleConfig } from '@/components/profile/use-seq-rule-config'
import { useProfiles } from '@/hooks/use-profiles'
import { useVisibility } from '@/hooks/use-visibility'
import { saveProfileFile } from '@/services/cmds'
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

  const {
    visualization,
    match,
    setMatch,
    prependSeq,
    setPrependSeq,
    appendSeq,
    setAppendSeq,
    excludeSubscriptionRules,
    setExcludeSubscriptionRules,
  } = useSeqRuleConfig(selected?.option?.rules ?? '', !!selected)

  const rulesProperty = selected?.option?.rules

  const rows = useMemo<SeqRuleRow[]>(
    () => [
      ...prependSeq.map((rule) => ({ rule, source: 'prepend' as const })),
      ...appendSeq.map((rule) => ({ rule, source: 'append' as const })),
    ],
    [prependSeq, appendSeq],
  )

  const filteredRows = useMemo(() => {
    const matched = rows.filter(({ rule }) => match(rule))
    // 原始顺序即规则命中的顺序（prepend → append）
    if (order === 'original') return matched

    return [...matched].sort((a, b) => compareRulesByHostLevel(a.rule, b.rule))
  }, [rows, match, order])

  /** 删除单条自定义规则并写回文件 */
  const handleDeleteRule = useLockFn(async ({ rule, source }: SeqRuleRow) => {
    if (!rulesProperty) return

    try {
      const { config } = await readSeqRulesDocument(rulesProperty)
      const current = toSeqConfig(config)
      const nextPrepend =
        source === 'prepend'
          ? current.prepend.filter((item) => item !== rule)
          : current.prepend
      const nextAppend =
        source === 'append'
          ? current.append.filter((item) => item !== rule)
          : current.append

      const saved = await saveProfileFile(
        rulesProperty,
        serializeSeqRules({
          ...current,
          prepend: nextPrepend,
          append: nextAppend,
        }),
      )

      // 校验失败时后端已回滚并提示
      if (!saved) return

      setPrependSeq(nextPrepend)
      setAppendSeq(nextAppend)
    } catch (err: any) {
      showNotice.error(err)
    }
  })

  /** 拖动排序后立即写回文件 */
  const handleReorderRule = useLockFn(
    async (source: SeqRuleSource, from: number, to: number) => {
      if (!rulesProperty) return

      const list = source === 'prepend' ? prependSeq : appendSeq
      const moved = moveItem(list, from, to)
      const nextPrepend = source === 'prepend' ? moved : prependSeq
      const nextAppend = source === 'append' ? moved : appendSeq

      try {
        const { config } = await readSeqRulesDocument(rulesProperty)
        const current = toSeqConfig(config)

        const saved = await saveProfileFile(
          rulesProperty,
          serializeSeqRules({
            ...current,
            prepend: nextPrepend,
            append: nextAppend,
          }),
        )

        // 校验失败时后端已回滚并提示，这里让列表回到文件里的顺序
        if (!saved) {
          setPrependSeq((prev) => [...prev])
          return
        }

        setPrependSeq(nextPrepend)
        setAppendSeq(nextAppend)
      } catch (err: any) {
        showNotice.error(err)
      }
    },
  )

  /** 开关即保存，写回后由后端校验并应用到运行时 */
  const handleExcludeChange = useLockFn(async (next: boolean) => {
    if (!rulesProperty) return

    try {
      const { config } = await readSeqRulesDocument(rulesProperty)
      const { prepend, append, delete: deleteList } = toSeqConfig(config)

      const saved = await saveProfileFile(
        rulesProperty,
        serializeSeqRules({
          prepend,
          append,
          delete: deleteList,
          excludeSubscriptionRules: next,
        }),
      )

      // 校验失败时后端已回滚并提示，这里保持开关原状
      if (!saved) return

      setExcludeSubscriptionRules(next)
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
            </Box>
            <Box sx={{ height: 'calc(100% - 32px)', marginTop: '8px' }}>
              <SeqRulesTable
                rows={filteredRows}
                sortable={order === 'original'}
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
