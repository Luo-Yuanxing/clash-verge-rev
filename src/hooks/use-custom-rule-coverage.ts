import { useEffect, useMemo, useState } from 'react'

import { isHostCoveredByRules } from '@/components/profile/rule-fields'
import {
  readSeqRulesDocument,
  toSeqConfig,
} from '@/components/profile/seq-rules-document'
import { useProfiles } from '@/hooks/use-profiles'

const EMPTY_RULES: string[] = []

/**
 * 读取当前运行订阅的自定义规则（prepend + append，不含已关闭的），
 * 返回判断主机名是否已被这些规则覆盖的函数。
 */
export const useCustomRuleCoverage = (active = true) => {
  const { current } = useProfiles()
  const property = current?.option?.rules ?? ''
  /** 已加载的规则及来源文件：来源不匹配时按“尚未加载”处理 */
  const [loaded, setLoaded] = useState<{ property: string; rules: string[] }>({
    property: '',
    rules: EMPTY_RULES,
  })

  useEffect(() => {
    if (!active || !property) return

    let cancelled = false
    void (async () => {
      try {
        const { config } = await readSeqRulesDocument(property)
        const { prepend, append } = toSeqConfig(config)
        if (!cancelled) setLoaded({ property, rules: [...prepend, ...append] })
      } catch {
        // 读取失败按没有自定义规则处理
        if (!cancelled) setLoaded({ property, rules: EMPTY_RULES })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, property])

  const rules =
    property && loaded.property === property ? loaded.rules : EMPTY_RULES

  return useMemo(
    () => (host: string) => isHostCoveredByRules(rules, host),
    [rules],
  )
}
