/** 规则字段拆分结果 */
export interface ParsedRule {
  /** 规则类型，如 DOMAIN-SUFFIX */
  type: string
  /** 主机 / 条件部分，MATCH 等无条件规则为空串 */
  host: string
  /** 代理策略 */
  policy: string
}

/** 按 `类型,条件,策略` 拆分规则字符串（忽略 no-resolve 修饰） */
export const parseRule = (ruleRaw: string): ParsedRule => {
  const rule = ruleRaw.replace(',no-resolve', '')

  const type = rule.match(/^[^,]+/)?.[0] ?? ''
  const policy = rule.match(/[^,]+$/)?.[0] ?? ''
  const host = rule.slice(type.length + 1, -policy.length - 1)

  return { type, host, policy }
}
