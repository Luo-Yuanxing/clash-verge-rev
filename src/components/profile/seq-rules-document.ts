import * as yaml from 'js-yaml'

import { readProfileFile } from '@/services/cmds'
import { parseYamlSafe } from '@/utils/yaml'

export interface SeqRulesDocument {
  /** 原始文件内容 */
  raw: string
  /** 无法解析为 YAML 时为 undefined */
  config?: ISeqProfileConfig | null
}

/** 读取 Rules 配置文件 */
export const readSeqRulesDocument = async (
  property: string,
): Promise<SeqRulesDocument> => {
  const raw = await readProfileFile(property)
  const config = parseYamlSafe(raw) as ISeqProfileConfig | null | undefined

  return { raw, config }
}

/** 已关闭的自定义规则，按来源分别保存 */
export interface SeqRulesDisabled {
  prepend: string[]
  append: string[]
}

export const emptySeqRulesDisabled = (): SeqRulesDisabled => ({
  prepend: [],
  append: [],
})

export interface SeqRulesConfig {
  prepend: string[]
  append: string[]
  delete: string[]
  /** 关闭的规则不写入 prepend/append，因此不参与运行时匹配 */
  disabled: SeqRulesDisabled
  /** 开启后完全使用自定义规则，订阅规则不参与，未命中一律直连 */
  excludeSubscriptionRules: boolean
}

export const toSeqConfig = (
  config?: ISeqProfileConfig | null,
): SeqRulesConfig => ({
  prepend: config?.prepend ?? [],
  append: config?.append ?? [],
  delete: config?.delete ?? [],
  disabled: {
    prepend: config?.disabled?.prepend ?? [],
    append: config?.disabled?.append ?? [],
  },
  excludeSubscriptionRules: config?.['exclude-subscription-rules'] ?? false,
})

export const emptySeqRulesConfig = (): SeqRulesConfig => ({
  prepend: [],
  append: [],
  delete: [],
  disabled: emptySeqRulesDisabled(),
  excludeSubscriptionRules: false,
})

/** 顺序也要一致：规则顺序参与运行时匹配，顺序不同即视为不同草稿 */
const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index])

/**
 * 两份草稿是否内容一致：草稿对象每次渲染都会重建，异步写回只能按内容判断
 * 它是否还是界面上正在显示的那一份。
 */
export const isSameSeqRulesConfig = (
  a: SeqRulesConfig,
  b: SeqRulesConfig,
): boolean =>
  a.excludeSubscriptionRules === b.excludeSubscriptionRules &&
  sameList(a.prepend, b.prepend) &&
  sameList(a.append, b.append) &&
  sameList(a.delete, b.delete) &&
  sameList(a.disabled.prepend, b.disabled.prepend) &&
  sameList(a.disabled.append, b.disabled.append)

/** 有没有实质内容：四个序列都空且没开启「完全排除订阅规则」时视为空 */
export const hasSeqRules = (config: SeqRulesConfig): boolean =>
  config.prepend.length > 0 ||
  config.append.length > 0 ||
  config.delete.length > 0 ||
  config.disabled.prepend.length > 0 ||
  config.disabled.append.length > 0 ||
  config.excludeSubscriptionRules

/**
 * 合并多份规则配置：同名规则只保留第一次出现，「完全排除订阅规则」只要有任意一份开启就开启。
 */
export const mergeSeqRules = (configs: SeqRulesConfig[]): SeqRulesConfig => {
  const merged = emptySeqRulesConfig()

  const push = (target: string[], source: string[]) => {
    for (const rule of source) {
      if (!target.includes(rule)) target.push(rule)
    }
  }

  for (const config of configs) {
    push(merged.prepend, config.prepend)
    push(merged.append, config.append)
    push(merged.delete, config.delete)
    push(merged.disabled.prepend, config.disabled.prepend)
    push(merged.disabled.append, config.disabled.append)
    merged.excludeSubscriptionRules ||= config.excludeSubscriptionRules
  }

  return merged
}

/** 序列化 Rules 配置文件，与可视化编辑器保持一致 */
export const serializeSeqRules = (config: SeqRulesConfig): string => {
  const { disabled } = config
  const hasDisabled = disabled.prepend.length > 0 || disabled.append.length > 0

  return yaml.dump(
    {
      prepend: config.prepend,
      append: config.append,
      delete: config.delete,
      ...(hasDisabled
        ? { disabled: { prepend: disabled.prepend, append: disabled.append } }
        : {}),
      ...(config.excludeSubscriptionRules
        ? { 'exclude-subscription-rules': true }
        : {}),
    },
    { forceQuotes: true },
  )
}

/** 自定义规则所在的序列 */
export type SeqRuleSource = 'prepend' | 'append'

/** 一条自定义规则及其启用状态 */
export interface SeqRuleRef {
  rule: string
  source: SeqRuleSource
  enabled: boolean
}

/** 表格行的唯一标识：启用状态 + 序列 + 规则串，用于勾选待删除的行 */
export const seqRuleRowId = (row: SeqRuleRef): string =>
  `${row.enabled ? 'on' : 'off'}\u0000${row.source}\u0000${row.rule}`

/**
 * 勾选即启用：关闭的规则移出 prepend/append 并记入 disabled，
 * 重新启用的规则从 disabled 移回原序列末尾。
 */
export const applyRuleEnabled = (
  config: SeqRulesConfig,
  targets: SeqRuleRef[],
  enabled: boolean,
): SeqRulesConfig => {
  const prepend = [...config.prepend]
  const append = [...config.append]
  const disabled = {
    prepend: [...config.disabled.prepend],
    append: [...config.disabled.append],
  }

  for (const { rule, source } of targets) {
    const sequence = source === 'prepend' ? prepend : append
    const closed = source === 'prepend' ? disabled.prepend : disabled.append

    if (enabled) {
      const index = closed.indexOf(rule)
      if (index >= 0) closed.splice(index, 1)
      if (!sequence.includes(rule)) sequence.push(rule)
    } else {
      for (let i = sequence.length - 1; i >= 0; i -= 1) {
        if (sequence[i] === rule) sequence.splice(i, 1)
      }
      if (!closed.includes(rule)) closed.push(rule)
    }
  }

  return { ...config, prepend, append, disabled }
}

/**
 * 修改一条自定义规则的属性（主机 / 类型 / 策略）：原位置的旧字符串替换为新字符串，
 * 原有字符串在别处（含另一序列、已关闭列表）的副本一并移除，避免编辑后出现重复规则；
 * 新字符串与旧字符串相同则原样返回。
 */
export const updateSeqRule = (
  config: SeqRulesConfig,
  { rule, source, enabled }: SeqRuleRef,
  nextRule: string,
): SeqRulesConfig => {
  if (rule === nextRule) return config

  /** 去掉旧字符串与同名新字符串的所有副本 */
  const drop = (list: string[]) =>
    list.includes(rule) || list.includes(nextRule)
      ? list.filter((item) => item !== rule && item !== nextRule)
      : list

  /**
   * 编辑启用中的规则：它在哪个序列，就在哪个序列原位改名，
   * 另一个序列与已关闭列表里的同名 / 旧名副本直接删除。
   * 编辑已关闭的规则：改名只发生在它所在的已关闭列表，序列里的同名副本删除。
   */
  const update = (list: string[], isSelf: boolean): string[] => {
    const index = list.indexOf(rule)
    const cleaned = drop(list)
    if (!isSelf) return cleaned
    if (index < 0) return [...cleaned, nextRule]

    // 先记下旧位置再删，删完把新规则插回同一位置
    const next = [...cleaned]
    next.splice(Math.min(index, next.length), 0, nextRule)
    return next
  }

  return {
    ...config,
    prepend: update(config.prepend, enabled && source === 'prepend'),
    append: update(config.append, enabled && source === 'append'),
    disabled: {
      prepend: update(
        config.disabled.prepend,
        !enabled && source === 'prepend',
      ),
      append: update(config.disabled.append, !enabled && source === 'append'),
    },
  }
}

/** 删除一条自定义规则：启用中的从序列移除，已关闭的从 disabled 移除 */
export const removeSeqRule = (
  config: SeqRulesConfig,
  { rule, source, enabled }: SeqRuleRef,
): SeqRulesConfig => {
  const drop = (list: string[]) => list.filter((item) => item !== rule)

  if (source === 'prepend') {
    return enabled
      ? { ...config, prepend: drop(config.prepend) }
      : {
          ...config,
          disabled: {
            ...config.disabled,
            prepend: drop(config.disabled.prepend),
          },
        }
  }

  return enabled
    ? { ...config, append: drop(config.append) }
    : {
        ...config,
        disabled: { ...config.disabled, append: drop(config.disabled.append) },
      }
}

/**
 * 依次检查候选订阅的规则文件，返回第一个有自定义规则（prepend/append 非空）的 uid；
 * 读取失败按空处理，全部为空时返回空串。
 */
export const findFirstNonEmptyRulesUid = async (
  candidates: { uid: string; property: string }[],
  read: (property: string) => Promise<SeqRulesDocument> = readSeqRulesDocument,
): Promise<string> => {
  for (const { uid, property } of candidates) {
    try {
      const { config } = await read(property)
      const { prepend, append } = toSeqConfig(config)
      if (prepend.length > 0 || append.length > 0) return uid
    } catch {
      // 读取失败按空处理，继续看下一个订阅
    }
  }

  return ''
}
