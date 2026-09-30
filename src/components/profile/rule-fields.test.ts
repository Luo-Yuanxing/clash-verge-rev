import { describe, expect, it } from 'vitest'

import { normalizeDomainSuffix } from './rule-fields'

describe('normalizeDomainSuffix', () => {
  it('只保留最后两级域名', () => {
    expect(normalizeDomainSuffix('www.twitter.com')).toBe('twitter.com')
    expect(normalizeDomainSuffix('api.x.com')).toBe('x.com')
    expect(normalizeDomainSuffix('a.b.c.example.com')).toBe('example.com')
  })

  it('已是两级域名时保持不变，并统一为小写', () => {
    expect(normalizeDomainSuffix('twitter.com')).toBe('twitter.com')
    expect(normalizeDomainSuffix('API.X.COM')).toBe('x.com')
    expect(normalizeDomainSuffix('.Example.com')).toBe('example.com')
  })

  it('多级公共后缀保留三级', () => {
    expect(normalizeDomainSuffix('a.b.example.co.uk')).toBe('example.co.uk')
    expect(normalizeDomainSuffix('www.taobao.com.cn')).toBe('taobao.com.cn')
  })

  it('IP 与异常输入原样返回', () => {
    expect(normalizeDomainSuffix('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeDomainSuffix('::1')).toBe('::1')
    expect(normalizeDomainSuffix('')).toBe('')
    expect(normalizeDomainSuffix('   ')).toBe('   ')
  })
})
