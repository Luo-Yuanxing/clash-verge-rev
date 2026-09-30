import { parseRuleParts } from './rule-fields'
import type {
  SeqRuleRef,
  SeqRulesConfig,
  SeqRulesDisabled,
} from './seq-rules-document'

/** 这几类规则的主机是域名，比较时不区分大小写 */
const DOMAIN_RULE_TYPES = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
])

/**
 * 迁移用的去重键：主机 / 规则类型 / 代理策略三部分完全一样即为同一条规则。
 * no-resolve 修饰不参与比较，规则类型与域名不区分大小写，代理策略必须完全一致。
 */
export const ruleIdentityKey = (rule: string): string => {
  const { type, host, policy } = parseRuleParts(rule)
  const ruleType = type.trim().toUpperCase()
  const condition = host.trim()
  const matched = DOMAIN_RULE_TYPES.has(ruleType)
    ? condition.toLowerCase()
    : condition

  return [ruleType, matched, policy.trim()].join('\u0000')
}

export interface SeqRulesMigration {
  /** 合并后的目标配置 */
  config: SeqRulesConfig
  /** 实际复制过去的规则条数 */
  copied: number
  /** 因目标订阅已有同一条规则（含本批内的重复）而跳过的条数 */
  skipped: number
}

/**
 * 把来源规则复制进目标配置：目标已有的同一条规则跳过，
 * 其余按来源序列（prepend/append）与启用状态原样落入目标，来源顺序保持不变。
 */
export const migrateSeqRules = (
  target: SeqRulesConfig,
  rules: SeqRuleRef[],
): SeqRulesMigration => {
  const prepend = [...target.prepend]
  const append = [...target.append]
  const disabled: SeqRulesDisabled = {
    prepend: [...target.disabled.prepend],
    append: [...target.disabled.append],
  }

  const seen = new Set(
    [...prepend, ...append, ...disabled.prepend, ...disabled.append].map(
      ruleIdentityKey,
    ),
  )

  let copied = 0
  let skipped = 0

  for (const { rule, source, enabled } of rules) {
    const key = ruleIdentityKey(rule)
    if (seen.has(key)) {
      skipped += 1
      continue
    }

    seen.add(key)
    copied += 1

    if (enabled) {
      if (source === 'prepend') prepend.push(rule)
      else append.push(rule)
    } else if (source === 'prepend') {
      disabled.prepend.push(rule)
    } else {
      disabled.append.push(rule)
    }
  }

  return { config: { ...target, prepend, append, disabled }, copied, skipped }
}
