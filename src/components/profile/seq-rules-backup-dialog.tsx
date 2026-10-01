import { RestoreRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { listRulesBackups, readRulesBackup } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { parseYamlSafe } from '@/utils/yaml'

import { toSeqConfig } from './seq-rules-document'

/** 一份存档：元信息 + 已读入的内容与规则条数 */
export interface SeqRulesBackup extends IRulesBackupInfo {
  content: string
  /** 存档里的规则条数，含已关闭的 */
  count: number
}

interface Props {
  open: boolean
  /** 订阅的规则文件 uid（option.rules）：为空时不加载存档 */
  property: string
  /** 正在用存档覆盖规则文件 */
  restoring?: boolean
  onClose: () => void
  onRestore: (backup: SeqRulesBackup) => void
}

/** 统计存档里的规则条数：启用中的与已关闭的都算 */
const countRules = (content: string): number => {
  const config = toSeqConfig(
    parseYamlSafe(content) as ISeqProfileConfig | null | undefined,
  )

  return (
    config.prepend.length +
    config.append.length +
    config.delete.length +
    config.disabled.prepend.length +
    config.disabled.append.length
  )
}

/** 存档大小按 KB / MB 显示 */
const formatSize = (size: number): string =>
  size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`

/** 自定义规则的本地存档：左侧选存档，右侧预览内容，确认后用存档覆盖当前规则 */
export const SeqRulesBackupDialog = (props: Props) => {
  const { open, property, restoring, onClose, onRestore } = props
  const { t } = useTranslation()

  const [backups, setBackups] = useState<SeqRulesBackup[]>([])
  const [pickedName, setPickedName] = useState('')
  const [loading, setLoading] = useState(false)

  /** 打开弹窗或切换订阅时重新读取存档：内容一次读入，预览不必再回后端 */
  const loadBackups = useCallback(async (filesFor: string) => {
    setLoading(true)
    setBackups([])
    setPickedName('')

    try {
      const list = await listRulesBackups(filesFor)
      const loaded = await Promise.all(
        list.map(async (backup) => {
          const content = await readRulesBackup(filesFor, backup.name)
          return { ...backup, content, count: countRules(content) }
        }),
      )

      setBackups(loaded)
      setPickedName(loaded[0]?.name ?? '')
    } catch (err: any) {
      showNotice.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !property) return

    void loadBackups(property)
  }, [open, property, loadBackups])

  const picked = backups.find((backup) => backup.name === pickedName)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('rules.custom.page.backup.dialogTitle')}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', gap: 1.5, height: '420px', pb: 1 }}
      >
        <Box
          sx={{
            width: '260px',
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            overflow: 'auto',
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : backups.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ p: 2, textAlign: 'center' }}
            >
              {t('rules.custom.page.backup.empty')}
            </Typography>
          ) : (
            <List sx={{ p: 0 }}>
              {backups.map((backup) => (
                <ListItemButton
                  key={backup.name}
                  selected={backup.name === pickedName}
                  onClick={() => setPickedName(backup.name)}
                >
                  <ListItemText
                    primary={dayjs(backup.created).format(
                      'YYYY-MM-DD HH:mm:ss',
                    )}
                    secondary={t('rules.custom.page.backup.entry', {
                      count: backup.count,
                      size: formatSize(backup.size),
                    })}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {t('rules.custom.page.backup.preview')}
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              borderRadius: 1,
              backgroundColor: 'action.hover',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {picked?.content ?? ''}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flex: 1, textAlign: 'left' }}
        >
          {t('rules.custom.page.backup.hint')}
        </Typography>
        <Button variant="outlined" onClick={onClose}>
          {t('shared.actions.close')}
        </Button>
        <Button
          variant="contained"
          startIcon={<RestoreRounded />}
          disabled={!picked || restoring}
          onClick={() => picked && onRestore(picked)}
        >
          {t('rules.custom.page.backup.restore')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
