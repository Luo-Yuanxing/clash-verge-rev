import { describe, expect, it } from 'vitest'

import type { SeqRuleRef, SeqRulesConfig } from './seq-rules-document'
import { migrateSeqRules, ruleIdentityKey } from './seq-rules-migrate'

const config = (overrides: Partial<SeqRulesConfig> = {}): SeqRulesConfig => ({
  prepend: [],
  append: [],
  delete: [],
  disabled: { prepend: [], append: [] },
  excludeSubscriptionRules: false,
  ...overrides,
})

const rule = (
  value: string,
  source: 'prepend' | 'append' = 'prepend',
  enabled = true,
): SeqRuleRef => ({ rule: value, source, enabled })

describe('ruleIdentityKey', () => {
  it('treats the same host, type and policy as one rule', () => {
    expect(ruleIdentityKey('DOMAIN,a.com,DIRECT')).toBe(
      ruleIdentityKey('DOMAIN,a.com,DIRECT'),
    )
  })

  it('ignores case in the rule type and domain', () => {
    expect(ruleIdentityKey('domain-suffix,Example.com,DIRECT')).toBe(
      ruleIdentityKey('DOMAIN-SUFFIX,example.com,DIRECT'),
    )
  })

  it('ignores the no-resolve modifier', () => {
    expect(ruleIdentityKey('IP-CIDR,1.1.1.1/32,DIRECT,no-resolve')).toBe(
      ruleIdentityKey('IP-CIDR,1.1.1.1/32,DIRECT'),
    )
  })

  it('keeps different hosts, types and policies apart', () => {
    const base = ruleIdentityKey('DOMAIN,a.com,DIRECT')

    expect(ruleIdentityKey('DOMAIN,b.com,DIRECT')).not.toBe(base)
    expect(ruleIdentityKey('DOMAIN-SUFFIX,a.com,DIRECT')).not.toBe(base)
    expect(ruleIdentityKey('DOMAIN,a.com,PROXY')).not.toBe(base)
  })

  it('keeps the case of non-domain conditions', () => {
    expect(ruleIdentityKey('PROCESS-NAME,Chrome.exe,DIRECT')).not.toBe(
      ruleIdentityKey('PROCESS-NAME,chrome.exe,DIRECT'),
    )
  })
})

describe('migrateSeqRules', () => {
  it('copies rules into the target, keeping the source sequence', () => {
    const {
      config: next,
      copied,
      skipped,
    } = migrateSeqRules(config(), [
      rule('DOMAIN,a.com,DIRECT'),
      rule('MATCH,DIRECT', 'append'),
    ])

    expect(copied).toBe(2)
    expect(skipped).toBe(0)
    expect(next.prepend).toEqual(['DOMAIN,a.com,DIRECT'])
    expect(next.append).toEqual(['MATCH,DIRECT'])
  })

  it('skips rules the target already has', () => {
    const {
      config: next,
      copied,
      skipped,
    } = migrateSeqRules(config({ prepend: ['DOMAIN,a.com,DIRECT'] }), [
      rule('domain,a.com,DIRECT'),
      rule('DOMAIN,b.com,DIRECT'),
    ])

    expect(copied).toBe(1)
    expect(skipped).toBe(1)
    expect(next.prepend).toEqual(['DOMAIN,a.com,DIRECT', 'DOMAIN,b.com,DIRECT'])
  })

  it('skips rules the target keeps closed', () => {
    const { copied, skipped } = migrateSeqRules(
      config({ disabled: { prepend: [], append: ['DOMAIN,a.com,DIRECT'] } }),
      [rule('DOMAIN,a.com,DIRECT')],
    )

    expect(copied).toBe(0)
    expect(skipped).toBe(1)
  })

  it('copies closed rules as closed rules', () => {
    const { config: next, copied } = migrateSeqRules(config(), [
      rule('DOMAIN,a.com,DIRECT', 'append', false),
    ])

    expect(copied).toBe(1)
    expect(next.append).toEqual([])
    expect(next.disabled.append).toEqual(['DOMAIN,a.com,DIRECT'])
  })

  it('skips duplicates inside the batch itself', () => {
    const { copied, skipped } = migrateSeqRules(config(), [
      rule('DOMAIN,a.com,DIRECT'),
      rule('DOMAIN,a.com,DIRECT', 'append'),
    ])

    expect(copied).toBe(1)
    expect(skipped).toBe(1)
  })

  it('leaves the target untouched when a rule differs in policy', () => {
    const { copied } = migrateSeqRules(
      config({ prepend: ['DOMAIN,a.com,DIRECT'] }),
      [rule('DOMAIN,a.com,PROXY')],
    )

    expect(copied).toBe(1)
  })

  it('does not modify the config it was given', () => {
    const target = config({ prepend: ['DOMAIN,a.com,DIRECT'] })
    migrateSeqRules(target, [rule('DOMAIN,b.com,DIRECT')])

    expect(target.prepend).toEqual(['DOMAIN,a.com,DIRECT'])
  })
})
