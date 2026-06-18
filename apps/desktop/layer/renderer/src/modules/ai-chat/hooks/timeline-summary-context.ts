import type { FeedViewType } from "@follow/constants"
import { getCategoryFeedIds } from "@follow/store/subscription/getter"
import { useAtomValue } from "jotai"
import { useMemo } from "react"

import { useGeneralSettingKey } from "~/atoms/settings/general"
import { ROUTE_FEED_IN_FOLDER, ROUTE_FEED_PENDING } from "~/constants"
import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"
import { currentTimelineEntryIdsAtom } from "~/modules/entry-column/atoms/current-timeline-entries"

import { BlockSliceAction } from "../store/slices/block.slice"
import type { AIChatContextBlock } from "../store/types"

type CreateTimelineSummaryContextBlocksOptions = {
  entryIds?: string[]
  feedId?: string | null
  resolveCategoryFeedIds?: (categoryName: string, view: FeedViewType) => string[]
  unreadOnly: boolean
  view?: FeedViewType | number | null
}

export const createTimelineEntriesContextBlock = (
  entryIds: string[],
): AIChatContextBlock | null => {
  const value = entryIds
    .map((entryId) => entryId.trim())
    .filter(Boolean)
    .join(",")

  if (!value) return null

  return {
    id: BlockSliceAction.SPECIAL_TYPES.timelineEntries,
    type: "timelineEntries",
    value,
  }
}

export const hasTimelineEntriesContextBlock = (blocks: AIChatContextBlock[]): boolean =>
  blocks.some((block) => block.type === "timelineEntries" && block.value.trim().length > 0)

export const ensureTimelineEntriesContextBlock = (
  blocks: AIChatContextBlock[],
  entryIds: string[],
): AIChatContextBlock[] => {
  const timelineEntriesBlock = createTimelineEntriesContextBlock(entryIds)
  if (!timelineEntriesBlock) return blocks

  return [...blocks.filter((block) => block.type !== "timelineEntries"), timelineEntriesBlock]
}

export const createTimelineSummaryContextBlocks = ({
  entryIds = [],
  feedId,
  resolveCategoryFeedIds = getCategoryFeedIds,
  unreadOnly,
  view,
}: CreateTimelineSummaryContextBlocksOptions): AIChatContextBlock[] => {
  const blocks: AIChatContextBlock[] = []

  if (typeof view === "number") {
    blocks.push({
      id: BlockSliceAction.SPECIAL_TYPES.mainView,
      type: "mainView",
      value: `${view}`,
    })
  }

  if (feedId && feedId !== ROUTE_FEED_PENDING) {
    let value = feedId
    if (feedId.startsWith(ROUTE_FEED_IN_FOLDER) && typeof view === "number") {
      const categoryName = feedId.slice(ROUTE_FEED_IN_FOLDER.length)
      const feedIds = resolveCategoryFeedIds(categoryName, view as FeedViewType)
      if (feedIds.length > 0) {
        value = feedIds.join(",")
      }
    }

    blocks.push({
      id: BlockSliceAction.SPECIAL_TYPES.mainFeed,
      type: "mainFeed",
      value,
    })
  }

  if (unreadOnly) {
    blocks.push({
      id: BlockSliceAction.SPECIAL_TYPES.unreadOnly,
      type: "unreadOnly",
      value: "true",
    })
  }

  const timelineEntriesBlock = createTimelineEntriesContextBlock(entryIds)
  if (timelineEntriesBlock) {
    blocks.push(timelineEntriesBlock)
  }

  return blocks
}

export const useTimelineSummaryContextBlocks = (): AIChatContextBlock[] => {
  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const entryIds = useAtomValue(currentTimelineEntryIdsAtom)
  const { feedId, view } = useRouteParamsSelector((params) => ({
    feedId: params.feedId,
    view: params.view,
  }))

  return useMemo(
    () =>
      createTimelineSummaryContextBlocks({
        entryIds,
        feedId,
        unreadOnly,
        view,
      }),
    [entryIds, feedId, unreadOnly, view],
  )
}
