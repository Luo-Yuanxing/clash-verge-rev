import { type Dispatch, type SetStateAction, useMemo } from 'react'

import { BaseSearchBox } from '@/components/base'
import {
  buildGroupedItems,
  type GroupedVirtualItem,
  GroupedVirtualList,
} from '@/components/profile/grouped-virtual-list'
import { RuleItem } from '@/components/profile/rule-item'

interface Props {
  prependSeq: string[]
  appendSeq: string[]
  deleteSeq: string[]
  ruleList: string[]
  match: (content: string) => boolean
  onMatchChange: Dispatch<SetStateAction<(content: string) => boolean>>
}

/**
 * 只读的 prepend/original/append 分组规则列表
 */
export const SeqRulesView = (props: Props) => {
  const { prependSeq, appendSeq, deleteSeq, ruleList, match, onMatchChange } =
    props

  const filteredPrependSeq = useMemo(
    () => prependSeq.filter((rule) => match(rule)),
    [prependSeq, match],
  )
  const filteredRuleList = useMemo(
    () => ruleList.filter((rule) => match(rule)),
    [ruleList, match],
  )
  const filteredAppendSeq = useMemo(
    () => appendSeq.filter((rule) => match(rule)),
    [appendSeq, match],
  )

  const items = useMemo(
    () =>
      buildGroupedItems(
        filteredPrependSeq,
        filteredRuleList,
        filteredAppendSeq,
        (rule) => rule,
      ),
    [filteredPrependSeq, filteredRuleList, filteredAppendSeq],
  )

  const renderItem = (entry: GroupedVirtualItem<string>) => {
    const { category, item } = entry
    const type =
      category === 'original'
        ? deleteSeq.includes(item)
          ? 'delete'
          : 'original'
        : category

    return <RuleItem type={type} ruleRaw={item} readOnly onDelete={() => {}} />
  }

  return (
    <>
      <BaseSearchBox onSearch={(next) => onMatchChange(() => next)} />
      <GroupedVirtualList
        items={items}
        renderItem={renderItem}
        onReorder={() => {}}
        readOnly
        style={{ height: 'calc(100% - 32px)', marginTop: '8px' }}
      />
    </>
  )
}
