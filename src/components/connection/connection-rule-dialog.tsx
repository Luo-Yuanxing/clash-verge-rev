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
import { saveProfileFile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const RULE_TYPES = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD'] as const

type RuleType = (typeof RULE_TYPES)[number]

/** PROXY 为占位符，实际写入用户在该页面选择的代理组名 */
const POLICY_OPTIONS = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PROXY'] as const

type PolicyOption = (typeof POLICY_OPTIONS)[number]

type InsertPosition = 'prepend' | 'append'

const POSITION_OPTIONS: InsertPosition[] = ['prepend', 'append']

const MAX_PREVIEW_RULES = 20

interface Props {
  open: boolean
  /** 待创建规则的连接主机名（已去重、已剔除 IP） */
  hosts: string[]
  /** 因是 IP 而被跳过的主机数量 */
  skippedCount: number
  /** 当前订阅启用中的自定义规则文件的 property */
  rulesProperty?: string
  onClose: () => void
  onCreated?: (count: number) => void
}

export const ConnectionRuleDialog = (props: Props) => {
  const { open, hosts, skippedCount, rulesProperty, onClose, onCreated } = props
  const { t } = useTranslation()

  const [ruleType, setRuleType] = useState<RuleType>(RULE_TYPES[0])
  const [policyOption, setPolicyOption] = useState<PolicyOption>('DIRECT')
  const [insertPosition, setInsertPosition] =
    useState<InsertPosition>('prepend')
  const [proxyGroups, setProxyGroups] = useState<string[]>([])
  const [proxyGroup, setProxyGroup] = useLocalStorage(
    'connection-rule-proxy-group',
    '',
  )

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

  const resolvedPolicy =
    policyOption === 'PROXY' ? (proxyGroup ?? '') : policyOption

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
    if (policyOption === 'PROXY' && !proxyGroup) {
      showNotice.error(
        t('connections.components.ruleDialog.errors.proxyGroupRequired'),
      )
      return
    }

    try {
      const { config } = await readSeqRulesDocument(rulesProperty)
      const { prepend, append, delete: deleteList } = toSeqConfig(config)

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

      const nextPrepend =
        insertPosition === 'prepend' ? [...created, ...prepend] : prepend
      const nextAppend =
        insertPosition === 'append' ? [...append, ...created] : append

      if (
        !(await saveProfileFile(
          rulesProperty,
          serializeSeqRules({
            prepend: nextPrepend,
            append: nextAppend,
            delete: deleteList,
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
            <ListItemText primary={t('rules.modals.editor.form.labels.type')} />
            <TextField
              select
              size="small"
              sx={{ minWidth: 240 }}
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
              sx={{ minWidth: 240 }}
              value={policyOption}
              onChange={(event) =>
                setPolicyOption(event.target.value as PolicyOption)
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
                sx={{ minWidth: 240 }}
                options={proxyGroups}
                value={proxyGroup || null}
                onChange={(_, value) => setProxyGroup(value ?? '')}
                renderInput={(params) => <TextField {...params} />}
              />
            </Item>
          )}

          <Item>
            <ListItemText
              primary={t('connections.components.ruleDialog.labels.position')}
            />
            <TextField
              select
              size="small"
              sx={{ minWidth: 240 }}
              value={insertPosition}
              onChange={(event) =>
                setInsertPosition(event.target.value as InsertPosition)
              }
            >
              {POSITION_OPTIONS.map((position) => (
                <MenuItem key={position} value={position}>
                  {t(`connections.components.ruleDialog.positions.${position}`)}
                </MenuItem>
              ))}
            </TextField>
          </Item>
        </List>

        <Typography variant="body2" sx={{ mt: 1 }}>
          {t('connections.components.ruleDialog.summary', {
            count: rules.length,
          })}
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
