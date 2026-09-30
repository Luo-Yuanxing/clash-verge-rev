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
