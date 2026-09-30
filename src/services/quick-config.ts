import * as yaml from 'js-yaml'

import {
  createProfile,
  getProfiles,
  getVergeConfig,
  patchVergeConfig,
  readProfileFile,
  saveRulesFile,
} from '@/services/cmds'
import { parseYamlSafe } from '@/utils/yaml'

/** 导出范围：all 为完整设置 + 激活订阅的自定义规则，just-rule 只带自定义规则 */
export type QuickConfigScope = 'all' | 'just-rule'

export const QUICK_CONFIG_TYPE = 'clash-verge-quick-config'
export const QUICK_CONFIG_VERSION = 1
/** 导入时新订阅名取 Base64 的前若干位 */
export const QUICK_CONFIG_NAME_LENGTH = 8

export interface QuickConfigPayload {
  type: string
  version: number
  scope: QuickConfigScope
  exported_at: string
  verge?: IVergeConfig
  'custom-rule'?: Record<string, unknown> | null
}

export interface QuickConfigImportResult {
  /** 新建订阅名，没有自定义规则时为 null */
  name: string | null
  vergeApplied: boolean
  rulesApplied: boolean
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

export const exportQuickConfig = async (
  scope: QuickConfigScope,
): Promise<string> => {
  const payload: QuickConfigPayload = {
    type: QUICK_CONFIG_TYPE,
    version: QUICK_CONFIG_VERSION,
    scope,
    exported_at: new Date().toISOString(),
    'custom-rule': await readActiveCustomRule(),
  }

  if (scope === 'all') payload.verge = await getVergeConfig()

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
 * 导入配置：`verge` 整体回写，`custom-rule` 挂到新建的订阅（名字取 Base64 前 8 位）上。
 */
export const importQuickConfig = async (
  base64: string,
): Promise<QuickConfigImportResult> => {
  const payload = parseQuickConfig(base64)
  const vergeApplied = !!payload.verge && typeof payload.verge === 'object'

  if (vergeApplied) {
    await patchVergeConfig(payload.verge as IVergeConfig)
  }

  const customRule = payload['custom-rule']
  if (!customRule || typeof customRule !== 'object') {
    return { name: null, vergeApplied, rulesApplied: false }
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

  return { name, vergeApplied, rulesApplied: true }
}
