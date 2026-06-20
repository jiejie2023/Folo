import { getStorageNS } from "@follow/utils/ns"
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

import { createAtomHooks } from "~/lib/jotai"

import type { SubscriptionSearchState } from "./subscription-search-state"
import { closeSubscriptionSearch, openSubscriptionSearch } from "./subscription-search-state"

export type FeedListSortBy = "count" | "alphabetical"
export type FeedListSortOrder = "asc" | "desc"
const [, , useFeedListSort, , getFeedListSort, setFeedListSort, useFeedListSortSelector] =
  createAtomHooks(
    atomWithStorage(
      getStorageNS("feedListSort"),
      {
        by: "count" as FeedListSortBy,
        order: "desc" as FeedListSortOrder,
      },
      undefined,
      { getOnInit: true },
    ),
  )

export { getFeedListSort, useFeedListSort, useFeedListSortSelector }

export const setFeedListSortBy = (by: FeedListSortBy) => {
  setFeedListSort({
    ...getFeedListSort(),
    by,
  })
}

export const setFeedListSortOrder = (order: FeedListSortOrder) => {
  setFeedListSort({
    ...getFeedListSort(),
    order,
  })
}

const SELECT_NOTHING = []
export const [, useSelectedFeedIdsState, , , getSelectedFeedIds, setSelectedFeedIds, ,] =
  createAtomHooks(atom<string[]>(SELECT_NOTHING))
export const resetSelectedFeedIds = () => {
  setSelectedFeedIds(SELECT_NOTHING)
}

export const [, , useFeedAreaScrollProgressValue, , , setFeedAreaScrollProgressValue] =
  createAtomHooks(atom(0))

const [, useSubscriptionSearchState, , , getSubscriptionSearchState, setSubscriptionSearchState] =
  createAtomHooks(atom<SubscriptionSearchState>({ isOpen: false, query: "" }))

export { useSubscriptionSearchState }

export const openSubscriptionSearchPanel = () => {
  setSubscriptionSearchState(openSubscriptionSearch(getSubscriptionSearchState()))
}

export const closeSubscriptionSearchPanel = () => {
  setSubscriptionSearchState(closeSubscriptionSearch(getSubscriptionSearchState()))
}
