import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createProfile,
  getProfiles,
  listLocalBackup,
  restoreLocalBackup,
  saveRulesFile,
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
  const backupText = (rules: unknown[] = []): string =>
    `cv1:${encode('settings')}\n#rules=${encode(JSON.stringify(rules))}`

  /** 期望的最终订阅名：载荷前八位，重名在末尾补 `*` */
  const expectedName = (text: string, taken: string[] = []): string => {
    let name = text.slice(0, 8)
    while (taken.includes(name)) name += '*'
    return name
  }

  /** 备份目录为空、落盘与恢复都成功；getProfiles 第一次给已有订阅，之后附带新建的订阅 */
  const stubBackup = (text: string, taken: string[] = []): void => {
    const name = expectedName(text, taken)
    const existing = taken.map((item) => ({ name: item }))
    let reads = 0

    vi.mocked(listLocalBackup).mockResolvedValue([])
    vi.mocked(writeLocalBackupBase64).mockImplementation(async (file) => file)
    vi.mocked(restoreLocalBackup).mockResolvedValue()
    vi.mocked(createProfile).mockResolvedValue()
    vi.mocked(saveRulesFile).mockResolvedValue({ status: 'valid' })
    vi.mocked(getProfiles).mockImplementation(async () => {
      reads += 1
      return {
        items:
          reads === 1
            ? existing
            : [...existing, { name, option: { rules: 'rules-uid' } }],
        current: '',
      } as unknown as IProfilesConfig
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores the settings and creates an empty profile named after the payload', async () => {
    const text = backupText()
    stubBackup(text)

    await expect(importQuickConfig(text, 'all')).resolves.toEqual({
      name: text.slice(0, 8),
      backupFile: expect.stringMatching(/\.zip$/u),
    })
    // 恢复按备份目录里的文件名查找，传路径会报 Backup file not found
    expect(restoreLocalBackup).toHaveBeenCalledWith(
      expect.stringMatching(/\.zip$/u),
    )
    expect(createProfile).toHaveBeenCalledWith({
      type: 'local',
      name: text.slice(0, 8),
      desc: '',
    })
    // 载荷里没有规则时不写规则文件
    expect(saveRulesFile).not.toHaveBeenCalled()
  })

  it('appends `*` when the profile name is already taken', async () => {
    const text = backupText()
    stubBackup(text, [text.slice(0, 8)])

    await expect(importQuickConfig(text, 'all')).resolves.toMatchObject({
      name: `${text.slice(0, 8)}*`,
    })
  })

  it('merges the payload rules, keeping "exclude subscription rules"', async () => {
    const text = backupText([
      { name: 'a', content: 'prepend:\n  - DOMAIN,a.com,DIRECT\n' },
      {
        name: 'b',
        content:
          'append:\n  - MATCH,DIRECT\nexclude-subscription-rules: true\n',
      },
    ])
    stubBackup(text)

    await expect(importQuickConfig(text, 'all')).resolves.toMatchObject({
      name: text.slice(0, 8),
    })

    const written = vi.mocked(saveRulesFile).mock.calls[0]?.[1] ?? ''
    expect(vi.mocked(saveRulesFile).mock.calls[0]?.[0]).toBe('rules-uid')
    expect(written).toContain('DOMAIN,a.com,DIRECT')
    expect(written).toContain('MATCH,DIRECT')
    expect(written).toContain('exclude-subscription-rules: true')
  })
})
