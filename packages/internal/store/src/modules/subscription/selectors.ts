import { FeedViewType } from "@follow/constants"

import { FEED_COLLECTION_LIST, ROUTE_FEED_IN_FOLDER } from "../../constants/app"
import type { SubscriptionState } from "./store"
import { getDefaultCategory } from "./utils"

export const getIsFeedSyncedSelector = (state: SubscriptionState) => (feedId: string | undefined) =>
  typeof feedId === "string" && (state.syncedFeedIds.has(feedId) || !!state.data[feedId]?.synced)

export const getSyncedFeedIdsSelector = (state: SubscriptionState) => (view?: FeedViewType) => {
  return Array.from(state.syncedFeedIds).filter((feedId) => {
    const subscription = state.data[feedId]
    if (!subscription || subscription.type !== "feed") return false
    return view === undefined || view === FeedViewType.All || subscription.view === view
  })
}

export const folderFeedsByFeedIdSelector =
  ({ feedIdOrCategory, view }: { feedIdOrCategory: string | undefined; view: FeedViewType }) =>
  (state: SubscriptionState): string[] => {
    if (typeof feedIdOrCategory !== "string") return []
    if (feedIdOrCategory === FEED_COLLECTION_LIST) {
      return [feedIdOrCategory]
    }

    const folderName = feedIdOrCategory.startsWith(ROUTE_FEED_IN_FOLDER)
      ? feedIdOrCategory.slice(ROUTE_FEED_IN_FOLDER.length)
      : feedIdOrCategory

    const feedIds: string[] = []
    for (const feedId in state.data) {
      const subscription = state.data[feedId]
      if (!subscription) continue
      if (
        (subscription.view === view || view === FeedViewType.All) &&
        (subscription.category
          ? subscription.category === folderName
          : getDefaultCategory(subscription) === folderName)
      ) {
        feedIds.push(feedId)
      }
    }
    return feedIds
  }
