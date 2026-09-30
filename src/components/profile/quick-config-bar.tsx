import {
  ClearRounded,
  ContentPasteRounded,
  DownloadRounded,
  UploadRounded,
} from '@mui/icons-material'
import {
  Button,
  Divider,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseStyledTextField } from '@/components/base'
import { showNotice } from '@/services/notice-service'
import { revalidateQuery } from '@/services/query-client'
import {
  exportQuickConfig,
  importQuickConfig,
  QuickConfigError,
  type QuickConfigScope,
} from '@/services/quick-config'

const ERROR_KEYS = {
  invalid: 'profiles.page.quickConfig.feedback.invalid',
  profile: 'profiles.page.quickConfig.feedback.profileFailed',
  rules: 'profiles.page.quickConfig.feedback.rulesFailed',
} as const

const TOGGLE_SX = {
  px: 1.25,
  py: 0.25,
  whiteSpace: 'nowrap',
  textTransform: 'none',
} as const

export const QuickConfigBar = () => {
  const { t } = useTranslation()
  const [scope, setScope] = useState<QuickConfigScope>('all')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await task()
    } catch (err) {
      showNotice.error(
        err instanceof QuickConfigError
          ? ERROR_KEYS[err.code]
          : 'profiles.page.quickConfig.feedback.failed',
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
      showNotice.success('profiles.page.quickConfig.feedback.exported')
    })

  const onImport = () =>
    run(async () => {
      const result = await importQuickConfig(text)
      await revalidateQuery(['getProfiles'])
      await revalidateQuery(['getVergeConfig'])

      showNotice.success(
        result.name
          ? {
              key: 'profiles.page.quickConfig.feedback.imported',
              params: { name: result.name },
            }
          : 'profiles.page.quickConfig.feedback.importedSettingsOnly',
      )
      setText('')
    })

  const onPaste = async () => {
    try {
      const clipboard = await readText()
      if (clipboard) setText(clipboard)
    } catch {
      showNotice.error('profiles.page.quickConfig.feedback.failed')
    }
  }

  return (
    <>
      <Divider variant="middle" sx={{ mx: '10px' }} />
      <Stack
        direction="row"
        spacing={1}
        sx={{
          pt: 1,
          mb: 0.5,
          mx: '10px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={scope}
          onChange={(_, next: QuickConfigScope | null) => {
            if (next) setScope(next)
          }}
          sx={{ flexShrink: 0 }}
        >
          <ToggleButton
            value="all"
            title={t('profiles.page.quickConfig.scope.allHint')}
            sx={TOGGLE_SX}
          >
            {t('profiles.page.quickConfig.scope.all')}
          </ToggleButton>
          <ToggleButton
            value="just-rule"
            title={t('profiles.page.quickConfig.scope.justRuleHint')}
            sx={TOGGLE_SX}
          >
            {t('profiles.page.quickConfig.scope.justRule')}
          </ToggleButton>
        </ToggleButtonGroup>

        <BaseStyledTextField
          value={text}
          variant="outlined"
          onChange={(event) => setText(event.target.value)}
          placeholder={t('profiles.page.quickConfig.placeholder')}
          slotProps={{
            input: {
              sx: { fontFamily: 'monospace', fontSize: 12, pr: 1 },
              endAdornment: text ? (
                <IconButton
                  size="small"
                  sx={{ p: 0.5 }}
                  title={t('shared.actions.clear')}
                  onClick={() => setText('')}
                >
                  <ClearRounded fontSize="inherit" />
                </IconButton>
              ) : (
                <IconButton
                  size="small"
                  sx={{ p: 0.5 }}
                  title={t('profiles.page.importForm.actions.paste')}
                  onClick={() => {
                    void onPaste()
                  }}
                >
                  <ContentPasteRounded fontSize="inherit" />
                </IconButton>
              ),
            },
          }}
        />

        <Button
          size="small"
          variant="outlined"
          loading={busy}
          startIcon={<DownloadRounded />}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap', borderRadius: '6px' }}
          onClick={() => {
            void onExport()
          }}
        >
          {t('profiles.page.quickConfig.export')}
        </Button>

        <Button
          size="small"
          variant="contained"
          disabled={!text || busy}
          startIcon={<UploadRounded />}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap', borderRadius: '6px' }}
          onClick={() => {
            void onImport()
          }}
        >
          {t('profiles.page.quickConfig.import')}
        </Button>
      </Stack>
    </>
  )
}
