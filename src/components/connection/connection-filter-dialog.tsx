import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** 连接列表的筛选开关 */
export interface ConnectionFilters {
  /** 排除目标为裸 IP 的记录 */
  excludeIp: boolean
  /** 隐藏主机已被自定义规则覆盖的记录 */
  hideCovered: boolean
}

/** 弹窗里的选项，新增筛选项时在这里追加即可 */
const FILTER_OPTIONS = [
  { id: 'excludeIp', labelKey: 'connections.components.filters.excludeIp' },
  {
    id: 'hideCovered',
    labelKey: 'connections.components.filters.hideCovered',
  },
] as const

interface Props {
  open: boolean
  filters: ConnectionFilters
  onClose: () => void
  /** 点确认时回传勾选结果，取消不改动筛选 */
  onApply: (next: ConnectionFilters) => void
}

export const ConnectionFilterDialog = ({
  open,
  filters,
  onClose,
  onApply,
}: Props) => {
  const { t } = useTranslation()
  /** 弹窗内的草稿，确认之前不影响列表 */
  const [draft, setDraft] = useState<ConnectionFilters | null>(null)
  const value = draft ?? filters

  const close = (apply: boolean) => {
    if (apply) onApply(value)
    setDraft(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={() => close(false)} maxWidth="xs" fullWidth>
      <DialogTitle>{t('connections.components.filters.title')}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <List dense disablePadding>
          {FILTER_OPTIONS.map((option) => (
            <ListItem key={option.id} disableGutters sx={{ py: 0.5 }}>
              <Checkbox
                edge="start"
                checked={value[option.id]}
                onChange={(event) =>
                  setDraft({ ...value, [option.id]: event.target.checked })
                }
              />
              <ListItemText
                primary={t(option.labelKey)}
                slotProps={{ primary: { variant: 'body2' } }}
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={() => close(false)}>
          {t('shared.actions.cancel')}
        </Button>
        <Button variant="contained" onClick={() => close(true)}>
          {t('shared.actions.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
