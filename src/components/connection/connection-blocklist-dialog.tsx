import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'
import { normalizeBlocklist } from '@/utils/connection-blocklist'

interface Props {
  open: boolean
  onClose: () => void
}

/** 历史连接黑名单：查看条目并勾选恢复（移出黑名单） */
export const ConnectionBlocklistDialog = ({ open, onClose }: Props) => {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()

  const hosts = useMemo(
    () => normalizeBlocklist(verge?.connection_history_blocklist),
    [verge?.connection_history_blocklist],
  )

  /** 勾选待恢复的条目，关闭弹窗即丢弃 */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [wasOpen, setWasOpen] = useState(open)

  // 每次打开都从当前黑名单重新开始，避免残留上次的勾选（渲染期同步，无需 effect）
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setSelected(new Set())
  }

  const allSelected = hosts.length > 0 && selected.size === hosts.length
  const someSelected = selected.size > 0 && !allSelected

  const toggle = (host: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(host)) {
        next.delete(host)
      } else {
        next.add(host)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(hosts))
  }

  const handleRestore = useLockFn(async () => {
    const restoring = hosts.filter((host) => selected.has(host))
    if (restoring.length === 0) return

    try {
      await patchVerge({
        connection_history_blocklist: hosts.filter(
          (host) => !selected.has(host),
        ),
      })
      setSelected(new Set())
      showNotice.success(
        t('connections.components.blocklist.restored', {
          count: restoring.length,
        }),
      )
    } catch (err) {
      showNotice.error(err)
    }
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('connections.components.blocklist.title')}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 1 }}
        >
          {t('connections.components.blocklist.hint')}
        </Typography>

        {hosts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('connections.components.blocklist.empty')}
          </Typography>
        ) : (
          <>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                />
              }
              label={
                <span style={{ fontSize: 14 }}>
                  {t('connections.components.blocklist.selectAll')}
                </span>
              }
            />
            <Divider />
            <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
              <List dense disablePadding>
                {hosts.map((host) => (
                  <ListItem key={host} disableGutters sx={{ py: 0.25 }}>
                    <Checkbox
                      size="small"
                      edge="start"
                      checked={selected.has(host)}
                      onChange={() => toggle(host)}
                    />
                    <ListItemText
                      primary={host}
                      slotProps={{
                        primary: {
                          variant: 'body2',
                          sx: { wordBreak: 'break-all' },
                        },
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={onClose}>
          {t('shared.actions.close')}
        </Button>
        <Button
          variant="contained"
          disabled={selected.size === 0}
          onClick={() => void handleRestore()}
        >
          {t('connections.components.blocklist.restore')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
