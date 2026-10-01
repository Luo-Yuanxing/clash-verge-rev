import { useCallback, useEffect, useMemo, useState } from 'react'

import { isHostCoveredByRules } from '@/components/profile/rule-fields'
import {
  readSeqRulesDocument,
  toSeqConfig,
} from '@/components/profile/seq-rules-document'
import { useProfiles } from '@/hooks/use-profiles'
import { debugLog } from '@/utils/debug'

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
    // 无条件的来源日志：连接页挂载过就一定有输出，便于区分“没跑”与“跑了但规则为空”
    debugLog('[custom-rules] 覆盖判断来源', { active, property })
    if (!active || !property) return

    let cancelled = false
    void (async () => {
      try {
        const { config } = await readSeqRulesDocument(property)
        const { prepend, append } = toSeqConfig(config)
        const nextRules = [...prepend, ...append]
        // 规则为 0 条时覆盖判断恒为 false，输出出来便于排查“不生效”
        debugLog('[custom-rules] 覆盖判断已加载规则', {
          property,
          count: nextRules.length,
        })
        if (!cancelled) setLoaded({ property, rules: nextRules })
      } catch (err) {
        // 读取失败按没有自定义规则处理
        console.warn('[custom-rules] 读取规则文件失败', property, err)
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
