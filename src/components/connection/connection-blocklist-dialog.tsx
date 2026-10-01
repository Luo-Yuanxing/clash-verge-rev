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

import { BaseSearchBox } from '@/components/base'
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
  /** 过滤用的匹配函数，由搜索框给出（支持正则） */
  const [match, setMatch] = useState<(host: string) => boolean>(
    () => () => true,
  )

  // 每次打开都从当前黑名单重新开始，避免残留上次的勾选与搜索（渲染期同步，无需 effect）
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setSelected(new Set())
      setMatch(() => () => true)
    }
  }

  const visibleHosts = useMemo(
    () => hosts.filter((host) => match(host)),
    [hosts, match],
  )

  const allSelected =
    visibleHosts.length > 0 && visibleHosts.every((host) => selected.has(host))
  const someSelected =
    !allSelected && visibleHosts.some((host) => selected.has(host))

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

  /** 全选只作用于当前可见（过滤后）的条目，搜索时不会误改被隐藏的勾选 */
  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current)
      for (const host of visibleHosts) {
        if (allSelected) {
          next.delete(host)
        } else {
          next.add(host)
        }
      }
      return next
    })
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
            <Box sx={{ mb: 1 }}>
              <BaseSearchBox
                placeholder={t('connections.components.blocklist.search')}
                onSearch={(next) => setMatch(() => next)}
              />
            </Box>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={visibleHosts.length === 0}
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
            {visibleHosts.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: 'center' }}
              >
                {t('connections.components.blocklist.noMatch')}
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
                <List dense disablePadding>
                  {visibleHosts.map((host) => (
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
            )}
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
