import dayjs from 'dayjs'
import * as yaml from 'js-yaml'

import {
  createLocalBackup,
  createProfile,
  getProfiles,
  listLocalBackup,
  readLocalBackupBase64,
  readProfileFile,
  restoreLocalBackup,
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
  /** 新建订阅名，载荷里没有规则时为 null */
  name: string | null
  /** 恢复设置用的备份文件名，非备份载荷时为 null */
  backupFile: string | null
}

export type QuickConfigErrorCode =
  /** 字符串格式错误：不是 Base64、缺少备份前缀或规则段标记异常 */
  | 'format'
  /** 字符串格式错误：内容不是合法 JSON */
  | 'json'
  /** 类型不匹配：不是本应用导出的快捷配置 */
  | 'type'
  /** 字段缺失：类型、版本、范围或规则条目不完整 */
  | 'missing'
  /** 版本不一致：配置版本与当前版本不同 */
  | 'version'
  /** 范围不一致：导入内容与界面选中的范围不符 */
  | 'scope'
  | 'profile'
  | 'rules'
  | 'restore'
  | 'export'

export class QuickConfigError extends Error {
  readonly code: QuickConfigErrorCode
  /** 提示文案里用到的细节，例如期望版本与实际版本 */
  readonly params?: Record<string, unknown>

  constructor(code: QuickConfigErrorCode, params?: Record<string, unknown>) {
    super(code)
    this.code = code
    this.params = params
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

/** 解码失败（非法字符、补位错误）统一报字符串格式错误 */
const decodeBase64Checked = (base64: string): string => {
  try {
    return decodeBase64(base64)
  } catch {
    throw new QuickConfigError('format')
  }
}

/** 校验备份载荷：只接受 `cv1:` 压缩格式，非法字符判为字符串格式错误；原样返回，前缀必须保留 */
const checkedBackupText = (text: string): string => {
  if (!text.startsWith(QUICK_CONFIG_PREFIX)) {
    throw new QuickConfigError('format')
  }

  const body = text.slice(QUICK_CONFIG_PREFIX.length)
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/u.test(body)) {
    throw new QuickConfigError('format')
  }
  return text
}

/** 导出载荷里规则段的标记；缺失时视为只有设置 */
const QUICK_CONFIG_RULE_MARK = '#rules='

/** 校验规则清单结构，条目缺 name / content 视为字段缺失 */
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
    throw new QuickConfigError('missing')
  }

  return value as RuledBackupPayload['rules']
}

/** 从「设置 + 规则」文案里解出两部分，规则段缺失时为没有规则 */
const parseRuledBackupText = (text: string): RuledBackupPayload => {
  const [settingsLine = '', ...rest] = text.split('\n')
  const settings = checkedBackupText(settingsLine.replace(/\s+/gu, ''))

  const ruleLine = rest.join('').trim()
  if (!ruleLine) return { settings, rules: [] }
  if (!ruleLine.startsWith(QUICK_CONFIG_RULE_MARK)) {
    throw new QuickConfigError('format')
  }

  let parsed: unknown
  try {
    const body = ruleLine.slice(QUICK_CONFIG_RULE_MARK.length)
    parsed = JSON.parse(decodeBase64Checked(body))
  } catch (err) {
    if (err instanceof QuickConfigError) throw err
    throw new QuickConfigError('json')
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
  if (!created) throw new QuickConfigError('export')

  const payload = await readLocalBackupBase64(created.filename)
  if (!payload || typeof payload.settings !== 'string') {
    // 旧后端只返回一个 Base64 字符串，这种组合下 rules 必然为空，直接判为导出失败。
    throw new QuickConfigError('export')
  }

  return {
    settings: checkedBackupText(payload.settings.replace(/\s+/gu, '')),
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

/**
 * 解析 JSON 快捷配置：逐项校验字符串格式、载荷类型、必需字段与版本，
 * 失败时抛出带原因的错误码，便于界面给出具体提示。
 */
export const parseQuickConfig = (base64: string): QuickConfigPayload => {
  const text = decodeBase64Checked(base64)

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new QuickConfigError('json')
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new QuickConfigError('type')
  }

  const config = payload as Partial<QuickConfigPayload>
  if (typeof config.type !== 'string' || !config.type) {
    throw new QuickConfigError('missing')
  }
  if (config.type !== QUICK_CONFIG_TYPE) {
    throw new QuickConfigError('type')
  }
  if (typeof config.version !== 'number') {
    throw new QuickConfigError('missing')
  }
  if (config.version !== QUICK_CONFIG_VERSION) {
    throw new QuickConfigError('version', {
      expected: QUICK_CONFIG_VERSION,
      actual: config.version,
    })
  }
  if (config.scope !== 'all' && config.scope !== 'just-rule') {
    throw new QuickConfigError('missing')
  }

  return config as QuickConfigPayload
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

/** 新建一个空订阅，名字重名时在末尾补 `*`，返回最终订阅名 */
const createEmptyProfile = async (nameBase: string): Promise<string> => {
  const profiles = await getProfiles()
  const name = uniqueProfileName(profiles.items ?? [], nameBase)

  try {
    await createProfile({ type: 'local', name, desc: '' })
  } catch {
    throw new QuickConfigError('profile')
  }

  return name
}

/**
 * 导入配置：`cv1:` 备份载荷恢复设置，再新建一个空订阅——载荷里的规则字符串不导入，
 * 订阅名统一取载荷前八位；旧的 JSON 快捷配置则把自带的一份规则挂到新建的空订阅上。
 * `scope` 为界面当前选中的范围，载荷范围与之不符时直接拒绝。
 */
export const importQuickConfig = async (
  raw: string,
  scope: QuickConfigScope,
): Promise<QuickConfigImportResult> => {
  const text = raw.trim()
  if (!text) throw new QuickConfigError('format')

  const nameBase = text.slice(0, QUICK_CONFIG_NAME_LENGTH)

  if (text.startsWith(QUICK_CONFIG_PREFIX)) {
    if (scope !== 'all') throw new QuickConfigError('scope')

    const payload = parseRuledBackupText(text)
    const filename = uniqueBackupFileName(
      new Set((await listLocalBackup()).map((item) => item.filename)),
    )

    let backupFile: string
    try {
      // 设置落盘到备份目录后按文件名恢复：`restore_local_backup` 只在备份目录里查找
      await writeLocalBackupBase64(filename, payload.settings)
      await restoreLocalBackup(filename)
      backupFile = filename
    } catch {
      throw new QuickConfigError('restore')
    }

    return { name: await createEmptyProfile(nameBase), backupFile }
  }

  const payload = parseQuickConfig(text)
  if (payload.scope !== scope) throw new QuickConfigError('scope')

  const customRule = payload['custom-rule']
  if (!customRule || typeof customRule !== 'object') {
    return { name: null, backupFile: null }
  }

  const name = await createEmptyProfile(nameBase)
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
