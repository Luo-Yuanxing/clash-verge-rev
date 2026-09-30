import * as yaml from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'

import {
  applyRuleEnabled,
  findFirstNonEmptyRulesUid,
  removeSeqRule,
  type SeqRulesConfig,
  type SeqRulesDocument,
  serializeSeqRules,
  toSeqConfig,
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
