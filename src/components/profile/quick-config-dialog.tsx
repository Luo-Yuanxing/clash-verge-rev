import {
  ContentCopyRounded,
  DownloadRounded,
  UploadRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, type DialogRef } from '@/components/base'
import { showNotice } from '@/services/notice-service'
import { revalidateQuery } from '@/services/query-client'
import {
  exportQuickConfig,
  importQuickConfig,
  QuickConfigError,
  type QuickConfigScope,
} from '@/services/quick-config'

const ERROR_KEYS = {
  invalid: 'profiles.modals.quickConfig.feedback.invalid',
  profile: 'profiles.modals.quickConfig.feedback.profileFailed',
  rules: 'profiles.modals.quickConfig.feedback.rulesFailed',
} as const

export const QuickConfigDialog = forwardRef<DialogRef>((_, ref) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<QuickConfigScope>('all')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const close = () => setOpen(false)

  const run = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await task()
    } catch (err) {
      showNotice.error(
        err instanceof QuickConfigError
          ? ERROR_KEYS[err.code]
          : 'profiles.modals.quickConfig.feedback.failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const onExport = () =>
    run(async () => {
      const base64 = await exportQuickConfig(scope)
      setText(base64)
      await writeText(base64)
      showNotice.success('profiles.modals.quickConfig.feedback.exported')
    })

  const onCopy = () =>
    run(async () => {
      await writeText(text)
      showNotice.success('profiles.modals.quickConfig.feedback.copied')
    })

  const onImport = () =>
    run(async () => {
      const result = await importQuickConfig(text)
      await revalidateQuery(['getProfiles'])
      await revalidateQuery(['getVergeConfig'])

      showNotice.success(
        result.name
          ? {
              key: 'profiles.modals.quickConfig.feedback.imported',
              params: { name: result.name },
            }
          : 'profiles.modals.quickConfig.feedback.importedSettingsOnly',
      )
      setText('')
      close()
    })

  return (
    <BaseDialog
      open={open}
      title={t('profiles.modals.quickConfig.title')}
      onClose={close}
      disableFooter
      contentSx={{ width: 520 }}
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t('profiles.modals.quickConfig.scope.label')}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(_, next: QuickConfigScope | null) => {
              if (next) setScope(next)
            }}
          >
            <ToggleButton value="all">
              {t('profiles.modals.quickConfig.scope.all')}
            </ToggleButton>
            <ToggleButton value="just-rule">
              {t('profiles.modals.quickConfig.scope.justRule')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <TextField
          multiline
          minRows={8}
          maxRows={12}
          fullWidth
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('profiles.modals.quickConfig.import.placeholder')}
          slotProps={{
            input: { sx: { fontFamily: 'monospace', fontSize: 12 } },
          }}
        />

        <Typography variant="caption" color="text.secondary">
          {t('profiles.modals.quickConfig.hint')}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="outlined"
            loading={busy}
            startIcon={<DownloadRounded />}
            onClick={onExport}
          >
            {t('profiles.modals.quickConfig.export.action')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={!text || busy}
            startIcon={<ContentCopyRounded />}
            onClick={onCopy}
          >
            {t('profiles.modals.quickConfig.export.copy')}
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!text || busy}
            startIcon={<UploadRounded />}
            onClick={onImport}
          >
            {t('profiles.modals.quickConfig.import.action')}
          </Button>
        </Stack>
      </Stack>
    </BaseDialog>
  )
})
