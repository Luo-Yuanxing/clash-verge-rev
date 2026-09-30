import type { TranslationKey } from '@/types/generated/i18n-keys'

/** 规则字段拆分结果 */
export interface ParsedRule {
  /** 规则类型，如 DOMAIN-SUFFIX */
  type: string
  /** 主机 / 条件部分，MATCH 等无条件规则为空串 */
  host: string
  /** 代理策略 */
  policy: string
}

/** no-resolve 修饰：只出现在规则末尾，编辑时需原样保留 */
const NO_RESOLVE_SUFFIX = ',no-resolve'

/** 规则的全部可编辑字段，比 ParsedRule 多带 no-resolve 标记 */
export interface RuleParts extends ParsedRule {
  noResolve: boolean
}

/** 按 `类型,条件,策略` 拆分规则字符串（忽略 no-resolve 修饰） */
export const parseRule = (ruleRaw: string): ParsedRule => {
  const rule = ruleRaw.replace(',no-resolve', '')

  const type = rule.match(/^[^,]+/)?.[0] ?? ''
  const policy = rule.match(/[^,]+$/)?.[0] ?? ''
  const host = rule.slice(type.length + 1, -policy.length - 1)

  return { type, host, policy }
}

/**
 * 拆分规则的三个字段并单独识别 no-resolve；
 * 条件部分内部的逗号（AND、SUB-RULE 等嵌套规则）原样保留。
 */
export const parseRuleParts = (ruleRaw: string): RuleParts => {
  const hasNoResolve = ruleRaw.endsWith(NO_RESOLVE_SUFFIX)
  const rule = hasNoResolve
    ? ruleRaw.slice(0, -NO_RESOLVE_SUFFIX.length)
    : ruleRaw

  const typeEnd = rule.indexOf(',')
  if (typeEnd < 0)
    return { type: rule, host: '', policy: '', noResolve: hasNoResolve }

  const policyStart = rule.lastIndexOf(',')
  // 只有 `类型,策略` 两段时条件为空，条件内部的逗号不会被当作分隔符
  const hasHost = policyStart > typeEnd

  return {
    type: rule.slice(0, typeEnd),
    host: hasHost ? rule.slice(typeEnd + 1, policyStart) : '',
    policy: hasHost ? rule.slice(policyStart + 1) : rule.slice(typeEnd + 1),
    noResolve: hasNoResolve,
  }
}

/**
 * 按 `类型,条件,策略` 拼回规则字符串；
 * DOMAIN-SUFFIX 的条件先归一化到两级域名（与规则编辑器一致），
 * 条件为空的规则（MATCH 等）不写多余逗号，no-resolve 按需追加。
 */
export const serializeRuleParts = (parts: RuleParts): string => {
  const host = parts.host.trim()
  const condition =
    parts.type === 'DOMAIN-SUFFIX' ? normalizeDomainSuffix(host) : host

  return `${parts.type},${condition ? `${condition},` : ''}${parts.policy}${
    parts.noResolve ? NO_RESOLVE_SUFFIX : ''
  }`
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

/** 常见多级公共后缀，命中时 DOMAIN-SUFFIX 保留三级而不是两级 */
const MULTI_LEVEL_SUFFIXES = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'co.kr',
  'co.in',
  'com.tw',
  'com.hk',
  'com.au',
  'com.sg',
  'com.br',
  'com.mx',
  'com.tr',
  'com.my',
  'com.ph',
  'com.vn',
  'com.id',
])

const IPV4_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * 归一化 DOMAIN-SUFFIX 的条件部分：只保留最后两级域名，
 * 例如 `www.twitter.com` → `twitter.com`、`api.x.com` → `x.com`；
 * 多级公共后缀保留三级（`a.b.com.cn` → `b.com.cn`）；IP 与空值原样返回。
 */
export const normalizeDomainSuffix = (value: string): string => {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
  if (!host || host.includes(':') || IPV4_REGEX.test(host)) return value

  const labels = host.split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')

  const keep = MULTI_LEVEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2
  return labels.slice(-keep).join('.')
}

/** 规则类型选项：name 即写入规则的字符串，noResolve 表示支持 no-resolve */
export interface RuleTypeOption {
  name: string
  required?: boolean
  /** 条件为空的规则（MATCH 等）不写占位符 */
  example?: string
  noResolve?: boolean
  validator?: (value: string) => boolean
}

/**
 * 规则类型选项，编辑器与自定义规则页共用；
 * 自定义规则页的编辑下拉只保留域名类规则，其余类型仍可由编辑器写入。
 */
export const ruleTypeOptions: RuleTypeOption[] = [
  {
    name: 'DOMAIN',
    example: 'example.com',
  },
  {
    name: 'DOMAIN-SUFFIX',
    example: 'example.com',
  },
  {
    name: 'DOMAIN-KEYWORD',
    example: 'example',
  },
  {
    name: 'DOMAIN-REGEX',
    example: 'example.*',
  },
]

/** 规则类型 → i18n 文案键 */
export const RULE_TYPE_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  ruleTypeOptions.map((rule) => [
    rule.name,
    `rules.modals.editor.ruleTypes.${rule.name}`,
  ]),
)

/** 内置代理策略，排在策略列表最前 */
export const builtinProxyPolicies = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']

/** 内置代理策略 → i18n 文案键 */
export const PROXY_POLICY_LABEL_KEYS: Record<string, TranslationKey> =
  builtinProxyPolicies.reduce(
    (acc, policy) => {
      acc[policy] =
        `proxies.components.enums.policies.${policy}` as TranslationKey
      return acc
    },
    {} as Record<string, TranslationKey>,
  )

/** 把 from 位置的元素移动到 to 位置，返回新数组 */
export const moveItem = <T>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || from >= list.length) return list

  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item === undefined) return list

  next.splice(to, 0, item)
  return next
}
