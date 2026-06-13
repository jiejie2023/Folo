import { FeedViewType } from "@follow/constants"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { subscriptionActions, useSubscriptionStore } from "./store"
import type { SubscriptionModel } from "./types"

const emptySetByView = () => ({
  [FeedViewType.All]: new Set<string>(),
  [FeedViewType.Articles]: new Set<string>(),
  [FeedViewType.Audios]: new Set<string>(),
  [FeedViewType.Notifications]: new Set<string>(),
  [FeedViewType.Pictures]: new Set<string>(),
  [FeedViewType.SocialMedia]: new Set<string>(),
  [FeedViewType.Videos]: new Set<string>(),
})

const emptyCategoryOpenStateByView = () => ({
  [FeedViewType.All]: {},
  [FeedViewType.Articles]: {},
  [FeedViewType.Audios]: {},
  [FeedViewType.Notifications]: {},
  [FeedViewType.Pictures]: {},
  [FeedViewType.SocialMedia]: {},
  [FeedViewType.Videos]: {},
})

const cloudSub = (feedId: string): SubscriptionModel => ({
  feedId,
  listId: null,
  inboxId: null,
  userId: "cloud-user",
  view: FeedViewType.Articles,
  isPrivate: false,
  hideFromTimeline: null,
  title: null,
  category: "Cloud",
  createdAt: "2026-06-13T00:00:00.000Z",
  type: "feed",
  source: "cloud",
})

const localSub = (feedId: string): SubscriptionModel => ({
  feedId,
  listId: null,
  inboxId: null,
  userId: "local",
  view: FeedViewType.Articles,
  isPrivate: false,
  hideFromTimeline: null,
  title: null,
  category: "Local",
  createdAt: "2026-06-13T00:00:00.000Z",
  type: "feed",
  source: "local",
})

vi.mock("@follow/database/services/subscription", () => ({
  SubscriptionService: {
    getSubscriptionAll: vi.fn(),
    reset: vi.fn(),
    upsertMany: vi.fn(),
  },
}))

describe("subscription source-aware reset", () => {
  beforeEach(() => {
    useSubscriptionStore.setState({
      data: {},
      feedIdByView: emptySetByView(),
      listIdByView: emptySetByView(),
      categories: emptySetByView(),
      subscriptionIdSet: new Set(),
      categoryOpenStateByView: emptyCategoryOpenStateByView(),
    })
  })

  test("resetBySourceInSession removes only cloud subscriptions and keeps local subscriptions", async () => {
    await subscriptionActions.upsertManyInSession([cloudSub("cloud-feed"), localSub("local-feed")])

    subscriptionActions.resetBySourceInSession("cloud")

    const state = useSubscriptionStore.getState()
    expect(state.data["cloud-feed"]).toBeUndefined()
    expect(state.data["local-feed"]?.source).toBe("local")
    expect(state.feedIdByView[FeedViewType.Articles]?.has("cloud-feed")).toBe(false)
    expect(state.feedIdByView[FeedViewType.Articles]?.has("local-feed")).toBe(true)
    expect(state.subscriptionIdSet.has("feed/cloud-feed")).toBe(false)
    expect(state.subscriptionIdSet.has("feed/local-feed")).toBe(true)
  })
})
