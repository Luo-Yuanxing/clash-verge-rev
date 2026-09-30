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

/** 反转主机名的标签，得到按域名层级（一级 → 二级 → …）比较的键 */
const hostLevelKey = (host: string): string =>
  host.toLowerCase().split('.').reverse().join('.')

/**
 * 按域名层级排序：先比一级域名，再比二级域名，以此类推；
 * 没有主机名的规则（MATCH 等）排在最后，同级按规则类型排序。
 */
export const compareRulesByHostLevel = (
  left: string,
  right: string,
): number => {
  const a = parseRule(left)
  const b = parseRule(right)
  const keyA = hostLevelKey(a.host)
  const keyB = hostLevelKey(b.host)

  if (keyA === keyB) return a.type.localeCompare(b.type)
  if (!keyA) return 1
  if (!keyB) return -1

  return keyA.localeCompare(keyB)
}
