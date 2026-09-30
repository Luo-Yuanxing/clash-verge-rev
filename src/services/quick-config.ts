import dayjs from 'dayjs'
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

/** 导出范围：all 为设置 + 全部订阅规则（不含订阅本体），just-rule 只带激活订阅的规则 */
export type QuickConfigScope = 'all' | 'just-rule'

export const QUICK_CONFIG_TYPE = 'clash-verge-quick-config'
export const QUICK_CONFIG_VERSION = 1
/** 导入时新订阅名取 Base64 的前若干位 */
export const QUICK_CONFIG_NAME_LENGTH = 8

/** 压缩备份载荷的版本前缀，需与 src-tauri/src/feat/backup.rs 保持一致 */
const QUICK_CONFIG_PREFIX = 'cv1:'

/** 导入的备份文件名沿用 Verge 的 `{平台}-backup-{时间}.zip` 约定 */
const QUICK_CONFIG_BACKUP_PREFIX = navigator.userAgent.includes('Mac')
  ? 'macos'
  : navigator.userAgent.includes('Linux')
    ? 'linux'
    : 'windows'

export interface QuickConfigPayload {
  type: string
  version: number
  scope: QuickConfigScope
  exported_at: string
  'custom-rule'?: Record<string, unknown> | null
}

/** 导出载荷：`settings` 为剔除订阅后的设置备份，`rules` 为各订阅的自定义规则 */
export interface RuledBackupPayload {
  settings: string
  rules: { name: string; content: string }[]
}

export interface QuickConfigImportResult {
  /** 新建订阅名，没有自定义规则时为 null */
  name: string | null
  /** 导入的备份文件名，备份载荷不可用时为 null */
  backupFile: string | null
  /** 挂上规则的订阅数 */
  rulesApplied: number
}

export type QuickConfigErrorCode = 'invalid' | 'profile' | 'rules' | 'restore'

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

/** 校验并规范化备份载荷：只接受 `cv1:` 压缩格式，非法字符判为无效 */
const checkedBackupBody = (text: string): string => {
  if (!text.startsWith(QUICK_CONFIG_PREFIX)) {
    throw new QuickConfigError('invalid')
  }

  const body = text.slice(QUICK_CONFIG_PREFIX.length).replace(/\s+/gu, '')
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/u.test(body)) {
    throw new QuickConfigError('invalid')
  }
  return body
}

/** 导出载荷里规则段的标记；缺失时视为只有设置 */
const QUICK_CONFIG_RULE_MARK = '#rules='

/** 校验规则清单结构 */
const checkedRules = (value: unknown): RuledBackupPayload['rules'] => {
  if (
    !Array.isArray(value) ||
    value.some(
      (rule) =>
        !rule ||
        typeof rule.name !== 'string' ||
        typeof rule.content !== 'string',
    )
  ) {
    throw new QuickConfigError('invalid')
  }

  return value as RuledBackupPayload['rules']
}

/** 从「设置 + 规则」文案里解出两部分，规则段缺失时为没有规则 */
const parseRuledBackupText = (text: string): RuledBackupPayload => {
  const [settingsLine = '', ...rest] = text.split('\n')
  const settings = checkedBackupBody(settingsLine.replace(/\s+/gu, ''))

  const ruleLine = rest.join('').trim()
  if (!ruleLine) return { settings, rules: [] }
  if (!ruleLine.startsWith(QUICK_CONFIG_RULE_MARK)) {
    throw new QuickConfigError('invalid')
  }

  let parsed: unknown
  try {
    const body = ruleLine.slice(QUICK_CONFIG_RULE_MARK.length)
    parsed = JSON.parse(decodeBase64(body))
  } catch {
    throw new QuickConfigError('invalid')
  }

  return { settings, rules: checkedRules(parsed) }
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
 * 全部范围：调用 Verge 原有备份，后端再把订阅本体剔除，只回设置与各订阅的规则。
 */
const exportBackupPayload = async (): Promise<RuledBackupPayload> => {
  const before = new Set((await listLocalBackup()).map((item) => item.filename))

  await createLocalBackup()

  const created = (await listLocalBackup()).find(
    (item) => !before.has(item.filename),
  )
  if (!created) throw new QuickConfigError('invalid')

  const payload = await readLocalBackupBase64(created.filename)
  return {
    settings: checkedBackupBody(payload.settings.replace(/\s+/gu, '')),
    rules: checkedRules(payload.rules),
  }
}

export const exportQuickConfig = async (
  scope: QuickConfigScope,
): Promise<string> => {
  if (scope === 'all') {
    const payload = await exportBackupPayload()
    const rules = encodeBase64(JSON.stringify(payload.rules))
    return `${payload.settings}\n${QUICK_CONFIG_RULE_MARK}${rules}`
  }

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

/** 备份目录里的时间戳文件名，重名时追加 `-import` / `-import2` */
const uniqueBackupFileName = (existing: Set<string>): string => {
  const stamp = dayjs().format('YYYY-MM-DD_HH-mm-ss')
  let name = `${QUICK_CONFIG_BACKUP_PREFIX}-backup-${stamp}.zip`
  if (!existing.has(name)) return name

  name = name.replace(/\.zip$/u, '-import.zip')
  for (let index = 2; existing.has(name); index += 1) {
    name = name.replace(/-import\d*\.zip$/u, `-import${index}.zip`)
  }
  return name
}

/** 规则内容是否为空：`prepend`/`append`/`delete`/`rules` 全空视为没有规则 */
const hasRuleContent = (content: string): boolean => {
  const parsed = parseYamlSafe(content)
  if (!parsed || typeof parsed !== 'object') return false

  return Object.values(parsed as Record<string, unknown>).some((value) =>
    Array.isArray(value) ? value.length > 0 : !!value,
  )
}

/** 把规则挂到新建的本地订阅上，返回订阅名；订阅创建失败时返回 null */
const createRuleProfile = async (
  name: string,
  content: string,
): Promise<string | null> => {
  const profiles = await getProfiles()
  const uniqueName = uniqueProfileName(profiles.items ?? [], name)

  try {
    await createProfile({ type: 'local', name: uniqueName, desc: '' })
  } catch {
    return null
  }

  const created = (await getProfiles()).items?.find(
    (item) => item?.name === uniqueName,
  )
  const rulesUid = created?.option?.rules
  if (!rulesUid) return null

  const outcome = await saveRulesFile(rulesUid, content)
  return outcome.status === 'valid' ? uniqueName : null
}

export interface QuickConfigImportResult {
  /** 新建订阅名，没有自定义规则时为 null */
  name: string | null
  /** 导入的备份文件名，备份载荷导入失败时为 null */
  backupFile: string | null
  /** 挂上规则的订阅数 */
  rulesApplied: number
}

/**
 * 导入配置：`cv1:` 备份载荷解出「设置 + 规则」——设置落到本地备份目录（复用原有导入函数），
 * 规则挂到新建的订阅上；旧的 JSON 快捷配置则只带一份规则。
 */
export const importQuickConfig = async (
  raw: string,
): Promise<QuickConfigImportResult> => {
  const text = raw.trim()
  if (!text) throw new QuickConfigError('invalid')

  if (text.startsWith(QUICK_CONFIG_PREFIX)) {
    const payload = parseRuledBackupText(text)
    const filename = uniqueBackupFileName(
      new Set((await listLocalBackup()).map((item) => item.filename)),
    )

    let backupFile: string
    try {
      await writeLocalBackupBase64(filename, payload.settings)
      backupFile = (await importLocalBackup(filename)) || filename
    } catch {
      throw new QuickConfigError('restore')
    }

    let rulesApplied = 0
    let firstName: string | null = null
    for (const entry of payload.rules) {
      if (!hasRuleContent(entry.content)) continue
      const created = await createRuleProfile(entry.name, entry.content)
      if (!created) continue
      rulesApplied += 1
      firstName ??= created
    }

    return { name: firstName, backupFile, rulesApplied }
  }

  const payload = parseQuickConfig(text)
  const customRule = payload['custom-rule']
  if (!customRule || typeof customRule !== 'object') {
    return { name: null, backupFile: null, rulesApplied: 0 }
  }

  const nameBase = text.slice(0, QUICK_CONFIG_NAME_LENGTH)
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

  return { name, backupFile: null, rulesApplied: 1 }
}
