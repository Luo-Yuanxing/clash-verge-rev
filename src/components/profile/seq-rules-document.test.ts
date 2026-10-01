import * as yaml from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'

import {
  applyRuleEnabled,
  emptySeqRulesConfig,
  findFirstNonEmptyRulesUid,
  hasSeqRules,
  isSameSeqRulesConfig,
  mergeSeqRules,
  removeSeqRule,
  type SeqRulesConfig,
  type SeqRulesDocument,
  serializeSeqRules,
  toSeqConfig,
  updateSeqRule,
} from './seq-rules-document'

vi.mock('@/services/cmds', () => ({ readProfileFile: vi.fn() }))

const rules = (prepend: string[], append: string[] = []): ISeqProfileConfig =>
  ({ prepend, append, delete: [] }) as unknown as ISeqProfileConfig

/** 用给定的文件内容伪造 readSeqRulesDocument，未给出的属性视为读取失败 */
const reader =
  (files: Record<string, ISeqProfileConfig>) =>
  async (property: string): Promise<SeqRulesDocument> => {
    const config = files[property]
    if (!config) throw new Error(`no such file: ${property}`)
    return { raw: '', config }
  }

const candidates = [
  { uid: 'a', property: 'a' },
  { uid: 'b', property: 'b' },
]

describe('findFirstNonEmptyRulesUid', () => {
  it('skips profiles without custom rules', async () => {
    const read = reader({
      a: rules([]),
      b: rules(['DOMAIN,x.com,DIRECT']),
    })

    await expect(findFirstNonEmptyRulesUid(candidates, read)).resolves.toBe('b')
  })

  it('accepts profiles with append rules only', async () => {
    const read = reader({ a: rules([], ['MATCH,DIRECT']) })

    await expect(
      findFirstNonEmptyRulesUid([{ uid: 'a', property: 'a' }], read),
    ).resolves.toBe('a')
  })

  it('returns an empty uid when every profile is empty', async () => {
    const read = reader({ a: rules([]), b: rules([]) })

    await expect(findFirstNonEmptyRulesUid(candidates, read)).resolves.toBe('')
  })

  it('treats read failures as empty and keeps looking', async () => {
    const read = reader({ b: rules(['DOMAIN,x.com,DIRECT']) })

    await expect(findFirstNonEmptyRulesUid(candidates, read)).resolves.toBe('b')
  })
})

const config = (overrides: Partial<SeqRulesConfig> = {}): SeqRulesConfig => ({
  prepend: [],
  append: [],
  delete: [],
  disabled: { prepend: [], append: [] },
  excludeSubscriptionRules: false,
  ...overrides,
})

describe('serializeSeqRules', () => {
  it('keeps closed rules under disabled instead of prepend/append', () => {
    const text = serializeSeqRules(
      config({
        prepend: ['DOMAIN,on.com,DIRECT'],
        disabled: { prepend: ['DOMAIN,off.com,DIRECT'], append: [] },
      }),
    )
    const parsed = yaml.load(text) as ISeqProfileConfig

    expect(parsed.prepend).toEqual(['DOMAIN,on.com,DIRECT'])
    expect(toSeqConfig(parsed).disabled).toEqual({
      prepend: ['DOMAIN,off.com,DIRECT'],
      append: [],
    })
  })

  it('omits the disabled key when no rule is closed', () => {
    const parsed = yaml.load(serializeSeqRules(config()))

    expect(parsed).not.toHaveProperty('disabled')
  })
})

describe('applyRuleEnabled', () => {
  it('moves a rule out of its sequence when it is turned off', () => {
    const next = applyRuleEnabled(
      config({ prepend: ['DOMAIN,on.com,DIRECT', 'MATCH,DIRECT'] }),
      [{ rule: 'DOMAIN,on.com,DIRECT', source: 'prepend', enabled: true }],
      false,
    )

    expect(next.prepend).toEqual(['MATCH,DIRECT'])
    expect(next.disabled.prepend).toEqual(['DOMAIN,on.com,DIRECT'])
  })

  it('moves a rule back to its own sequence when it is turned on', () => {
    const next = applyRuleEnabled(
      config({
        append: ['MATCH,DIRECT'],
        disabled: { prepend: [], append: ['DOMAIN,off.com,DIRECT'] },
      }),
      [{ rule: 'DOMAIN,off.com,DIRECT', source: 'append', enabled: false }],
      true,
    )

    expect(next.disabled.append).toEqual([])
    expect(next.append).toEqual(['MATCH,DIRECT', 'DOMAIN,off.com,DIRECT'])
  })

  it('toggles every target in one pass', () => {
    const next = applyRuleEnabled(
      config({
        prepend: ['DOMAIN,a.com,DIRECT'],
        append: ['DOMAIN,b.com,DIRECT'],
      }),
      [
        { rule: 'DOMAIN,a.com,DIRECT', source: 'prepend', enabled: true },
        { rule: 'DOMAIN,b.com,DIRECT', source: 'append', enabled: true },
      ],
      false,
    )

    expect(next.prepend).toEqual([])
    expect(next.append).toEqual([])
    expect(next.disabled).toEqual({
      prepend: ['DOMAIN,a.com,DIRECT'],
      append: ['DOMAIN,b.com,DIRECT'],
    })
  })
})

describe('updateSeqRule', () => {
  const base = config({
    prepend: ['DOMAIN,a.com,DIRECT', 'DOMAIN,b.com,DIRECT'],
    append: ['DOMAIN,c.com,PROXY'],
    disabled: { prepend: ['DOMAIN,d.com,PROXY'], append: [] },
  })

  it('rewrites the rule in place', () => {
    const next = updateSeqRule(
      base,
      { rule: 'DOMAIN,a.com,DIRECT', source: 'prepend', enabled: true },
      'DOMAIN-KEYWORD,a,DIRECT',
    )

    expect(next.prepend).toEqual([
      'DOMAIN-KEYWORD,a,DIRECT',
      'DOMAIN,b.com,DIRECT',
    ])
    expect(next.append).toEqual(['DOMAIN,c.com,PROXY'])
  })

  it('drops a duplicate copy kept in the other sequence', () => {
    const next = updateSeqRule(
      config({
        prepend: ['DOMAIN,a.com,DIRECT'],
        append: ['DOMAIN,x.com,DIRECT'],
      }),
      { rule: 'DOMAIN,a.com,DIRECT', source: 'prepend', enabled: true },
      'DOMAIN,x.com,DIRECT',
    )

    expect(next.prepend).toEqual(['DOMAIN,x.com,DIRECT'])
    expect(next.append).toEqual([])
  })

  it('drops a duplicate copy kept under disabled', () => {
    const next = updateSeqRule(
      base,
      { rule: 'DOMAIN,a.com,DIRECT', source: 'prepend', enabled: true },
      'DOMAIN,d.com,PROXY',
    )

    expect(next.prepend).toEqual(['DOMAIN,d.com,PROXY', 'DOMAIN,b.com,DIRECT'])
    expect(next.disabled.prepend).toEqual([])
  })

  it('renames a closed rule without turning it back on', () => {
    const next = updateSeqRule(
      base,
      { rule: 'DOMAIN,d.com,PROXY', source: 'prepend', enabled: false },
      'DOMAIN,e.com,PROXY',
    )

    expect(next.disabled.prepend).toEqual(['DOMAIN,e.com,PROXY'])
    expect(next.prepend).toEqual(['DOMAIN,a.com,DIRECT', 'DOMAIN,b.com,DIRECT'])
  })

  it('returns the same config when nothing changed', () => {
    const next = updateSeqRule(
      base,
      { rule: 'DOMAIN,a.com,DIRECT', source: 'prepend', enabled: true },
      'DOMAIN,a.com,DIRECT',
    )

    expect(next).toBe(base)
  })

  it('leaves one copy when an edited rule collides with an existing one', () => {
    const next = updateSeqRule(
      config({ prepend: ['DOMAIN,a.com,DIRECT', 'DOMAIN,b.com,DIRECT'] }),
      { rule: 'DOMAIN,a.com,DIRECT', source: 'prepend', enabled: true },
      'DOMAIN,b.com,DIRECT',
    )

    expect(next.prepend).toEqual(['DOMAIN,b.com,DIRECT'])
  })
})

describe('removeSeqRule', () => {
  it('drops an enabled rule from its sequence', () => {
    const next = removeSeqRule(
      config({ prepend: ['DOMAIN,a.com,DIRECT', 'MATCH,DIRECT'] }),
      { rule: 'DOMAIN,a.com,DIRECT', source: 'prepend', enabled: true },
    )

    expect(next.prepend).toEqual(['MATCH,DIRECT'])
  })

  it('drops a closed rule from disabled', () => {
    const next = removeSeqRule(
      config({ disabled: { prepend: [], append: ['DOMAIN,off.com,DIRECT'] } }),
      { rule: 'DOMAIN,off.com,DIRECT', source: 'append', enabled: false },
    )

    expect(next.disabled.append).toEqual([])
  })
})

describe('isSameSeqRulesConfig', () => {
  it('compares by content, not by reference', () => {
    const source = config({ prepend: ['DOMAIN,a.com,DIRECT'] })

    expect(isSameSeqRulesConfig(source, { ...source })).toBe(true)
    expect(isSameSeqRulesConfig(source, config({ prepend: [] }))).toBe(false)
  })

  it('treats a different order as a different draft', () => {
    const source = config({
      prepend: ['DOMAIN,a.com,DIRECT', 'DOMAIN,b.com,DIRECT'],
    })
    const reordered = config({
      prepend: ['DOMAIN,b.com,DIRECT', 'DOMAIN,a.com,DIRECT'],
    })

    expect(isSameSeqRulesConfig(source, reordered)).toBe(false)
  })
})

describe('mergeSeqRules', () => {
  it('keeps the first copy of each rule and ORs the exclude flag', () => {
    const merged = mergeSeqRules([
      config({ prepend: ['DOMAIN,a.com,DIRECT'] }),
      config({
        prepend: ['DOMAIN,a.com,DIRECT', 'DOMAIN,b.com,DIRECT'],
        append: ['MATCH,DIRECT'],
        disabled: { prepend: [], append: ['DOMAIN,off.com,DIRECT'] },
        excludeSubscriptionRules: true,
      }),
    ])

    expect(merged.prepend).toEqual([
      'DOMAIN,a.com,DIRECT',
      'DOMAIN,b.com,DIRECT',
    ])
    expect(merged.append).toEqual(['MATCH,DIRECT'])
    expect(merged.disabled.append).toEqual(['DOMAIN,off.com,DIRECT'])
    expect(merged.excludeSubscriptionRules).toBe(true)
  })

  it('only counts excludeSubscriptionRules or rules as content', () => {
    expect(hasSeqRules(emptySeqRulesConfig())).toBe(false)
    expect(
      hasSeqRules({ ...emptySeqRulesConfig(), excludeSubscriptionRules: true }),
    ).toBe(true)
    expect(hasSeqRules(config({ append: ['MATCH,DIRECT'] }))).toBe(true)
  })
})
