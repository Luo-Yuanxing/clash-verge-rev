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

/** 只有域名类规则能判断主机名是否已命中 */
const DOMAIN_RULE_TYPES = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
])

/** 判断一条规则是否覆盖主机名；非域名类规则（IP-CIDR、GEOSITE 等）一律返回 false */
export const ruleCoversHost = (rule: string, host: string): boolean => {
  const target = host.trim().toLowerCase()
  if (!target) return false

  const { type, host: condition } = parseRule(rule)
  const ruleType = type.trim().toUpperCase()
  const value = condition.trim()
  if (!DOMAIN_RULE_TYPES.has(ruleType) || !value) return false

  switch (ruleType) {
    case 'DOMAIN':
      return target === value.toLowerCase()
    case 'DOMAIN-SUFFIX': {
      const suffix = value.toLowerCase().replace(/^\./, '')
      return target === suffix || target.endsWith(`.${suffix}`)
    }
    case 'DOMAIN-KEYWORD':
      return target.includes(value.toLowerCase())
    case 'DOMAIN-REGEX':
      try {
        return new RegExp(value, 'i').test(target)
      } catch {
        return false
      }
    default:
      return false
  }
}

/** 主机名是否被其中任意一条规则覆盖 */
export const isHostCoveredByRules = (
  rules: readonly string[],
  host: string,
): boolean => rules.some((rule) => ruleCoversHost(rule, host))

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

/** 把 from 位置的元素移动到 to 位置，返回新数组 */
export const moveItem = <T>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || from >= list.length) return list

  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item === undefined) return list

  next.splice(to, 0, item)
  return next
}
