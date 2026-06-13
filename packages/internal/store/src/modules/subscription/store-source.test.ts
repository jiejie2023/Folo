import { FeedViewType } from "@follow/constants"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { subscriptionActions, subscriptionSyncService, useSubscriptionStore } from "./store"
import type { SubscriptionModel } from "./types"

const { feedUpsertManyMock, subscriptionUpsertManyMock } = vi.hoisted(() => ({
  feedUpsertManyMock: vi.fn(),
  subscriptionUpsertManyMock: vi.fn(),
}))

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
    resetBySource: vi.fn(),
    upsertMany: subscriptionUpsertManyMock,
  },
}))

vi.mock("@follow/database/services/feed", () => ({
  FEED_EXTRA_DATA_KEYS: [],
  FeedService: {
    getFeedAll: vi.fn(),
    patch: vi.fn(),
    reset: vi.fn(),
    upsertMany: feedUpsertManyMock,
  },
}))

vi.mock("../entry/hooks", () => ({
  invalidateEntriesQuery: vi.fn(),
}))

describe("subscription source-aware reset", () => {
  beforeEach(() => {
    vi.clearAllMocks()

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

  test("subscribeLocal inserts a local feed subscription", async () => {
    await subscriptionSyncService.subscribeLocal({
      feed: {
        id: "local-feed",
        url: "https://example.com/feed.xml",
        title: "Example Feed",
        description: null,
        image: null,
        siteUrl: "https://example.com",
        ownerUserId: null,
        errorAt: null,
        errorMessage: null,
        type: "feed",
      },
      subscription: {
        url: "https://example.com/feed.xml",
        view: FeedViewType.Articles,
        category: "Local",
        isPrivate: false,
        hideFromTimeline: null,
        title: null,
        feedId: "local-feed",
        listId: undefined,
      },
      entries: [],
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["local-feed"]?.source).toBe("local")
    expect(state.feedIdByView[FeedViewType.Articles]?.has("local-feed")).toBe(true)
    expect(feedUpsertManyMock).toHaveBeenCalledTimes(1)
    expect(subscriptionUpsertManyMock).toHaveBeenCalledTimes(1)
  })
})
