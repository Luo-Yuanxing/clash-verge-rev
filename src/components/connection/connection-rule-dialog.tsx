import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  styled,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useLocalStorage } from 'foxact/use-local-storage'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getGroups } from 'tauri-plugin-mihomo-api'

import {
  readSeqRulesDocument,
  serializeSeqRules,
  toSeqConfig,
} from '@/components/profile/seq-rules-document'
import { useProfiles } from '@/hooks/use-profiles'
import { saveProfileFile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const RULE_TYPES = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD'] as const

type RuleType = (typeof RULE_TYPES)[number]

/** PROXY 为占位符，实际写入用户选择的代理组名 */
const POLICY_OPTIONS = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PROXY'] as const

type PolicyOption = (typeof POLICY_OPTIONS)[number]

const MAX_PREVIEW_RULES = 20

/** 记住上次使用的订阅，作为下次的默认值 */
const PROFILE_STORAGE_KEY = 'connection-rule-profile-uid'
/** 记住上次使用的代理组，作为下次的默认值 */
const PROXY_GROUP_STORAGE_KEY = 'connection-rule-proxy-group'
/** 记住上次使用的代理策略，作为下次的默认值；首次默认 PROXY */
const POLICY_STORAGE_KEY = 'connection-rule-policy'

/** 表单控件统一固定宽度 */
const FIELD_SX = { width: 240 } as const
/** 下拉框固定宽度并截断过长文案 */
const SELECT_FIELD_SX = {
  ...FIELD_SX,
  '& .MuiSelect-select': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
} as const

interface Props {
  open: boolean
  /** 待创建规则的连接主机名（已去重、已剔除 IP） */
  hosts: string[]
  /** 因是 IP 而被跳过的主机数量 */
  skippedCount: number
  onClose: () => void
  onCreated?: (count: number) => void
}

export const ConnectionRuleDialog = (props: Props) => {
  const { open, hosts, skippedCount, onClose, onCreated } = props
  const { t } = useTranslation()

  const { profiles, current } = useProfiles()

  const items = useMemo(
    () =>
      (profiles?.items ?? []).filter(
        (item): item is IProfileItem => !!item && !!item.option?.rules,
      ),
    [profiles],
  )

  const [ruleType, setRuleType] = useState<RuleType>(RULE_TYPES[0])
  const [pickedPolicy, setPickedPolicy] = useLocalStorage<PolicyOption>(
    POLICY_STORAGE_KEY,
    'PROXY',
  )
  const [proxyGroups, setProxyGroups] = useState<string[]>([])
  const [pickedUid, setPickedUid] = useLocalStorage(PROFILE_STORAGE_KEY, '')
  const [pickedGroup, setPickedGroup] = useLocalStorage(
    PROXY_GROUP_STORAGE_KEY,
    '',
  )

  /** 首次默认 PROXY，之后沿用用户上次的选择 */
  const policyOption: PolicyOption = POLICY_OPTIONS.includes(pickedPolicy)
    ? pickedPolicy
    : 'PROXY'

  const selectedUid = useMemo(() => {
    if (pickedUid && items.some((item) => item.uid === pickedUid)) {
      return pickedUid
    }
    return (
      items.find((item) => item.uid === current?.uid)?.uid ??
      items[0]?.uid ??
      ''
    )
  }, [pickedUid, items, current])

  const rulesProperty = items.find((item) => item.uid === selectedUid)?.option
    ?.rules

  /** 默认使用上次选择的代理组，否则用第一个可用代理组 */
  const selectedGroup = useMemo(() => {
    if (pickedGroup && proxyGroups.includes(pickedGroup)) return pickedGroup
    return proxyGroups[0] ?? ''
  }, [pickedGroup, proxyGroups])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    void (async () => {
      try {
        const groups = await getGroups()
        if (cancelled) return
        setProxyGroups(
          (groups?.proxies ?? [])
            .map((group) => group?.name)
            .filter((name): name is string => Boolean(name)),
        )
      } catch (err) {
        console.warn('Failed to load proxy groups', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  const resolvedPolicy = policyOption === 'PROXY' ? selectedGroup : policyOption

  const rules = useMemo(
    () => hosts.map((host) => `${ruleType},${host},${resolvedPolicy}`),
    [hosts, ruleType, resolvedPolicy],
  )

  const handleCreate = useLockFn(async () => {
    if (!rulesProperty) {
      showNotice.error(
        t('connections.components.ruleDialog.errors.noRulesProfile'),
      )
      return
    }
    if (policyOption === 'PROXY' && !selectedGroup) {
      showNotice.error(
        t('connections.components.ruleDialog.errors.proxyGroupRequired'),
      )
      return
    }

    try {
      const { config } = await readSeqRulesDocument(rulesProperty)
      const {
        prepend,
        append,
        delete: deleteList,
        disabled,
        excludeSubscriptionRules,
      } = toSeqConfig(config)

      const existing = new Set<string>([...prepend, ...append])
      const created = rules.filter((rule) => {
        if (existing.has(rule)) return false
        existing.add(rule)
        return true
      })

      if (created.length === 0) {
        showNotice.info(
          t('connections.components.ruleDialog.notifications.duplicated'),
        )
        onClose()
        return
      }

      // 固定为前置规则
      const nextPrepend = [...created, ...prepend]

      if (
        !(await saveProfileFile(
          rulesProperty,
          serializeSeqRules({
            prepend: nextPrepend,
            append,
            delete: deleteList,
            disabled,
            excludeSubscriptionRules,
          }),
        ))
      ) {
        showNotice.error(
          t('connections.components.ruleDialog.errors.saveFailed'),
        )
        return
      }

      showNotice.success(
        t('connections.components.ruleDialog.notifications.created', {
          count: created.length,
        }),
      )
      setPickedUid(selectedUid)
      onCreated?.(created.length)
      onClose()
    } catch (err) {
      showNotice.error(err)
    }
  })

  const previewRules = rules.slice(0, MAX_PREVIEW_RULES)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('connections.components.ruleDialog.title')}</DialogTitle>
      <DialogContent>
        <List sx={{ padding: 0 }}>
          <Item>
            <ListItemText
              primary={t('connections.components.ruleDialog.labels.profile')}
            />
            <TextField
              select
              size="small"
              sx={SELECT_FIELD_SX}
              value={selectedUid}
              disabled={items.length === 0}
              onChange={(event) => setPickedUid(event.target.value)}
            >
              {items.map((item) => (
                <MenuItem key={item.uid} value={item.uid}>
                  {item.name ?? item.uid}
                </MenuItem>
              ))}
            </TextField>
          </Item>

          <Item>
            <ListItemText primary={t('rules.modals.editor.form.labels.type')} />
            <TextField
              select
              size="small"
              sx={SELECT_FIELD_SX}
              value={ruleType}
              onChange={(event) => setRuleType(event.target.value as RuleType)}
            >
              {RULE_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {t(`rules.modals.editor.ruleTypes.${type}`)}
                </MenuItem>
              ))}
            </TextField>
          </Item>

          <Item>
            <ListItemText
              primary={t('rules.modals.editor.form.labels.proxyPolicy')}
            />
            <TextField
              select
              size="small"
              sx={SELECT_FIELD_SX}
              value={policyOption}
              onChange={(event) =>
                setPickedPolicy(event.target.value as PolicyOption)
              }
            >
              {POLICY_OPTIONS.map((policy) => (
                <MenuItem key={policy} value={policy}>
                  {policy === 'PROXY'
                    ? t('connections.components.ruleDialog.policies.PROXY')
                    : t(`proxies.components.enums.policies.${policy}`)}
                </MenuItem>
              ))}
            </TextField>
          </Item>

          {policyOption === 'PROXY' && (
            <Item>
              <ListItemText
                primary={t(
                  'connections.components.ruleDialog.labels.proxyGroup',
                )}
              />
              <Autocomplete
                size="small"
                sx={FIELD_SX}
                options={proxyGroups}
                value={selectedGroup || null}
                onChange={(_, value) => setPickedGroup(value ?? '')}
                renderInput={(params) => <TextField {...params} />}
              />
            </Item>
          )}
        </List>

        <Typography variant="body2" sx={{ mt: 1 }}>
          {t('connections.components.ruleDialog.summary', {
            count: rules.length,
          })}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block' }}
        >
          {t('connections.components.ruleDialog.positionHint')}
        </Typography>
        {!rulesProperty && (
          <Typography variant="caption" color="error" sx={{ display: 'block' }}>
            {t('connections.components.ruleDialog.errors.noRulesProfile')}
          </Typography>
        )}
        {skippedCount > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t('connections.components.ruleDialog.skipped', {
              count: skippedCount,
            })}
          </Typography>
        )}

        <Box
          sx={{
            mt: 1,
            p: 1,
            maxHeight: 200,
            overflow: 'auto',
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontFamily: 'monospace',
            fontSize: 12,
            whiteSpace: 'pre',
          }}
        >
          {previewRules.length === 0
            ? t('connections.components.ruleDialog.empty')
            : previewRules.join('\n')}
          {rules.length > previewRules.length &&
            `\n${t('connections.components.ruleDialog.more', {
              count: rules.length - previewRules.length,
            })}`}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t('shared.actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={rules.length === 0}
        >
          {t('connections.components.ruleDialog.actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const Item = styled(ListItem)(() => ({
  padding: '5px 2px',
}))
