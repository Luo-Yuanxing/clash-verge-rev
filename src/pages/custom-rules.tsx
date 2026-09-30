import { Box } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Rule } from 'tauri-plugin-mihomo-api'

import {
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  VirtualList,
  type VirtualListHandle,
} from '@/components/base'
import { ScrollTopButton } from '@/components/layout/scroll-top-button'
import RuleItem from '@/components/rule/rule-item'
import { useProfiles } from '@/hooks/use-profiles'
import { useVisibility } from '@/hooks/use-visibility'

// Rule flags may follow the proxy policy, e.g. "DOMAIN-SUFFIX,a.com,PROXY,no-resolve".
const TRAILING_MARKERS = new Set(['no-resolve', 'src'])

const toRuleItem = (line: string, index: number): Rule & { lineNo: number } => {
  const parts = line.split(',')
  while (
    parts.length > 2 &&
    TRAILING_MARKERS.has(parts[parts.length - 1].trim().toLowerCase())
  ) {
    parts.pop()
  }

  const proxy = parts.length > 1 ? (parts.pop() ?? '').trim() : ''
  const type = (parts.shift() ?? '').trim()

  return {
    type: { Unknown: type },
    index,
    payload: parts.join(',').trim(),
    proxy,
    size: 0,
    lineNo: index + 1,
  }
}

const CustomRulesPage = () => {
  const { t } = useTranslation()
  const { current, mutateProfiles } = useProfiles()
  const pageVisible = useVisibility()
  const [match, setMatch] = useState(() => (_: string) => true)
  const virtuosoRef = useRef<VirtualListHandle>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  useEffect(() => {
    void mutateProfiles()
  }, [mutateProfiles, pageVisible])

  const rules = useMemo(() => {
    return (current?.option?.rules ?? '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map(toRuleItem)
  }, [current])

  const filteredRules = useMemo(
    () => rules.filter((rule) => match(rule.payload) || match(rule.proxy)),
    [rules, match],
  )

  const handleScroll = useCallback((e: Event) => {
    setShowScrollTop((e.target as HTMLElement).scrollTop > 100)
  }, [])

  const scrollToTop = () => {
    virtuosoRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <BasePage
      full
      title={t('rules.custom.page.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: '10px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
      </Box>

      {filteredRules.length > 0 ? (
        <>
          <VirtualList
            ref={virtuosoRef}
            count={filteredRules.length}
            estimateSize={40}
            renderItem={(i) => <RuleItem value={filteredRules[i]} />}
            style={{ flex: 1 }}
            onScroll={handleScroll}
          />
          <ScrollTopButton onClick={scrollToTop} show={showScrollTop} />
        </>
      ) : (
        <BaseEmpty />
      )}
    </BasePage>
  )
}

export default CustomRulesPage
