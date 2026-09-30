import * as yaml from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'

import {
  findFirstNonEmptyRulesUid,
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
