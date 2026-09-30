import { useCallback, useEffect, useRef, useState } from 'react'

import { showNotice } from '@/services/notice-service'
import { parseYamlSafe } from '@/utils/yaml'

import {
  readSeqRulesDocument,
  serializeSeqRules,
  toSeqConfig,
} from './seq-rules-document'

/**
 * 读取 Rules 配置（prepend/original/append/delete）与序列化写回，
 * 供规则编辑器与自定义规则页共用。
 */
export const useSeqRuleConfig = (property: string, active: boolean) => {
  const [prevData, setPrevData] = useState('')
  const [currData, setCurrData] = useState('')
  const [visualization, setVisualization] = useState(true)
  const [match, setMatch] = useState(() => (_: string) => true)
  const [prependSeq, setPrependSeq] = useState<string[]>([])
  const [appendSeq, setAppendSeq] = useState<string[]>([])
  const [deleteSeq, setDeleteSeq] = useState<string[]>([])
  const [ruleList, setRuleList] = useState<string[]>([])
  const hasLoadedSeqConfigRef = useRef(false)

  useEffect(() => {
    if (!active) return

    hasLoadedSeqConfigRef.current = false
    void (async () => {
      const { raw, config } = await readSeqRulesDocument(property)

      setPrevData(raw)
      setCurrData(raw)

      if (config === undefined) {
        hasLoadedSeqConfigRef.current = false
        setVisualization(false)
        return
      }

      const { prepend, append, delete: removed } = toSeqConfig(config)
      hasLoadedSeqConfigRef.current = true
      setPrependSeq(prepend)
      setAppendSeq(append)
      setDeleteSeq(removed)
    })()
  }, [active, property])

  const handleVisualizationToggle = () => {
    if (visualization) {
      setVisualization(false)
      return
    }

    const config = parseYamlSafe(currData) as
      | ISeqProfileConfig
      | null
      | undefined
    if (config === undefined) {
      hasLoadedSeqConfigRef.current = false
      return
    }

    const { prepend, append, delete: removed } = toSeqConfig(config)
    hasLoadedSeqConfigRef.current = true
    setPrependSeq(prepend)
    setAppendSeq(append)
    setDeleteSeq(removed)
    setVisualization(true)
  }

  const resetContent = useCallback(async () => {
    const { raw, config } = await readSeqRulesDocument(property)

    setPrevData(raw)
    setCurrData(raw)
    if (config !== undefined) {
      const { prepend, append, delete: removed } = toSeqConfig(config)
      setPrependSeq(prepend)
      setAppendSeq(append)
      setDeleteSeq(removed)
    }
  }, [property])

  // 优化：异步处理大数据yaml.dump，避免UI卡死
  useEffect(() => {
    if (!hasLoadedSeqConfigRef.current) {
      return
    }

    if (!(prependSeq && appendSeq && deleteSeq)) {
      return
    }

    const serialize = () => {
      if (!hasLoadedSeqConfigRef.current) {
        return
      }

      try {
        setCurrData(
          serializeSeqRules({
            prepend: prependSeq,
            append: appendSeq,
            delete: deleteSeq,
          }),
        )
      } catch (error) {
        showNotice.error(error ?? 'YAML dump error')
      }
    }
    let idleId: number | undefined
    let timeoutId: number | undefined
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(serialize)
    } else {
      timeoutId = window.setTimeout(serialize, 0)
    }
    return () => {
      if (idleId !== undefined && window.cancelIdleCallback) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }, [prependSeq, appendSeq, deleteSeq])

  return {
    prevData,
    currData,
    setCurrData,
    visualization,
    handleVisualizationToggle,
    match,
    setMatch,
    prependSeq,
    setPrependSeq,
    appendSeq,
    setAppendSeq,
    deleteSeq,
    setDeleteSeq,
    ruleList,
    setRuleList,
    resetContent,
  }
}
