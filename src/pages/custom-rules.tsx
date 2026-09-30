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
  type SeqRuleVisibility,
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
  /** 列表只显示启用中的规则，或只显示已关闭的规则 */
  const [visibility, setVisibility] = useState<SeqRuleVisibility>('enabled')

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
    disabledSeq,
    setDisabledSeq,
    excludeSubscriptionRules,
    setExcludeSubscriptionRules,
  } = useSeqRuleConfig(selected?.option?.rules ?? '', !!selected)

  const rulesProperty = selected?.option?.rules

  const rows = useMemo<SeqRuleRow[]>(
    () => [
      ...prependSeq.map((rule) => ({
        rule,
        source: 'prepend' as const,
        enabled: true,
      })),
      ...appendSeq.map((rule) => ({
        rule,
        source: 'append' as const,
        enabled: true,
      })),
      ...disabledSeq.prepend.map((rule) => ({
        rule,
        source: 'prepend' as const,
        enabled: false,
      })),
      ...disabledSeq.append.map((rule) => ({
        rule,
        source: 'append' as const,
        enabled: false,
      })),
    ],
    [prependSeq, appendSeq, disabledSeq],
  )

  const filteredRows = useMemo(() => {
    const matched = rows.filter(
      ({ rule, enabled }) =>
        (visibility === 'enabled' ? enabled : !enabled) && match(rule),
    )
    // 原始顺序即规则命中的顺序（prepend → append）
    if (order === 'original') return matched

    return [...matched].sort((a, b) => compareRulesByHostLevel(a.rule, b.rule))
  }, [rows, match, order, visibility])

  /** 勾选即启用：关闭的规则移入 disabled，不再写进 prepend/append */
  const handleToggleRules = useLockFn(
    async (targets: SeqRuleRow[], enabled: boolean) => {
      if (!rulesProperty || targets.length === 0) return

      try {
        const { config } = await readSeqRulesDocument(rulesProperty)
        const current = toSeqConfig(config)
        const nextPrepend = [...current.prepend]
        const nextAppend = [...current.append]
        const nextDisabled = {
          prepend: [...current.disabled.prepend],
          append: [...current.disabled.append],
        }

        for (const { rule, source } of targets) {
          const sequence = source === 'prepend' ? nextPrepend : nextAppend
          const closed =
            source === 'prepend' ? nextDisabled.prepend : nextDisabled.append

          if (enabled) {
            const index = closed.indexOf(rule)
            if (index >= 0) closed.splice(index, 1)
            if (!sequence.includes(rule)) sequence.push(rule)
          } else {
            for (let i = sequence.length - 1; i >= 0; i -= 1) {
              if (sequence[i] === rule) sequence.splice(i, 1)
            }
            if (!closed.includes(rule)) closed.push(rule)
          }
        }

        const saved = await saveProfileFile(
          rulesProperty,
          serializeSeqRules({
            ...current,
            prepend: nextPrepend,
            append: nextAppend,
            disabled: nextDisabled,
          }),
        )

        // 校验失败时后端已回滚并提示，这里保持原状
        if (!saved) return

        setPrependSeq(nextPrepend)
        setAppendSeq(nextAppend)
        setDisabledSeq(nextDisabled)
      } catch (err: any) {
        showNotice.error(err)
      }
    },
  )

  /** 删除单条自定义规则并写回文件 */
  const handleDeleteRule = useLockFn(
    async ({ rule, source, enabled }: SeqRuleRow) => {
      if (!rulesProperty) return

      try {
        const { config } = await readSeqRulesDocument(rulesProperty)
        const current = toSeqConfig(config)
        const nextDisabled = {
          prepend: [...current.disabled.prepend],
          append: [...current.disabled.append],
        }

        let nextPrepend = current.prepend
        let nextAppend = current.append

        if (enabled) {
          nextPrepend =
            source === 'prepend'
              ? current.prepend.filter((item) => item !== rule)
              : current.prepend
          nextAppend =
            source === 'append'
              ? current.append.filter((item) => item !== rule)
              : current.append
        } else if (source === 'prepend') {
          nextDisabled.prepend = nextDisabled.prepend.filter(
            (item) => item !== rule,
          )
        } else {
          nextDisabled.append = nextDisabled.append.filter(
            (item) => item !== rule,
          )
        }

        const saved = await saveProfileFile(
          rulesProperty,
          serializeSeqRules({
            ...current,
            prepend: nextPrepend,
            append: nextAppend,
            disabled: nextDisabled,
          }),
        )

        // 校验失败时后端已回滚并提示
        if (!saved) return

        setPrependSeq(nextPrepend)
        setAppendSeq(nextAppend)
        setDisabledSeq(nextDisabled)
      } catch (err: any) {
        showNotice.error(err)
      }
    },
  )

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
      const {
        prepend,
        append,
        delete: deleteList,
        disabled,
      } = toSeqConfig(config)

      const saved = await saveProfileFile(
        rulesProperty,
        serializeSeqRules({
          prepend,
          append,
          delete: deleteList,
          disabled,
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
                visibility={visibility}
                onVisibilityChange={setVisibility}
                onToggle={(targets, enabled) => {
                  void handleToggleRules(targets, enabled)
                }}
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
