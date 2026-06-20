import { FeedViewType } from "@follow/constants"
import { EntryService } from "@follow/database/services/entry"
import { FeedService } from "@follow/database/services/feed"
import { SubscriptionService } from "@follow/database/services/subscription"
import { tracker } from "@follow/tracker"
import { omit } from "es-toolkit"

import { api } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { apiMorph } from "../../morph/api"
import { dbStoreMorph } from "../../morph/db-store"
import { buildSubscriptionDbId, storeDbMorph } from "../../morph/store-db"
import { invalidateEntriesQuery } from "../entry/hooks"
import type { EntryModel } from "../entry/types"
import { getFeedById } from "../feed/getter"
import { feedActions } from "../feed/store"
import { inboxActions } from "../inbox/store"
import { getListById } from "../list/getters"
import { listActions } from "../list/store"
import { unreadActions } from "../unread/store"
import { whoami } from "../user/getters"
import { getCategoryFeedIds } from "./getter"
import {
  inferRecoveredSubscriptionCategory,
  RECOVERED_LOCAL_SUBSCRIPTION_CATEGORY,
} from "./recovery-category"
import type { SubscriptionSource } from "./source"
import { getSubscriptionSource } from "./source"
import type { LocalSubscriptionInput, SubscriptionForm, SubscriptionModel } from "./types"
import { getDefaultCategory, getSubscriptionDBId, getSubscriptionStoreId } from "./utils"

type FeedId = string
type ListId = string

const createEmptySetByView = <T extends string>(): Record<FeedViewType, Set<T>> => ({
  [FeedViewType.All]: new Set(),
  [FeedViewType.Articles]: new Set(),
  [FeedViewType.Audios]: new Set(),
  [FeedViewType.Notifications]: new Set(),
  [FeedViewType.Pictures]: new Set(),
  [FeedViewType.SocialMedia]: new Set(),
  [FeedViewType.Videos]: new Set(),
})

export interface SubscriptionState {
  /**
   * Key: FeedId, ListId, `inbox/${inboxId}`
   * Value: SubscriptionPlainModel
   */
  data: Record<string, SubscriptionModel>

  /** Feed ids confirmed to exist in the signed-in account. */
  syncedFeedIds: Set<FeedId>

  feedIdByView: Record<FeedViewType, Set<FeedId>>

  listIdByView: Record<FeedViewType, Set<ListId>>

  /**
   * All named categories names set
   */
  categories: Record<FeedViewType, Set<string>>
  /**
   * All subscription ids set
   */
  subscriptionIdSet: Set<string>

  categoryOpenStateByView: Record<FeedViewType, Record<string, boolean>>
}

const emptyCategoryOpenStateByView: Record<FeedViewType, Record<string, boolean>> = {
  [FeedViewType.All]: {},
  [FeedViewType.Articles]: {},
  [FeedViewType.Audios]: {},
  [FeedViewType.Notifications]: {},
  [FeedViewType.Pictures]: {},
  [FeedViewType.SocialMedia]: {},
  [FeedViewType.Videos]: {},
}

const defaultState: SubscriptionState = {
  data: {},
  syncedFeedIds: new Set(),
  feedIdByView: createEmptySetByView(),
  listIdByView: createEmptySetByView(),
  categories: createEmptySetByView(),
  subscriptionIdSet: new Set(),
  categoryOpenStateByView: { ...emptyCategoryOpenStateByView },
}

const rebuildSubscriptionIndexes = (state: SubscriptionState) => {
  state.feedIdByView = createEmptySetByView()
  state.listIdByView = createEmptySetByView()
  state.categories = createEmptySetByView()
  state.subscriptionIdSet = new Set()

  for (const subscription of Object.values(state.data)) {
    state.subscriptionIdSet.add(getSubscriptionDBId(subscription))

    if (subscription.feedId && subscription.type === "feed") {
      state.feedIdByView[subscription.view]!.add(subscription.feedId)
      state.feedIdByView[FeedViewType.All]!.add(subscription.feedId)
      if (subscription.category) {
        state.categories[subscription.view]!.add(subscription.category)
      }
    }

    if (subscription.listId && subscription.type === "list") {
      state.listIdByView[subscription.view]!.add(subscription.listId)
      state.listIdByView[FeedViewType.All]!.add(subscription.listId)
    }
  }
}

const toLocalEntryModels = (
  entries: NonNullable<LocalSubscriptionInput["entries"]>,
  feedId: string,
): EntryModel[] =>
  entries.map((entry) => ({
    ...entry,
    content: null,
    extra: entry.extra
      ? {
          ...entry.extra,
          links: entry.extra.links ?? undefined,
        }
      : null,
    feedId,
    insertedAt: new Date(entry.publishedAt),
    publishedAt: new Date(entry.publishedAt),
    read: false,
  }))

const invalidateViews = (...views: (FeedViewType | undefined)[]) => {
  const viewSet = new Set<FeedViewType>()

  for (const view of views) {
    if (view === undefined) continue
    viewSet.add(view)
  }

  if (viewSet.size === 0) return

  viewSet.add(FeedViewType.All)

  invalidateEntriesQuery({
    views: Array.from(viewSet),
  })
}

type CachedFeed = Awaited<ReturnType<typeof FeedService.getFeedAll>>[number]
type CachedEntry = Awaited<ReturnType<typeof EntryService.getEntryAll>>[number]

const recoverLocalSubscriptionsFromCachedFeeds = (
  existingSubscriptions: SubscriptionModel[],
  feeds: CachedFeed[],
  entries: CachedEntry[],
): SubscriptionModel[] => {
  const existingFeedIds = new Set(
    existingSubscriptions
      .map((subscription) => subscription.feedId)
      .filter((feedId): feedId is string => !!feedId),
  )
  const cachedFeeds = feeds.filter((feed) => feed.id && feed.url && !existingFeedIds.has(feed.id))

  if (cachedFeeds.length === 0) return []

  const feedIdsWithEntries = new Set<string>()
  for (const entry of entries) {
    if (entry.feedId) {
      feedIdsWithEntries.add(entry.feedId)
    }
  }

  const recoveredFeeds =
    feedIdsWithEntries.size > 0
      ? cachedFeeds.filter((feed) => feedIdsWithEntries.has(feed.id))
      : cachedFeeds

  return recoveredFeeds.map((feed) => ({
    feedId: feed.id,
    listId: null,
    inboxId: null,
    userId: "local",
    view: FeedViewType.Articles,
    isPrivate: false,
    hideFromTimeline: null,
    title: null,
    category: inferRecoveredSubscriptionCategory(feed),
    createdAt: new Date().toISOString(),
    type: "feed",
    source: "local",
    synced: false,
  }))
}

const reclassifyRecoveredLocalSubscriptions = (
  subscriptions: SubscriptionModel[],
  feeds: CachedFeed[],
): SubscriptionModel[] => {
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]))

  return subscriptions.flatMap((subscription) => {
    if (
      getSubscriptionSource(subscription) !== "local" ||
      subscription.category !== RECOVERED_LOCAL_SUBSCRIPTION_CATEGORY ||
      !subscription.feedId
    ) {
      return []
    }

    const feed = feedById.get(subscription.feedId)
    if (!feed) return []

    const category = inferRecoveredSubscriptionCategory(feed)

    return [
      {
        ...subscription,
        category,
      },
    ]
  })
}

export const useSubscriptionStore = createZustandStore<SubscriptionState>("subscription")(
  () => defaultState,
)

const get = useSubscriptionStore.getState

const immerSet = createImmerSetter(useSubscriptionStore)

const shouldPreserveLocalSubscription = (
  current: SubscriptionModel | undefined,
  next: SubscriptionModel,
) => {
  return (
    current && getSubscriptionSource(current) === "local" && getSubscriptionSource(next) === "cloud"
  )
}

const filterLocalFirstSubscriptions = (subscriptions: SubscriptionModel[]) => {
  const state = get()
  return subscriptions.filter((subscription) => {
    const subscriptionStoreId = getSubscriptionStoreId(subscription)
    return !shouldPreserveLocalSubscription(state.data[subscriptionStoreId], subscription)
  })
}

const getLocalSubscriptionsSyncedByCloudUpserts = (subscriptions: SubscriptionModel[]) => {
  const state = get()
  return subscriptions
    .filter((subscription) => {
      const current = state.data[getSubscriptionStoreId(subscription)]
      return !!subscription.feedId && shouldPreserveLocalSubscription(current, subscription)
    })
    .map((subscription) => subscription.feedId!)
}

const getLocalSyncedFeedIds = (view?: FeedViewType) => {
  return Object.values(get().data)
    .filter((subscription) => {
      return (
        subscription.type === "feed" &&
        !!subscription.feedId &&
        getSubscriptionSource(subscription) === "local" &&
        !!subscription.synced &&
        (typeof view !== "number" || subscription.view === view)
      )
    })
    .map((subscription) => subscription.feedId!)
}

const getAccountMutableFeedIds = (feedIds: string[]) => {
  if (!whoami()) return []

  return feedIds
    .map((id) => get().data[id])
    .filter((subscription): subscription is SubscriptionModel => {
      return (
        !!subscription &&
        subscription.type === "feed" &&
        !!subscription.feedId &&
        (getSubscriptionSource(subscription) === "cloud" || !!subscription.synced)
      )
    })
    .map((subscription) => subscription.feedId!)
}

class SubscriptionActions implements Hydratable, Resetable {
  async hydrate() {
    const [subscriptions, feeds, entries] = await Promise.all([
      SubscriptionService.getSubscriptionAll(),
      FeedService.getFeedAll(),
      EntryService.getEntryAll(),
    ])
    const subscriptionModels = subscriptions.map((s) => dbStoreMorph.toSubscriptionModel(s))
    if (subscriptionModels.length > 0) {
      await this.upsertManyInSession(subscriptionModels)
    }

    const reclassifiedSubscriptions = reclassifyRecoveredLocalSubscriptions(
      subscriptionModels,
      feeds,
    )
    if (reclassifiedSubscriptions.length > 0) {
      await Promise.all(
        reclassifiedSubscriptions.map((subscription) =>
          SubscriptionService.patch(storeDbMorph.toSubscriptionSchema(subscription)),
        ),
      )
      this.replaceManyAndRebuildIndexesInSession(reclassifiedSubscriptions)
    }

    const recoveredSubscriptions = recoverLocalSubscriptionsFromCachedFeeds(
      subscriptionModels,
      feeds,
      entries,
    )
    if (recoveredSubscriptions.length === 0) {
      return
    }

    await SubscriptionService.upsertMany(
      recoveredSubscriptions.map((subscription) => storeDbMorph.toSubscriptionSchema(subscription)),
    )
    await this.upsertManyInSession(recoveredSubscriptions)
  }
  private replaceManyAndRebuildIndexesInSession(subscriptions: SubscriptionModel[]) {
    immerSet((draft) => {
      for (const subscription of subscriptions) {
        draft.data[getSubscriptionStoreId(subscription)] = subscription
      }
      rebuildSubscriptionIndexes(draft)
    })
  }

  async upsertManyInSession(subscriptions: SubscriptionModel[]) {
    immerSet((draft) => {
      for (const subscription of subscriptions) {
        const nextSubscription =
          getSubscriptionSource(subscription) === "cloud"
            ? {
                ...subscription,
                synced: true,
              }
            : subscription
        const subscriptionSetId = getSubscriptionDBId(subscription)
        const subscriptionStoreId = getSubscriptionStoreId(subscription)
        if (
          (subscription.synced || getSubscriptionSource(subscription) === "cloud") &&
          subscription.feedId
        ) {
          draft.syncedFeedIds.add(subscription.feedId)
        }
        const current = draft.data[subscriptionStoreId]
        if (current && shouldPreserveLocalSubscription(current, subscription)) {
          current.synced = true
          continue
        }

        draft.data[subscriptionStoreId] = nextSubscription
        draft.subscriptionIdSet.add(subscriptionSetId)

        if (subscription.feedId && subscription.type === "feed") {
          draft.feedIdByView[subscription.view]!.add(subscription.feedId)
          draft.feedIdByView[FeedViewType.All]!.add(subscription.feedId)
          if (subscription.category) {
            draft.categories[subscription.view]!.add(subscription.category)
          }
        }
        if (subscription.listId && subscription.type === "list") {
          draft.listIdByView[subscription.view]!.add(subscription.listId)
          draft.listIdByView[FeedViewType.All]!.add(subscription.listId)
        }
      }
    })
  }
  async upsertMany(
    subscriptions: SubscriptionModel[],
    options: { resetBeforeUpsert?: boolean | FeedViewType; resetSource?: SubscriptionSource } = {},
  ) {
    const resetView =
      typeof options.resetBeforeUpsert === "number" ? options.resetBeforeUpsert : undefined
    const subscriptionsToUpsert = filterLocalFirstSubscriptions(subscriptions)
    const localSyncedFeedIdsToReset =
      options.resetSource === "cloud" ? getLocalSyncedFeedIds(resetView) : []
    const localSyncedFeedIdsToMark = getLocalSubscriptionsSyncedByCloudUpserts(subscriptions)
    const tx = createTransaction()
    tx.store(() => {
      if (options.resetBeforeUpsert !== undefined) {
        if (options.resetSource) {
          this.resetBySourceInSession(options.resetSource, resetView)
        } else if (typeof options.resetBeforeUpsert === "boolean") {
          this.reset()
        } else {
          this.resetByView(options.resetBeforeUpsert)
        }
      } else if (options.resetSource) {
        this.resetBySourceInSession(options.resetSource)
      }
      this.upsertManyInSession(subscriptions)
    })

    tx.persist(() => {
      return (async () => {
        if (options.resetSource) {
          await SubscriptionService.resetBySource(options.resetSource, resetView)
        }

        if (localSyncedFeedIdsToReset.length > 0) {
          await SubscriptionService.patchMany({
            feedIds: localSyncedFeedIdsToReset,
            data: { synced: false },
          })
        }

        if (localSyncedFeedIdsToMark.length > 0) {
          await SubscriptionService.patchMany({
            feedIds: localSyncedFeedIdsToMark,
            data: { synced: true },
          })
        }

        if (subscriptionsToUpsert.length === 0) return

        return SubscriptionService.upsertMany(
          subscriptionsToUpsert.map((s) =>
            storeDbMorph.toSubscriptionSchema({
              ...s,
              synced: s.synced || getSubscriptionSource(s) === "cloud",
            }),
          ),
        )
      })()
    })

    await tx.run()
  }

  resetBySourceInSession(source: SubscriptionSource, view?: FeedViewType) {
    immerSet((draft) => {
      if (source === "cloud") {
        for (const feedId of draft.syncedFeedIds) {
          const subscription = draft.data[feedId]
          if (typeof view === "number" && subscription?.view !== view) continue
          if (subscription && getSubscriptionSource(subscription) === "local") {
            subscription.synced = false
          }
          draft.syncedFeedIds.delete(feedId)
        }
      }

      for (const [subscriptionStoreId, subscription] of Object.entries(draft.data)) {
        if (getSubscriptionSource(subscription) !== source) continue
        if (typeof view === "number" && subscription.view !== view) continue

        delete draft.data[subscriptionStoreId]
      }

      rebuildSubscriptionIndexes(draft)
    })
  }

  resetByView(view: FeedViewType) {
    immerSet((draft) => {
      draft.feedIdByView[view] = new Set()
      draft.listIdByView[view] = new Set()
      draft.categories[view] = new Set()
      draft.subscriptionIdSet = new Set()
    })
  }

  toggleCategoryOpenState(view: FeedViewType, category: string) {
    immerSet((state) => {
      state.categoryOpenStateByView[view]![category] =
        !state.categoryOpenStateByView[view]![category]
    })
  }

  markFeedSynced(feedId: string) {
    immerSet((draft) => {
      draft.syncedFeedIds.add(feedId)
      if (draft.data[feedId]) {
        draft.data[feedId].synced = true
      }
    })
  }

  changeCategoryOpenState(view: FeedViewType, category: string, status: boolean) {
    immerSet((state) => {
      state.categoryOpenStateByView[view]![category] = status
    })
  }

  expandCategoryOpenStateByView(view: FeedViewType, isOpen: boolean) {
    immerSet((state) => {
      for (const category in state.categoryOpenStateByView[view]!) {
        state.categoryOpenStateByView[view]![category] = isOpen
      }
    })
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      // set(defaultState)
      immerSet((draft) => {
        Object.assign(draft, omit(defaultState, ["categoryOpenStateByView"]))
      })
    })

    tx.persist(() => {
      return SubscriptionService.reset()
    })

    await tx.run()
  }
}

class SubscriptionSyncService {
  async fetch(view?: FeedViewType) {
    const { data } = await api().subscriptions.get({
      view: view !== undefined ? view : undefined,
    })

    const { subscriptions, collections } = apiMorph.toSubscription(data)

    feedActions.upsertMany(collections.feeds)
    subscriptionActions.upsertMany(subscriptions, {
      resetBeforeUpsert: typeof view === "number" ? view : true,
      resetSource: "cloud",
    })
    listActions.upsertMany(collections.lists)

    inboxActions.upsertMany(collections.inboxes)

    return {
      subscriptions,
      feeds: collections.feeds,
    }
  }

  async edit(subscription: SubscriptionModel) {
    const subscriptionId = getSubscriptionStoreId(subscription)
    const current = get().data[subscriptionId]
    if (!current) {
      return
    }
    const shouldEditLocally = getSubscriptionSource(current) === "local" || !whoami()
    const nextSubscription = {
      ...subscription,
      source: shouldEditLocally ? "local" : getSubscriptionSource(current),
    }
    const tx = createTransaction(current)

    tx.store(() => {
      immerSet((draft) => {
        draft.data[subscriptionId] = nextSubscription
        rebuildSubscriptionIndexes(draft)
      })
    })
    tx.rollback((current) => {
      immerSet((draft) => {
        draft.data[subscriptionId] = current
        rebuildSubscriptionIndexes(draft)
      })
    })
    tx.request(async () => {
      if (shouldEditLocally) {
        return
      }

      await api().subscriptions.update({
        ...nextSubscription,
        feedId: nextSubscription.feedId ?? undefined,
        listId: nextSubscription.listId ?? undefined,
      })
    })

    tx.persist(() => {
      return SubscriptionService.patch(storeDbMorph.toSubscriptionSchema(nextSubscription))
    })

    await tx.run()

    invalidateViews(current.view, nextSubscription.view)
  }

  async subscribe(subscription: SubscriptionForm) {
    const data = await api().subscriptions.create(subscription)

    if (data.feed) {
      feedActions.upsertMany([data.feed as any])
      tracker.subscribe({ feedId: data.feed.id, view: subscription.view })
    }

    if (data.list) {
      listActions.upsertMany([
        {
          ...(data.list as any),
          userId: data.list.ownerUserId,
          type: "list",
          subscriptionCount: null,
          purchaseAmount: null,
        },
      ])
      tracker.subscribe({ listId: data.list.id, view: subscription.view })
    }

    if (data.unread) {
      unreadActions.upsertMany(data.unread)
    }

    // Insert to subscription
    await subscriptionActions.upsertMany([
      {
        ...subscription,
        title: subscription.title ?? null,
        category: subscription.category ?? null,

        type: data.list ? "list" : "feed",
        createdAt: new Date().toISOString(),
        feedId: data.feed?.id ?? null,
        listId: data.list?.id ?? null,
        inboxId: null,
        userId: whoami()?.id ?? "",
        source: "cloud",
      },
    ])

    invalidateViews(subscription.view)
  }

  async syncLocalToCloud(feedId: string) {
    const current = get().data[feedId]
    if (!current) {
      throw new Error("Subscription not found")
    }

    if (current.type !== "feed" || !current.feedId) {
      throw new Error("Only feed subscriptions can be synced to account")
    }

    if (getSubscriptionSource(current) !== "local") {
      return
    }

    if (!whoami()) {
      throw new Error("Login required")
    }

    const feed = getFeedById(current.feedId)
    if (!feed?.url) {
      throw new Error("Cannot sync local subscription without a feed url")
    }

    const subscription = {
      url: feed.url,
      view: current.view,
      category: current.category,
      isPrivate: current.isPrivate,
      feedId: current.feedId,
      listId: undefined,
      title: current.title,
      hideFromTimeline: current.hideFromTimeline,
    }

    const data = await api().subscriptions.create(subscription)

    if (data.feed) {
      feedActions.upsertMany([data.feed as any])
      tracker.subscribe({ feedId: data.feed.id, view: current.view })
    }

    if (data.unread) {
      unreadActions.upsertMany(data.unread)
    }

    await this.fetch()
    subscriptionActions.markFeedSynced(feedId)
    await SubscriptionService.patch({
      id: buildSubscriptionDbId(current),
      synced: true,
    })

    invalidateViews(current.view)
  }

  async subscribeLocal({ feed, subscription, entries }: LocalSubscriptionInput) {
    const feedId = subscription.feedId || feed.id

    if (!feedId) {
      throw new Error("Cannot add local subscription without a feed id")
    }

    if (get().data[feedId]) {
      throw new Error("Subscription already exists")
    }

    await feedActions.upsertMany([{ ...feed, id: feedId }])

    await subscriptionActions.upsertMany([
      {
        ...subscription,
        feedId,
        listId: null,
        inboxId: null,
        title: subscription.title ?? null,
        category: subscription.category ?? null,
        hideFromTimeline: subscription.hideFromTimeline ?? null,
        type: "feed",
        createdAt: new Date().toISOString(),
        userId: "local",
        source: "local",
      },
    ])

    if (entries?.length) {
      const { entryActions } = await import("../entry/store")
      await entryActions.upsertMany(toLocalEntryModels(entries, feedId))
    }

    invalidateViews(subscription.view)
  }

  async unsubscribe(id: string | undefined | null | (string | undefined | null)[]) {
    const normalizedIds = (Array.isArray(id) ? id : [id]).filter((i) => typeof i === "string")
    const subscriptionList = normalizedIds.map((id) => get().data[id]).filter((i) => !!i)
    const feedsAndLists = normalizedIds
      .map((id) => getFeedById(id) ?? getListById(id))
      .filter((i) => !!i)
    if (subscriptionList.length === 0) return feedsAndLists

    const feedSubscriptions = subscriptionList.filter((i) => i.type === "feed")
    const listSubscriptions = subscriptionList.filter((i) => i.type === "list")
    const shouldSyncCloud = !!whoami()
    const cloudSubscriptionList = shouldSyncCloud
      ? subscriptionList.filter((i) => getSubscriptionSource(i) === "cloud")
      : []
    const cloudFeedSubscriptions = cloudSubscriptionList.filter((i) => i.type === "feed")
    const cloudListSubscriptions = cloudSubscriptionList.filter((i) => i.type === "list")

    const tx = createTransaction(subscriptionList)

    tx.store(() => {
      immerSet((draft) => {
        for (const id of normalizedIds) {
          const subscription = draft.data[id]
          if (!subscription) continue
          if (subscription.feedId) draft.syncedFeedIds.delete(subscription.feedId)
          delete draft.data[id]
        }
        rebuildSubscriptionIndexes(draft)
      })
    })

    if (cloudSubscriptionList.length > 0) {
      tx.request(async () => {
        const feedIdList = cloudFeedSubscriptions
          .map((s) => s.feedId)
          .filter((i) => typeof i === "string")
        await api().subscriptions.delete({
          feedIdList: feedIdList.length > 0 ? feedIdList : undefined,
          listId: cloudListSubscriptions.at(0)?.listId || undefined,
        })
      })
    }

    tx.rollback((current) => {
      immerSet((draft) => {
        for (const [index, id] of normalizedIds.entries()) {
          const subscription = current[index]
          if (!subscription) continue

          draft.data[id] = subscription

          draft.subscriptionIdSet.add(getSubscriptionDBId(subscription))
          if (subscription.feedId) {
            draft.feedIdByView[subscription.view]!.add(subscription.feedId)
            draft.feedIdByView[FeedViewType.All]!.add(subscription.feedId)
          }
          if (subscription.listId) {
            draft.listIdByView[subscription.view]!.add(subscription.listId)
            draft.listIdByView[FeedViewType.All]!.add(subscription.listId)
          }
          if (subscription.category) {
            draft.categories[subscription.view]!.add(subscription.category)
            draft.categories[FeedViewType.All]!.add(subscription.category)
          }
        }
        rebuildSubscriptionIndexes(draft)
      })
    })

    tx.persist(() => {
      return SubscriptionService.delete(subscriptionList.map((i) => buildSubscriptionDbId(i)))
    })

    await tx.run()
    const affectedViews = Array.from(
      new Set([...feedSubscriptions, ...listSubscriptions].map((i) => i.view)),
    )
    invalidateViews(...affectedViews)

    feedSubscriptions.forEach((i) => {
      unreadActions.updateById(i.feedId, 0)
    })
    return feedsAndLists
  }

  async batchUpdateSubscription({
    feedIds,
    category: newCategory,
    view: newView,
  }: {
    feedIds: string[]
    category?: string | null
    view: FeedViewType
  }) {
    const hasCategoryUpdate = newCategory !== undefined
    const cloudMutationFeedIds = getAccountMutableFeedIds(feedIds)
    const current = feedIds
      .map((id) => get().data[id])
      .map((i) =>
        i
          ? {
              view: i.view,
              category: i.category,
            }
          : null,
      )

    const tx = createTransaction()
    tx.store(() => {
      immerSet((draft) => {
        for (const feedId of feedIds) {
          const subscription = draft.data[feedId]
          if (!subscription) continue

          subscription.view = newView

          if (hasCategoryUpdate) {
            subscription.category = newCategory ?? null
          }
        }
        rebuildSubscriptionIndexes(draft)
      })
    })

    if (cloudMutationFeedIds.length > 0) {
      tx.request(async () => {
        await api().subscriptions.batchUpdate({
          feedIds: cloudMutationFeedIds,
          category: newCategory,
          view: newView,
        })
      })
    }

    tx.rollback(() => {
      immerSet((draft) => {
        for (const [index, feedId] of feedIds.entries()) {
          const subscription = draft.data[feedId]
          if (!subscription) continue
          if (!current[index]) continue

          subscription.view = current[index].view
          subscription.category = current[index].category
        }
        rebuildSubscriptionIndexes(draft)
      })
    })

    tx.persist(() => {
      const data = hasCategoryUpdate
        ? {
            view: newView,
            category: newCategory ?? null,
          }
        : {
            view: newView,
          }

      return SubscriptionService.patchMany({
        feedIds,
        data,
      })
    })

    await tx.run()
  }

  async changeListView({ listId, view }: { listId: string; view: FeedViewType }) {
    const current = get().data[listId]
    if (!current) {
      return
    }

    const currentView = current.view
    const newView = view

    const tx = createTransaction(current)
    tx.store(() => {
      immerSet((draft) => {
        if (!draft.data[listId]) {
          return
        }

        draft.data[listId]!.view = newView
        draft.listIdByView[currentView]!.delete(listId)
        draft.listIdByView[newView]!.add(listId)
      })
    })

    tx.request(async () => {
      await api().subscriptions.update({
        view,
        listId,
      })
    })

    tx.rollback((current) => {
      immerSet((draft) => {
        if (!draft.data[listId]) {
          return
        }

        draft.data[listId]!.view = current.view
        draft.listIdByView[newView]!.delete(listId)
        draft.listIdByView[currentView]!.add(listId)
      })
    })

    tx.persist(() => {
      return SubscriptionService.patch(
        storeDbMorph.toSubscriptionSchema({
          ...current,
          view,
        }),
      )
    })

    await tx.run()
  }

  async deleteCategory({ category, view }: { category: string; view: FeedViewType }) {
    const feedIds = getCategoryFeedIds(category, view)

    const tx = createTransaction()
    tx.store(() => {
      immerSet((draft) => {
        for (const feedId of feedIds) {
          const subscription = draft.data[feedId]
          if (!subscription) continue
          subscription.category = null
        }
        draft.categories[view]!.delete(category)
      })
    })

    const cloudMutationFeedIds = getAccountMutableFeedIds(feedIds)

    if (cloudMutationFeedIds.length > 0) {
      tx.request(async () => {
        await api().categories.delete({
          feedIdList: cloudMutationFeedIds,
          deleteSubscriptions: false,
        })
      })
    }

    tx.rollback(() => {
      immerSet((draft) => {
        for (const feedId of feedIds) {
          const subscription = draft.data[feedId]
          if (!subscription) continue
          subscription.category = category
        }

        draft.categories[view]!.add(category)
      })
    })

    tx.persist(() => {
      return SubscriptionService.patchMany({
        feedIds,
        data: {
          category: null,
        },
      })
    })

    await tx.run()
  }

  async changeCategoryView({
    category,
    currentView,
    newView,
  }: {
    category: string
    currentView: FeedViewType
    newView: FeedViewType
  }) {
    const folderFeedIds = getCategoryFeedIds(category, currentView)

    await this.batchUpdateSubscription({
      feedIds: folderFeedIds,
      view: newView,
    })

    invalidateViews(currentView, newView)
  }

  async renameCategory({
    lastCategory,
    newCategory,
    view,
  }: {
    lastCategory: string
    newCategory: string
    view: FeedViewType
  }) {
    const feedIds = getCategoryFeedIds(lastCategory, view)

    const tx = createTransaction()
    tx.store(() => {
      immerSet((draft) => {
        for (const id of feedIds) {
          const subscription = draft.data[id]
          if (!subscription) continue
          subscription.category = newCategory
        }
        draft.categories[view]!.add(newCategory)
        draft.categories[view]!.delete(lastCategory)

        const lastCategoryOpenState = draft.categoryOpenStateByView[view]![lastCategory]
        if (typeof lastCategoryOpenState === "boolean") {
          draft.categoryOpenStateByView[view]![newCategory] = lastCategoryOpenState
          delete draft.categoryOpenStateByView[view]![lastCategory]
        }
      })
    })

    const cloudMutationFeedIds = getAccountMutableFeedIds(feedIds)

    if (cloudMutationFeedIds.length > 0) {
      tx.request(async () => {
        await api().categories.update({
          feedIdList: cloudMutationFeedIds,
          category: newCategory,
        })
      })
    }

    tx.rollback(() => {
      immerSet((draft) => {
        for (const id of feedIds) {
          const subscription = draft.data[id]
          if (!subscription) continue
          const defaultCategory = getDefaultCategory(subscription)
          subscription.category = lastCategory !== defaultCategory ? lastCategory : null
        }
        draft.categories[view]!.delete(newCategory)
        draft.categories[view]!.add(lastCategory)

        const lastCategoryOpenState = draft.categoryOpenStateByView[view]![newCategory]
        if (typeof lastCategoryOpenState === "boolean") {
          draft.categoryOpenStateByView[view]![lastCategory] = lastCategoryOpenState
          delete draft.categoryOpenStateByView[view]![newCategory]
        }
      })
    })

    tx.persist(() => {
      return SubscriptionService.patchMany({
        feedIds,
        data: {
          category: newCategory,
        },
      })
    })

    await tx.run()
  }
}

export const subscriptionActions = new SubscriptionActions()
export const subscriptionSyncService = new SubscriptionSyncService()
