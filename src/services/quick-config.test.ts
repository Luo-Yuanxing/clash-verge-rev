import { describe, expect, it, vi } from 'vitest'

import {
  createProfile,
  getProfiles,
  listLocalBackup,
  restoreLocalBackup,
  writeLocalBackupBase64,
} from '@/services/cmds'

import {
  importQuickConfig,
  parseQuickConfig,
  QUICK_CONFIG_TYPE,
  QUICK_CONFIG_VERSION,
  QuickConfigError,
} from './quick-config'

vi.mock('@/services/cmds', () => ({
  createLocalBackup: vi.fn(),
  createProfile: vi.fn(),
  getProfiles: vi.fn(),
  listLocalBackup: vi.fn(),
  readLocalBackupBase64: vi.fn(),
  readProfileFile: vi.fn(),
  restoreLocalBackup: vi.fn(),
  saveRulesFile: vi.fn(),
  writeLocalBackupBase64: vi.fn(),
}))

const encode = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))

const quickConfig = (patch: Record<string, unknown> = {}): string =>
  encode(
    JSON.stringify({
      type: QUICK_CONFIG_TYPE,
      version: QUICK_CONFIG_VERSION,
      scope: 'just-rule',
      exported_at: '2026-01-01T00:00:00.000Z',
      ...patch,
    }),
  )

/** 只关心失败原因，取回错误码便于断言 */
const errorCode = async (task: () => unknown): Promise<string> => {
  try {
    await task()
  } catch (err) {
    return err instanceof QuickConfigError
      ? err.code
      : `unexpected: ${String(err)}`
  }
  return 'no-error'
}

describe('parseQuickConfig', () => {
  it('accepts a payload exported by this app', () => {
    expect(parseQuickConfig(quickConfig()).scope).toBe('just-rule')
  })

  it('reports a malformed base64 string', async () => {
    await expect(
      errorCode(() => parseQuickConfig('!!!not-base64!!!')),
    ).resolves.toBe('format')
  })

  it('reports content that is not json', async () => {
    await expect(
      errorCode(() => parseQuickConfig(encode('hello'))),
    ).resolves.toBe('json')
  })

  it('reports an unknown payload type', async () => {
    await expect(
      errorCode(() => parseQuickConfig(quickConfig({ type: 'other' }))),
    ).resolves.toBe('type')
  })

  it('reports a missing type field', async () => {
    await expect(
      errorCode(() => parseQuickConfig(quickConfig({ type: undefined }))),
    ).resolves.toBe('missing')
  })

  it('reports a missing version field', async () => {
    await expect(
      errorCode(() => parseQuickConfig(quickConfig({ version: undefined }))),
    ).resolves.toBe('missing')
  })

  it('reports a version mismatch with both versions', () => {
    try {
      parseQuickConfig(quickConfig({ version: QUICK_CONFIG_VERSION + 1 }))
    } catch (err) {
      expect((err as QuickConfigError).code).toBe('version')
      expect((err as QuickConfigError).params).toEqual({
        expected: QUICK_CONFIG_VERSION,
        actual: QUICK_CONFIG_VERSION + 1,
      })
      return
    }
    throw new Error('expected a version mismatch')
  })

  it('reports a missing scope field', async () => {
    await expect(
      errorCode(() => parseQuickConfig(quickConfig({ scope: undefined }))),
    ).resolves.toBe('missing')
  })
})

describe('importQuickConfig scope check', () => {
  it('rejects a rules-only payload imported as "all"', async () => {
    await expect(
      errorCode(() => importQuickConfig(quickConfig(), 'all')),
    ).resolves.toBe('scope')
  })

  it('rejects a backup payload imported as "just-rule"', async () => {
    const backup = `cv1:${encode('payload')}`

    await expect(
      errorCode(() => importQuickConfig(backup, 'just-rule')),
    ).resolves.toBe('scope')
  })

  it('rejects an empty input', async () => {
    await expect(
      errorCode(() => importQuickConfig('   ', 'all')),
    ).resolves.toBe('format')
  })
})

describe('importQuickConfig backup payload', () => {
  const backupText = (): string =>
    `cv1:${encode('settings')}\n#rules=${encode('[]')}`

  const stubRestore = (names: string[] = []): void => {
    vi.mocked(listLocalBackup).mockResolvedValue([])
    vi.mocked(writeLocalBackupBase64).mockImplementation(async (name) => name)
    vi.mocked(restoreLocalBackup).mockResolvedValue()
    vi.mocked(createProfile).mockResolvedValue()
    vi.mocked(getProfiles).mockResolvedValue({
      items: names.map((name) => ({ name })),
      current: '',
    } as unknown as IProfilesConfig)
  }

  it('restores the settings and creates an empty profile named after the payload', async () => {
    stubRestore()

    const text = backupText()

    await expect(importQuickConfig(text, 'all')).resolves.toEqual({
      name: text.slice(0, 8),
      backupFile: expect.stringMatching(/\.zip$/u),
    })
    // 恢复按备份目录里的文件名查找，传路径会报 Backup file not found
    expect(restoreLocalBackup).toHaveBeenCalledWith(
      expect.stringMatching(/\.zip$/u),
    )
    // 载荷里的规则字符串不导入
    expect(createProfile).toHaveBeenCalledWith({
      type: 'local',
      name: text.slice(0, 8),
      desc: '',
    })
  })

  it('appends `*` when the profile name is already taken', async () => {
    const text = backupText()
    stubRestore([text.slice(0, 8)])

    await expect(importQuickConfig(text, 'all')).resolves.toMatchObject({
      name: `${text.slice(0, 8)}*`,
    })
  })
})
