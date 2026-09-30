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

export const toSeqConfig = (
  config?: ISeqProfileConfig | null,
): Required<Pick<ISeqProfileConfig, 'prepend' | 'append' | 'delete'>> => ({
  prepend: config?.prepend ?? [],
  append: config?.append ?? [],
  delete: config?.delete ?? [],
})
