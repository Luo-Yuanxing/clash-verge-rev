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

export interface SeqRulesConfig {
  prepend: string[]
  append: string[]
  delete: string[]
  /** 开启后完全使用自定义规则，订阅规则不参与，未命中一律直连 */
  excludeSubscriptionRules: boolean
}

export const toSeqConfig = (
  config?: ISeqProfileConfig | null,
): SeqRulesConfig => ({
  prepend: config?.prepend ?? [],
  append: config?.append ?? [],
  delete: config?.delete ?? [],
  excludeSubscriptionRules: config?.['exclude-subscription-rules'] ?? false,
})

/** 序列化 Rules 配置文件，与可视化编辑器保持一致 */
export const serializeSeqRules = (config: SeqRulesConfig): string =>
  yaml.dump(
    {
      prepend: config.prepend,
      append: config.append,
      delete: config.delete,
      ...(config.excludeSubscriptionRules
        ? { 'exclude-subscription-rules': true }
        : {}),
    },
    { forceQuotes: true },
  )

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
