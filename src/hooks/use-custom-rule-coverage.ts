import { useCallback, useEffect, useMemo, useState } from 'react'

import { isHostCoveredByRules } from '@/components/profile/rule-fields'
import {
  readSeqRulesDocument,
  toSeqConfig,
} from '@/components/profile/seq-rules-document'
import { useProfiles } from '@/hooks/use-profiles'

const EMPTY_RULES: string[] = []

/**
 * 读取当前运行订阅的自定义规则（prepend + append，不含已关闭的），
 * 返回判断主机名是否已被这些规则覆盖的函数，以及重读规则文件的方法。
 */
export const useCustomRuleCoverage = (active = true) => {
  const { current } = useProfiles()
  const property = current?.option?.rules ?? ''
  /** 已加载的规则及来源文件：来源不匹配时按“尚未加载”处理 */
  const [loaded, setLoaded] = useState<{ property: string; rules: string[] }>({
    property: '',
    rules: EMPTY_RULES,
  })
  /** 打开规则文件重新读一次的触发器：新建规则后覆盖判断要立刻跟上 */
  const [reloadToken, setReloadToken] = useState(0)

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
  }, [active, property, reloadToken])

  const rules =
    property && loaded.property === property ? loaded.rules : EMPTY_RULES

  const isHostCovered = useMemo(
    () => (host: string) => isHostCoveredByRules(rules, host),
    [rules],
  )

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  return { isHostCovered, reload }
}
