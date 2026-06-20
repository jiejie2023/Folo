import type { FeedViewType } from "@follow/constants"

import { ROUTE_FEED_PENDING } from "~/constants/app"

export const shouldUseViewFeedIds = ({
  feedId,
  folderIds,
  inboxId,
  isCollection,
  isSyncedTimeline,
  listId,
}: {
  feedId?: string
  folderIds: string[]
  inboxId?: string
  isCollection: boolean
  isSyncedTimeline: boolean
  listId?: string
  view: FeedViewType
}) =>
  !isSyncedTimeline &&
  (!feedId || feedId === ROUTE_FEED_PENDING) &&
  folderIds.length === 0 &&
  !isCollection &&
  !inboxId &&
  !listId

export const getTimelineFolderFeedIds = ({
  allowedFeedIds,
  folderIds,
}: {
  allowedFeedIds: string[]
  folderIds: string[]
}) => {
  const allowedFeedIdSet = new Set(allowedFeedIds)
  return folderIds.filter((feedId) => allowedFeedIdSet.has(feedId))
}

export const mergeEntryIds = (
  primaryIds: string[] | null | undefined,
  fallbackIds: string[] | null | undefined,
) => {
  const seen = new Set<string>()
  const merged: string[] = []

  for (const id of [...(primaryIds ?? []), ...(fallbackIds ?? [])]) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }

  return merged
}
