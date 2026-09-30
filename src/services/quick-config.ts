import * as yaml from 'js-yaml'

import {
  createLocalBackup,
  createProfile,
  getProfiles,
  importLocalBackup,
  listLocalBackup,
  readLocalBackupBase64,
  readProfileFile,
  saveRulesFile,
  writeLocalBackupBase64,
} from '@/services/cmds'
import { parseYamlSafe } from '@/utils/yaml'

/** 导出范围：all 为 Verge 完整备份（zip 的 Base64），just-rule 只带自定义规则 */
export type QuickConfigScope = 'all' | 'just-rule'

export const QUICK_CONFIG_TYPE = 'clash-verge-quick-config'
export const QUICK_CONFIG_VERSION = 1
/** 导入时新订阅名取 Base64 的前若干位 */
export const QUICK_CONFIG_NAME_LENGTH = 8

/** zip 魔数，用于区分 Verge 备份与 JSON 快捷配置 */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

export interface QuickConfigPayload {
  type: string
  version: number
  scope: QuickConfigScope
  exported_at: string
  'custom-rule'?: Record<string, unknown> | null
}

export interface QuickConfigImportResult {
  /** 新建订阅名，没有自定义规则时为 null */
  name: string | null
  /** 导入的备份文件名，非备份配置时为 null */
  backupFile: string | null
}

export type QuickConfigErrorCode = 'invalid' | 'profile' | 'rules'

export class QuickConfigError extends Error {
  readonly code: QuickConfigErrorCode

  constructor(code: QuickConfigErrorCode) {
    super(code)
    this.code = code
    this.name = 'QuickConfigError'
  }
}

/** UTF-8 安全的 Base64，不加密 */
const encodeBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const decodeBase64 = (base64: string): string => {
  const binary = atob(base64.replace(/\s+/gu, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const isZipBase64 = (base64: string): boolean => {
  try {
    const head = atob(base64.replace(/\s+/gu, '').slice(0, 8))
    return ZIP_MAGIC.every((byte, index) => head.charCodeAt(index) === byte)
  } catch {
    return false
  }
}

/** 当前激活订阅的自定义规则；无激活订阅或无规则文件时返回 null */
const readActiveCustomRule = async (): Promise<Record<
  string,
  unknown
> | null> => {
  const profiles = await getProfiles()
  const current = (profiles.items ?? []).find(
    (item) => item?.uid === profiles.current,
  )
  const rulesUid = current?.option?.rules
  if (!rulesUid) return null

  const parsed = parseYamlSafe(await readProfileFile(rulesUid))
  return parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : null
}

/**
 * 全部范围：调用 Verge 原有备份，取回刚生成的 zip 并转成 Base64。
 * 备份已包含全部 profiles（含规则），因此不再附加 `custom-rule` 键。
 */
const exportBackupBase64 = async (): Promise<string> => {
  const before = new Set((await listLocalBackup()).map((item) => item.filename))

  await createLocalBackup()

  const created = (await listLocalBackup()).find(
    (item) => !before.has(item.filename),
  )
  if (!created) throw new QuickConfigError('invalid')

  return readLocalBackupBase64(created.filename)
}

export const exportQuickConfig = async (
  scope: QuickConfigScope,
): Promise<string> => {
  if (scope === 'all') return exportBackupBase64()

  const payload: QuickConfigPayload = {
    type: QUICK_CONFIG_TYPE,
    version: QUICK_CONFIG_VERSION,
    scope,
    exported_at: new Date().toISOString(),
    'custom-rule': await readActiveCustomRule(),
  }

  return encodeBase64(JSON.stringify(payload, null, 2))
}

export const parseQuickConfig = (base64: string): QuickConfigPayload => {
  let payload: unknown
  try {
    payload = JSON.parse(decodeBase64(base64))
  } catch {
    throw new QuickConfigError('invalid')
  }

  const config = payload as QuickConfigPayload
  if (
    !config ||
    typeof config !== 'object' ||
    config.type !== QUICK_CONFIG_TYPE
  ) {
    throw new QuickConfigError('invalid')
  }

  return config
}

/** 重名时在末尾追加 `*`，直到名字唯一 */
const uniqueProfileName = (items: IProfileItem[], base: string): string => {
  const names = new Set(
    items.map((item) => item?.name).filter((name): name is string => !!name),
  )
  let name = base
  while (names.has(name)) name += '*'
  return name
}

/**
 * 导入配置：Verge 备份先解码再落到本地备份目录（复用原有导入函数），
 * JSON 快捷配置则把 `custom-rule` 挂到新建的订阅（名字取 Base64 前 8 位）上。
 */
export const importQuickConfig = async (
  base64: string,
): Promise<QuickConfigImportResult> => {
  if (isZipBase64(base64)) {
    try {
      const filename = await writeLocalBackupBase64(base64)
      const backupFile = await importLocalBackup(filename)
      return { name: null, backupFile: backupFile || filename }
    } catch {
      throw new QuickConfigError('invalid')
    }
  }

  const payload = parseQuickConfig(base64)
  const customRule = payload['custom-rule']
  if (!customRule || typeof customRule !== 'object') {
    return { name: null, backupFile: null }
  }

  const nameBase = base64
    .replace(/\s+/gu, '')
    .slice(0, QUICK_CONFIG_NAME_LENGTH)
  const profiles = await getProfiles()
  const name = uniqueProfileName(profiles.items ?? [], nameBase)

  try {
    await createProfile({ type: 'local', name, desc: '' })
  } catch {
    throw new QuickConfigError('profile')
  }

  const created = (await getProfiles()).items?.find(
    (item) => item?.name === name,
  )
  const rulesUid = created?.option?.rules
  if (!rulesUid) throw new QuickConfigError('rules')

  const outcome = await saveRulesFile(
    rulesUid,
    yaml.dump(customRule, { forceQuotes: true }),
  )
  if (outcome.status !== 'valid') throw new QuickConfigError('rules')

  return { name, backupFile: null }
}
