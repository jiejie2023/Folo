import { FeedViewType } from "@follow/constants"
import type { EntrySchema, FeedSchema, SubscriptionSchema } from "@follow/database/schemas/types"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { apiContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useFeedStore } from "../feed/store"
import { useUserStore } from "../user/store"
import { getIsFeedSyncedSelector, getSyncedFeedIdsSelector } from "./selectors"
import { subscriptionActions, subscriptionSyncService, useSubscriptionStore } from "./store"
import type { SubscriptionModel } from "./types"

const {
  apiCategoryDeleteMock,
  apiCategoryUpdateMock,
  apiSubscriptionBatchUpdateMock,
  apiSubscriptionCreateMock,
  apiSubscriptionGetMock,
  entryGetAllMock,
  feedGetAllMock,
  feedUpsertManyMock,
  subscriptionGetAllMock,
  subscriptionDeleteMock,
  subscriptionPatchManyMock,
  subscriptionPatchMock,
  subscriptionUpsertManyMock,
} = vi.hoisted(() => ({
  apiCategoryDeleteMock: vi.fn(),
  apiCategoryUpdateMock: vi.fn(),
  apiSubscriptionBatchUpdateMock: vi.fn(),
  apiSubscriptionCreateMock: vi.fn(),
  apiSubscriptionGetMock: vi.fn(),
  entryGetAllMock: vi.fn(),
  feedGetAllMock: vi.fn(),
  feedUpsertManyMock: vi.fn(),
  subscriptionGetAllMock: vi.fn(),
  subscriptionDeleteMock: vi.fn(),
  subscriptionPatchManyMock: vi.fn(),
  subscriptionPatchMock: vi.fn(),
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
    getSubscriptionAll: subscriptionGetAllMock,
    patch: subscriptionPatchMock,
    patchMany: subscriptionPatchManyMock,
    reset: vi.fn(),
    resetBySource: vi.fn(),
    delete: subscriptionDeleteMock,
    upsertMany: subscriptionUpsertManyMock,
  },
}))

vi.mock("@follow/database/services/feed", () => ({
  FEED_EXTRA_DATA_KEYS: [],
  FeedService: {
    getFeedAll: feedGetAllMock,
    patch: vi.fn(),
    reset: vi.fn(),
    upsertMany: feedUpsertManyMock,
  },
}))

vi.mock("@follow/database/services/entry", () => ({
  EntryService: {
    getEntryAll: entryGetAllMock,
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
      syncedFeedIds: new Set(),
      feedIdByView: emptySetByView(),
      listIdByView: emptySetByView(),
      categories: emptySetByView(),
      subscriptionIdSet: new Set(),
      categoryOpenStateByView: emptyCategoryOpenStateByView(),
    })
    useFeedStore.setState({ feeds: {} })
    useUserStore.setState({
      whoami: null,
      role: null,
      roleEndAt: null,
      rsshubSubscriptionLimit: null,
      feedSubscriptionLimit: null,
    })
    subscriptionGetAllMock.mockResolvedValue([])
    feedGetAllMock.mockResolvedValue([])
    entryGetAllMock.mockResolvedValue([])
    apiContext.provide({
      categories: {
        delete: apiCategoryDeleteMock,
        update: apiCategoryUpdateMock,
      },
      subscriptions: {
        batchUpdate: apiSubscriptionBatchUpdateMock,
        create: apiSubscriptionCreateMock,
        get: apiSubscriptionGetMock,
      },
    } as unknown as FollowAPI)
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

  test("cloud upserts mark a local subscription as synced without duplicating it", async () => {
    await subscriptionActions.upsertManyInSession([localSub("shared-feed")])
    vi.clearAllMocks()

    await subscriptionActions.upsertMany([cloudSub("shared-feed")], {
      resetSource: "cloud",
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["shared-feed"]?.source).toBe("local")
    expect(state.data["shared-feed"]?.synced).toBe(true)
    expect(state.data["shared-feed"]?.category).toBe("Local")
    expect(Object.keys(state.data)).toEqual(["shared-feed"])
    expect(getIsFeedSyncedSelector(state)("shared-feed")).toBe(true)
    expect(getSyncedFeedIdsSelector(state)()).toEqual(["shared-feed"])
    expect(state.feedIdByView[FeedViewType.Articles]?.has("shared-feed")).toBe(true)
    expect(subscriptionUpsertManyMock).not.toHaveBeenCalled()
    expect(subscriptionPatchManyMock).toHaveBeenCalledWith({
      feedIds: ["shared-feed"],
      data: { synced: true },
    })
  })

  test("cloud reset clears stale synced markers for local subscriptions", async () => {
    await subscriptionActions.upsertManyInSession([{ ...localSub("local-feed"), synced: true }])
    vi.clearAllMocks()

    await subscriptionActions.upsertMany([], {
      resetSource: "cloud",
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["local-feed"]?.source).toBe("local")
    expect(state.data["local-feed"]?.synced).toBe(false)
    expect(getIsFeedSyncedSelector(state)("local-feed")).toBe(false)
    expect(subscriptionPatchManyMock).toHaveBeenCalledWith({
      feedIds: ["local-feed"],
      data: { synced: false },
    })
  })

  test("cloud-only feeds stay in the unified list and are marked as synced", async () => {
    await subscriptionActions.upsertMany([cloudSub("cloud-feed")], {
      resetSource: "cloud",
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["cloud-feed"]?.source).toBe("cloud")
    expect(state.data["cloud-feed"]?.synced).toBe(true)
    expect(getIsFeedSyncedSelector(state)("cloud-feed")).toBe(true)
    expect(getSyncedFeedIdsSelector(state)(FeedViewType.Articles)).toEqual(["cloud-feed"])
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

  test("hydrate recovers local feed subscriptions from cached feeds with entries", async () => {
    const cachedFeed: FeedSchema = {
      id: "cached-feed",
      url: "https://example.com/feed.xml",
      title: "Cached Feed",
    }
    const cachedFeedWithoutEntries: FeedSchema = {
      id: "cached-feed-without-entries",
      url: "https://example.com/empty.xml",
      title: "Cached Feed Without Entries",
    }
    const cachedEntry: EntrySchema = {
      id: "entry-1",
      guid: "entry-1",
      insertedAt: new Date("2026-06-15T00:00:00.000Z"),
      publishedAt: new Date("2026-06-15T00:00:00.000Z"),
      feedId: "cached-feed",
    }
    feedGetAllMock.mockResolvedValue([cachedFeed, cachedFeedWithoutEntries])
    entryGetAllMock.mockResolvedValue([cachedEntry])

    await subscriptionActions.hydrate()

    const state = useSubscriptionStore.getState()
    expect(state.data["cached-feed"]).toEqual(
      expect.objectContaining({
        feedId: "cached-feed",
        userId: "local",
        view: FeedViewType.Articles,
        category: "News",
        type: "feed",
        source: "local",
        synced: false,
      }),
    )
    expect(state.data["cached-feed-without-entries"]).toBeUndefined()
    expect(state.feedIdByView[FeedViewType.Articles]?.has("cached-feed")).toBe(true)
    expect(subscriptionUpsertManyMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "feed/cached-feed",
        feedId: "cached-feed",
        source: "local",
      }),
    ])
  })

  test("hydrate recovers missing cached feeds when account subscriptions already exist", async () => {
    const existingCloudSubscription: SubscriptionSchema = {
      ...cloudSub("cloud-feed"),
      id: "feed/cloud-feed",
    }
    const cloudFeed: FeedSchema = {
      id: "cloud-feed",
      url: "https://example.com/cloud.xml",
      title: "Cloud Feed",
    }
    const missingLocalFeed: FeedSchema = {
      id: "missing-local-feed",
      url: "https://example.com/local.xml",
      title: "Missing Local Feed",
    }
    const entries: EntrySchema[] = [
      {
        id: "cloud-entry",
        guid: "cloud-entry",
        insertedAt: new Date("2026-06-15T00:00:00.000Z"),
        publishedAt: new Date("2026-06-15T00:00:00.000Z"),
        feedId: "cloud-feed",
      },
      {
        id: "local-entry",
        guid: "local-entry",
        insertedAt: new Date("2026-06-15T00:00:00.000Z"),
        publishedAt: new Date("2026-06-15T00:00:00.000Z"),
        feedId: "missing-local-feed",
      },
    ]
    subscriptionGetAllMock.mockResolvedValue([existingCloudSubscription])
    feedGetAllMock.mockResolvedValue([cloudFeed, missingLocalFeed])
    entryGetAllMock.mockResolvedValue(entries)

    await subscriptionActions.hydrate()

    const state = useSubscriptionStore.getState()
    expect(state.data["cloud-feed"]?.source).toBe("cloud")
    expect(state.data["missing-local-feed"]).toEqual(
      expect.objectContaining({
        feedId: "missing-local-feed",
        source: "local",
        category: "News",
      }),
    )
    expect(subscriptionUpsertManyMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "feed/missing-local-feed",
        feedId: "missing-local-feed",
        source: "local",
      }),
    ])
  })

  test("hydrate reclassifies recovered local subscriptions from cached feed metadata", async () => {
    const recoveredLocalSubscription: SubscriptionSchema = {
      ...localSub("openai-feed"),
      id: "feed/openai-feed",
      category: "Recovered",
    }
    const manuallyCategorizedLocalSubscription: SubscriptionSchema = {
      ...localSub("manual-feed"),
      id: "feed/manual-feed",
      category: "My Folder",
    }
    const recoveredCloudSubscription: SubscriptionSchema = {
      ...cloudSub("cloud-feed"),
      id: "feed/cloud-feed",
      category: "Recovered",
    }

    subscriptionGetAllMock.mockResolvedValue([
      recoveredLocalSubscription,
      manuallyCategorizedLocalSubscription,
      recoveredCloudSubscription,
    ])
    feedGetAllMock.mockResolvedValue([
      {
        id: "openai-feed",
        title: "OpenAI News",
        url: "https://openai.com/news/rss.xml",
      },
      {
        id: "manual-feed",
        title: "GitHub Blog",
        url: "https://github.blog/feed/",
      },
      {
        id: "cloud-feed",
        title: "Anthropic Research",
        url: "rsshub://anthropic/research",
      },
    ])

    await subscriptionActions.hydrate()

    const state = useSubscriptionStore.getState()
    expect(state.data["openai-feed"]?.category).toBe("AI")
    expect(state.data["manual-feed"]?.category).toBe("My Folder")
    expect(state.data["cloud-feed"]?.category).toBe("Recovered")
    expect(subscriptionPatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "feed/openai-feed",
        feedId: "openai-feed",
        category: "AI",
        source: "local",
      }),
    )
    expect(subscriptionPatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: "feed/manual-feed",
      }),
    )
    expect(subscriptionPatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: "feed/cloud-feed",
      }),
    )
  })

  test("edit keeps local subscriptions local", async () => {
    await subscriptionActions.upsertManyInSession([localSub("local-feed")])

    await subscriptionSyncService.edit({
      ...localSub("local-feed"),
      category: "Updated Local",
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["local-feed"]?.source).toBe("local")
    expect(state.data["local-feed"]?.category).toBe("Updated Local")
    expect(subscriptionPatchMock).toHaveBeenCalledTimes(1)
  })

  test("edit converts cloud subscriptions to local while signed out", async () => {
    await subscriptionActions.upsertManyInSession([cloudSub("cloud-feed")])

    await subscriptionSyncService.edit({
      ...cloudSub("cloud-feed"),
      category: "Updated Offline",
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["cloud-feed"]?.source).toBe("local")
    expect(state.data["cloud-feed"]?.category).toBe("Updated Offline")
    expect(subscriptionPatchMock).toHaveBeenCalledTimes(1)
  })

  test("unsubscribe removes local subscriptions without requiring cloud api access", async () => {
    await subscriptionActions.upsertManyInSession([localSub("local-feed")])

    await expect(subscriptionSyncService.unsubscribe("local-feed")).resolves.toBeDefined()

    const state = useSubscriptionStore.getState()
    expect(state.data["local-feed"]).toBeUndefined()
    expect(state.feedIdByView[FeedViewType.Articles]?.has("local-feed")).toBe(false)
    expect(state.subscriptionIdSet.has("feed/local-feed")).toBe(false)
    expect(subscriptionDeleteMock).toHaveBeenCalledWith(["feed/local-feed"])
  })

  test("unsubscribe removes offline cloud subscriptions without requiring cloud api access", async () => {
    await subscriptionActions.upsertManyInSession([cloudSub("cloud-feed")])

    await expect(subscriptionSyncService.unsubscribe("cloud-feed")).resolves.toBeDefined()

    const state = useSubscriptionStore.getState()
    expect(state.data["cloud-feed"]).toBeUndefined()
    expect(state.feedIdByView[FeedViewType.Articles]?.has("cloud-feed")).toBe(false)
    expect(state.subscriptionIdSet.has("feed/cloud-feed")).toBe(false)
    expect(subscriptionDeleteMock).toHaveBeenCalledWith(["feed/cloud-feed"])
  })

  test("batchUpdateSubscription updates plain local subscriptions without cloud api access", async () => {
    await subscriptionActions.upsertManyInSession([localSub("local-feed")])

    await subscriptionSyncService.batchUpdateSubscription({
      feedIds: ["local-feed"],
      category: "Updated Local",
      view: FeedViewType.SocialMedia,
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["local-feed"]?.category).toBe("Updated Local")
    expect(state.data["local-feed"]?.view).toBe(FeedViewType.SocialMedia)
    expect(apiSubscriptionBatchUpdateMock).not.toHaveBeenCalled()
  })

  test("batchUpdateSubscription syncs synced local subscriptions when signed in", async () => {
    const user = {
      id: "cloud-user",
    } as unknown as NonNullable<ReturnType<typeof useUserStore.getState>["whoami"]>
    useUserStore.setState({ whoami: user })
    await subscriptionActions.upsertManyInSession([{ ...localSub("local-feed"), synced: true }])

    await subscriptionSyncService.batchUpdateSubscription({
      feedIds: ["local-feed"],
      category: "Synced Local",
      view: FeedViewType.SocialMedia,
    })

    expect(apiSubscriptionBatchUpdateMock).toHaveBeenCalledWith({
      feedIds: ["local-feed"],
      category: "Synced Local",
      view: FeedViewType.SocialMedia,
    })
  })

  test("renameCategory updates plain local categories without cloud api access", async () => {
    await subscriptionActions.upsertManyInSession([localSub("local-feed")])

    await subscriptionSyncService.renameCategory({
      lastCategory: "Local",
      newCategory: "Renamed Local",
      view: FeedViewType.Articles,
    })

    const state = useSubscriptionStore.getState()
    expect(state.data["local-feed"]?.category).toBe("Renamed Local")
    expect(apiCategoryUpdateMock).not.toHaveBeenCalled()
  })

  test("deleteCategory syncs only account-managed feeds when signed in", async () => {
    const user = {
      id: "cloud-user",
    } as unknown as NonNullable<ReturnType<typeof useUserStore.getState>["whoami"]>
    useUserStore.setState({ whoami: user })
    await subscriptionActions.upsertManyInSession([
      { ...localSub("local-feed"), category: "Mixed" },
      { ...localSub("synced-feed"), category: "Mixed", synced: true },
      { ...cloudSub("cloud-feed"), category: "Mixed" },
    ])

    await subscriptionSyncService.deleteCategory({
      category: "Mixed",
      view: FeedViewType.Articles,
    })

    expect(apiCategoryDeleteMock).toHaveBeenCalledWith({
      feedIdList: ["synced-feed", "cloud-feed"],
      deleteSubscriptions: false,
    })
  })

  test("syncLocalToCloud sends a local feed to the account and keeps it local", async () => {
    const user = {
      id: "cloud-user",
    } as unknown as NonNullable<ReturnType<typeof useUserStore.getState>["whoami"]>
    useUserStore.setState({ whoami: user })
    useFeedStore.setState({
      feeds: {
        "local-feed": {
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
      },
    })
    await subscriptionActions.upsertManyInSession([localSub("local-feed")])
    apiSubscriptionCreateMock.mockResolvedValue({
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
      },
    })
    apiSubscriptionGetMock.mockResolvedValue({
      data: [],
    })

    await subscriptionSyncService.syncLocalToCloud("local-feed")

    expect(apiSubscriptionCreateMock).toHaveBeenCalledWith({
      url: "https://example.com/feed.xml",
      view: FeedViewType.Articles,
      category: "Local",
      isPrivate: false,
      feedId: "local-feed",
      listId: undefined,
      title: null,
      hideFromTimeline: null,
    })
    expect(apiSubscriptionGetMock).toHaveBeenCalledWith({})
    const state = useSubscriptionStore.getState()
    expect(state.data["local-feed"]?.source).toBe("local")
    expect(state.data["local-feed"]?.userId).toBe("local")
    expect(state.data["local-feed"]?.synced).toBe(true)
    expect(getIsFeedSyncedSelector(state)("local-feed")).toBe(true)
    expect(subscriptionPatchMock).toHaveBeenCalledWith({
      id: "feed/local-feed",
      synced: true,
    })
    expect(subscriptionUpsertManyMock).not.toHaveBeenCalledWith([
      expect.objectContaining({
        id: "feed/local-feed",
        feedId: "local-feed",
        source: "cloud",
      }),
    ])
  })
})
