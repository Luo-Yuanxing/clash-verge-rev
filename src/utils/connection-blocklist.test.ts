import { describe, expect, it } from 'vitest'

import {
  createBlocklistMatcher,
  normalizeBlockHost,
  normalizeBlocklist,
} from './connection-blocklist'

describe('normalizeBlockHost', () => {
  it('去掉端口并统一小写', () => {
    expect(normalizeBlockHost('API.Wetab.Link:443')).toBe('api.wetab.link')
    expect(normalizeBlockHost('  api.wetab.link  ')).toBe('api.wetab.link')
  })

  it('去掉尾部点，处理方括号 IPv6 与裸 IPv6', () => {
    expect(normalizeBlockHost('example.com.')).toBe('example.com')
    expect(normalizeBlockHost('[::1]:8080')).toBe('::1')
    expect(normalizeBlockHost('2001:db8::1')).toBe('2001:db8::1')
  })

  it('空值返回空串', () => {
    expect(normalizeBlockHost('')).toBe('')
    expect(normalizeBlockHost('   ')).toBe('')
  })
})

describe('normalizeBlocklist', () => {
  it('规范化、去重并去掉空项', () => {
    expect(
      normalizeBlocklist([
        ' api.wetab.link ',
        'api.wetab.link:443',
        '',
        'www.wetab.link',
      ]),
    ).toEqual(['api.wetab.link', 'www.wetab.link'])
  })

  it('没有条目时返回空数组', () => {
    expect(normalizeBlocklist(undefined)).toEqual([])
  })
})

describe('createBlocklistMatcher', () => {
  it('只按域名严格匹配，端口不影响判定', () => {
    const isBlocked = createBlocklistMatcher(['api.wetab.link'])

    expect(isBlocked('api.wetab.link')).toBe(true)
    expect(isBlocked('api.wetab.link:443')).toBe(true)
    expect(isBlocked('API.WETAB.LINK')).toBe(true)
  })

  it('不匹配子域名与父域名', () => {
    const isBlocked = createBlocklistMatcher(['api.wetab.link'])

    expect(isBlocked('www.wetab.link')).toBe(false)
    expect(isBlocked('wetab.link')).toBe(false)
    expect(isBlocked('xapi.wetab.link')).toBe(false)
    expect(isBlocked('')).toBe(false)
  })

  it('黑名单为空时全部放行', () => {
    const isBlocked = createBlocklistMatcher(undefined)

    expect(isBlocked('api.wetab.link')).toBe(false)
  })
})
