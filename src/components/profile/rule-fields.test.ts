import { describe, expect, it } from 'vitest'

import {
  normalizeDomainSuffix,
  parseRuleParts,
  serializeRuleParts,
} from './rule-fields'

describe('parseRuleParts / serializeRuleParts', () => {
  it('拆分并原样拼回普通规则', () => {
    const parts = parseRuleParts('DOMAIN-SUFFIX,example.com,DIRECT')
    expect(parts).toEqual({
      type: 'DOMAIN-SUFFIX',
      host: 'example.com',
      policy: 'DIRECT',
      noResolve: false,
    })
    expect(serializeRuleParts(parts)).toBe('DOMAIN-SUFFIX,example.com,DIRECT')
  })

  it('识别并保留 no-resolve', () => {
    const parts = parseRuleParts('IP-CIDR,127.0.0.0/8,DIRECT,no-resolve')
    expect(parts).toEqual({
      type: 'IP-CIDR',
      host: '127.0.0.0/8',
      policy: 'DIRECT',
      noResolve: true,
    })
    expect(serializeRuleParts(parts)).toBe(
      'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
    )
  })

  it('条件内部带逗号的嵌套规则不被拆散', () => {
    const rule = 'AND,((DOMAIN,baidu.com),(NETWORK,UDP)),DIRECT'
    const parts = parseRuleParts(rule)
    expect(parts.host).toBe('((DOMAIN,baidu.com),(NETWORK,UDP))')
    expect(serializeRuleParts(parts)).toBe(rule)
  })

  it('无条件规则不写多余逗号', () => {
    expect(serializeRuleParts(parseRuleParts('MATCH,DIRECT'))).toBe(
      'MATCH,DIRECT',
    )
  })

  it('DOMAIN-SUFFIX 的条件归一化到两级域名', () => {
    expect(
      serializeRuleParts(
        parseRuleParts('DOMAIN-SUFFIX,www.twitter.com,DIRECT'),
      ),
    ).toBe('DOMAIN-SUFFIX,twitter.com,DIRECT')
  })
})

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
