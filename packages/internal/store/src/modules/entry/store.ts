import { FeedViewType } from "@follow/constants"
import { EntryService } from "@follow/database/services/entry"
import { isBizId } from "@follow/utils"
import { cloneDeep } from "es-toolkit"
import { debounce } from "es-toolkit/compat"

import { api, localAI } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { readNdjsonStream } from "../../lib/stream"
import { apiMorph } from "../../morph/api"
import { dbStoreMorph } from "../../morph/db-store"
import { storeDbMorph } from "../../morph/store-db"
import { collectionActions } from "../collection/store"
import { clearAllFeedUnreadDirty, clearFeedUnreadDirty } from "../feed/hooks"
import { feedActions } from "../feed/store"
import type { LocalAIBridge } from "../local-ai/types"
import { getSubscriptionById } from "../subscription/getter"
import { getDefaultCategory } from "../subscription/utils"
import type {
  FeedIdOrInboxHandle,
  InsertedBeforeTimeRangeFilter,
  PublishAtTimeRangeFilter,
} from "../unread/types"
import { userActions } from "../user/store"
import { getEntry } from "./getter"
import type { EntryModel, FetchEntriesProps, FetchEntriesPropsSettings } from "./types"
import { getEntriesParams } from "./utils"

type EntryId = string
type FeedId = string
type InboxId = string
type Category = string
type ListId = string
type EntryListResponseItem = {
  entries: {
    author?: string | null
    description?: string | null
    id: string
    publishedAt?: Date | string | null
    title?: string | null
    url?: string | null
  }
  feeds: {
    id: string
    title?: string | null
  }
}

interface EntryState {
  data: Record<EntryId, EntryModel>
  entryIdByView: Record<FeedViewType, Set<EntryId>>
  entryIdByCategory: Record<Category, Set<EntryId>>
  entryIdByFeed: Record<FeedId, Set<EntryId>>
  entryIdByInbox: Record<InboxId, Set<EntryId>>
  entryIdByList: Record<ListId, Set<EntryId>>
  entryIdSet: Set<EntryId>
}

const defaultState: EntryState = {
  data: {},
  entryIdByView: {
    [FeedViewType.All]: new Set(),
    [FeedViewType.Articles]: new Set(),
    [FeedViewType.Audios]: new Set(),
    [FeedViewType.Notifications]: new Set(),
    [FeedViewType.Pictures]: new Set(),
    [FeedViewType.SocialMedia]: new Set(),
    [FeedViewType.Videos]: new Set(),
  },
  entryIdByCategory: {},
  entryIdByFeed: {},
  entryIdByInbox: {},
  entryIdByList: {},
  entryIdSet: new Set(),
}

const LOCAL_READ_PROTECTION_WINDOW = 30 * 1000

const DEFAULT_LOCAL_TIMELINE_RANKING_PROMPT =
  "Prioritize entries that are useful, timely, information-dense, and likely worth reading first."

export const useEntryStore = createZustandStore<EntryState>("entry")(() => defaultState)

const get = useEntryStore.getState
const immerSet = createImmerSetter(useEntryStore)

class EntryActions implements Hydratable, Resetable {
  private localReadProtectionExpiresAt = new Map<EntryId, number>()
  private nextLocalReadProtectionCleanupAt = 0

  private protectLocalRead(entryId: EntryId) {
    const now = Date.now()
    this.pruneLocalReadProtection(now)
    this.localReadProtectionExpiresAt.set(entryId, now + LOCAL_READ_PROTECTION_WINDOW)
  }

  private clearLocalReadProtection(entryId: EntryId) {
    this.localReadProtectionExpiresAt.delete(entryId)
  }

  private isLocalReadProtected(entryId: EntryId) {
    const expiresAt = this.localReadProtectionExpiresAt.get(entryId)
    if (!expiresAt) return false

    if (expiresAt <= Date.now()) {
      this.localReadProtectionExpiresAt.delete(entryId)
      return false
    }

    return true
  }

  private pruneLocalReadProtection(now: number) {
    if (this.nextLocalReadProtectionCleanupAt > now) return

    for (const [entryId, expiresAt] of this.localReadProtectionExpiresAt.entries()) {
      if (expiresAt <= now) {
        this.localReadProtectionExpiresAt.delete(entryId)
      }
    }

    this.nextLocalReadProtectionCleanupAt = now + LOCAL_READ_PROTECTION_WINDOW
  }

  clearLocalReadProtectionInSession() {
    this.localReadProtectionExpiresAt.clear()
    this.nextLocalReadProtectionCleanupAt = 0
  }

  async hydrate() {
    const entries = await EntryService.getEntriesToHydrate()
    entryActions.upsertManyInSession(entries.map((e) => dbStoreMorph.toEntryModel(e)))
  }

  getFlattenMapEntries() {
    const state = get()
    return state.data
  }

  private addEntryIdToView({
    draft,
    feedId,
    entryId,
    sources,
    hidePrivateSubscriptionsInTimeline,
  }: {
    draft: EntryState
    feedId?: FeedId | null
    entryId: EntryId
    sources?: string[] | null
    hidePrivateSubscriptionsInTimeline?: boolean
  }) {
    if (!feedId) return

    const subscription = getSubscriptionById(feedId)
    const ignore =
      (hidePrivateSubscriptionsInTimeline && subscription?.isPrivate) ||
      subscription?.hideFromTimeline

    if (!ignore) {
      if (typeof subscription?.view === "number") {
        draft.entryIdByView[subscription.view]!.add(entryId)
      }
      draft.entryIdByView[FeedViewType.All]!.add(entryId)
    }

    // lists
    for (const s of sources ?? []) {
      const subscription = getSubscriptionById(s)
      const ignore =
        (hidePrivateSubscriptionsInTimeline && subscription?.isPrivate) ||
        subscription?.hideFromTimeline

      if (!ignore) {
        if (typeof subscription?.view === "number") {
          draft.entryIdByView[subscription.view]!.add(entryId)
        }
        draft.entryIdByView[FeedViewType.All]!.add(entryId)
      }
    }
  }

  private addEntryIdToCategory({
    draft,
    feedId,
    entryId,
  }: {
    draft: EntryState
    feedId?: FeedId | null
    entryId: EntryId
  }) {
    if (!feedId) return
    const subscription = getSubscriptionById(feedId)
    const category = subscription?.category || getDefaultCategory(subscription)
    if (!category) return
    const entryIdSetByCategory = draft.entryIdByCategory[category]
    if (!entryIdSetByCategory) {
      draft.entryIdByCategory[category] = new Set([entryId])
    } else {
      entryIdSetByCategory.add(entryId)
    }
  }

  private addEntryIdToFeed({
    draft,
    feedId,
    entryId,
  }: {
    draft: EntryState
    feedId?: FeedId | null
    entryId: EntryId
  }) {
    if (!feedId) return
    const entryIdSetByFeed = draft.entryIdByFeed[feedId]
    if (!entryIdSetByFeed) {
      draft.entryIdByFeed[feedId] = new Set([entryId])
    } else {
      entryIdSetByFeed.add(entryId)
    }
  }

  private addEntryIdToInbox({
    draft,
    inboxHandle,
    entryId,
  }: {
    draft: EntryState
    inboxHandle?: InboxId | null
    entryId: EntryId
  }) {
    if (!inboxHandle) return
    const entryIdSetByInbox = draft.entryIdByInbox[inboxHandle]
    if (!entryIdSetByInbox) {
      draft.entryIdByInbox[inboxHandle] = new Set([entryId])
    } else {
      entryIdSetByInbox.add(entryId)
    }
  }

  private addEntryIdToList({
    draft,
    listId,
    entryId,
  }: {
    draft: EntryState
    listId?: ListId | null
    entryId: EntryId
  }) {
    if (!listId) return
    const entryIdSetByList = draft.entryIdByList[listId]
    if (!entryIdSetByList) {
      draft.entryIdByList[listId] = new Set([entryId])
    } else {
      entryIdSetByList.add(entryId)
    }
  }

  upsertManyInSession(entries: EntryModel[], options?: FetchEntriesPropsSettings) {
    if (entries.length === 0) return
    const { unreadOnly, hidePrivateSubscriptionsInTimeline } = options || {}

    immerSet((draft) => {
      for (const entry of entries) {
        const nextEntry =
          !entry.read && this.isLocalReadProtected(entry.id) ? { ...entry, read: true } : entry

        draft.entryIdSet.add(nextEntry.id)
        draft.data[nextEntry.id] = nextEntry

        const { feedId, inboxHandle, read, sources } = nextEntry
        if (unreadOnly && read) continue

        if (inboxHandle) {
          this.addEntryIdToInbox({
            draft,
            inboxHandle,
            entryId: nextEntry.id,
          })
        } else {
          this.addEntryIdToFeed({
            draft,
            feedId,
            entryId: nextEntry.id,
          })
        }

        this.addEntryIdToView({
          draft,
          feedId,
          entryId: nextEntry.id,
          sources,
          hidePrivateSubscriptionsInTimeline,
        })

        this.addEntryIdToCategory({
          draft,
          feedId,
          entryId: nextEntry.id,
        })

        nextEntry.sources
          ?.filter((s) => !!s && s !== "feed")
          .forEach((s) => {
            this.addEntryIdToList({
              draft,
              listId: s,
              entryId: nextEntry.id,
            })
          })
      }
    })
  }

  async upsertMany(entries: EntryModel[]) {
    const tx = createTransaction()
    tx.store(() => {
      this.upsertManyInSession(entries)
    })

    tx.persist(() => {
      return EntryService.upsertMany(entries.map((e) => storeDbMorph.toEntrySchema(e)))
    })

    await tx.run()
  }

  updateEntryContentInSession({
    entryId,
    content,
    readabilityContent,
    readabilityUpdatedAt,
  }: {
    entryId: EntryId
    content?: string
    readabilityContent?: string
    readabilityUpdatedAt?: Date
  }) {
    immerSet((draft) => {
      const entry = draft.data[entryId]
      if (!entry) return
      if (content) {
        entry.content = content
      }
      if (readabilityContent) {
        entry.readabilityContent = readabilityContent
        entry.readabilityUpdatedAt = readabilityUpdatedAt
      }
    })
  }

  async updateEntryContent({
    entryId,
    content,
    readabilityContent,
    readabilityUpdatedAt = new Date(),
  }: {
    entryId: EntryId
    content?: string
    readabilityContent?: string
    readabilityUpdatedAt?: Date
  }) {
    const tx = createTransaction()
    tx.store(() => {
      this.updateEntryContentInSession({
        entryId,
        content,
        readabilityContent,
        readabilityUpdatedAt,
      })
    })

    tx.persist(() => {
      if (content) {
        EntryService.patch({ id: entryId, content })
      }

      if (readabilityContent) {
        EntryService.patch({ id: entryId, readabilityContent, readabilityUpdatedAt })
      }
    })

    await tx.run()
  }

  markEntryReadStatusInSession({
    entryIds,
    ids,
    read,
    time,
  }: {
    entryIds?: EntryId[]
    ids?: FeedIdOrInboxHandle[]
    read: boolean
    time?: PublishAtTimeRangeFilter | InsertedBeforeTimeRangeFilter
  }) {
    const affectedEntryIds = new Set<EntryId>()

    immerSet((draft) => {
      if (entryIds) {
        for (const entryId of entryIds) {
          const entry = draft.data[entryId]
          if (!entry) {
            continue
          }

          if (
            time &&
            "startTime" in time &&
            (+new Date(entry.publishedAt) < time.startTime ||
              +new Date(entry.publishedAt) > time.endTime)
          ) {
            continue
          }
          if (
            time &&
            "insertedBefore" in time &&
            +new Date(entry.insertedAt) >= time.insertedBefore
          ) {
            continue
          }

          if (read) {
            this.protectLocalRead(entryId)
          } else {
            this.clearLocalReadProtection(entryId)
          }

          if (entry.read !== read) {
            entry.read = read
            affectedEntryIds.add(entryId)
          }
        }
      }

      if (ids) {
        const entries = Array.from(draft.entryIdSet)
          .map((id) => draft.data[id])
          .filter((entry): entry is EntryModel => {
            if (!entry) return false
            const id = entry.inboxHandle || entry.feedId || ""
            if (!id) return false
            return ids.includes(id)
          })

        for (const entry of entries) {
          if (
            time &&
            "startTime" in time &&
            (+new Date(entry.publishedAt) < time.startTime ||
              +new Date(entry.publishedAt) > time.endTime)
          ) {
            continue
          }
          if (
            time &&
            "insertedBefore" in time &&
            +new Date(entry.insertedAt) >= time.insertedBefore
          ) {
            continue
          }

          if (read) {
            this.protectLocalRead(entry.id)
          } else {
            this.clearLocalReadProtection(entry.id)
          }

          if (entry.read !== read) {
            entry.read = read
            affectedEntryIds.add(entry.id)
          }
        }
      }
    })

    return Array.from(affectedEntryIds)
  }

  resetByView({ view, entries }: { view?: FeedViewType; entries: EntryModel[] }) {
    if (view === undefined) return
    immerSet((draft) => {
      draft.entryIdByView[view] = new Set(entries.map((e) => e.id))
    })
  }

  resetByCategory({ category, entries }: { category?: Category; entries: EntryModel[] }) {
    if (!category) return
    immerSet((draft) => {
      draft.entryIdByCategory[category] = new Set(entries.map((e) => e.id))
    })
  }

  resetByFeed({ feedId, entries }: { feedId?: FeedId; entries: EntryModel[] }) {
    if (!feedId) return
    immerSet((draft) => {
      draft.entryIdByFeed[feedId] = new Set(entries.map((e) => e.id))
    })
  }

  resetByInbox({ inboxId, entries }: { inboxId?: InboxId; entries: EntryModel[] }) {
    if (!inboxId) return
    immerSet((draft) => {
      draft.entryIdByInbox[inboxId] = new Set(entries.map((e) => e.id))
    })
  }

  resetByList({ listId, entries }: { listId?: ListId; entries: EntryModel[] }) {
    if (!listId) return
    immerSet((draft) => {
      draft.entryIdByList[listId] = new Set(entries.map((e) => e.id))
    })
  }

  deleteInboxEntryById(entryId: EntryId) {
    const entry = get().data[entryId]
    if (!entry || !entry.inboxHandle) return

    immerSet((draft) => {
      delete draft.data[entryId]
      draft.entryIdSet.delete(entryId)
      draft.entryIdByInbox[entry.inboxHandle!]?.delete(entryId)
      draft.entryIdByView[FeedViewType.All]!.delete(entryId)
    })
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      this.clearLocalReadProtectionInSession()
      immerSet(() => defaultState)
    })

    tx.persist(() => {
      return EntryService.reset()
    })

    await tx.run()
  }
}

const rankTimelineEntriesWithLocalAI = async <T extends EntryListResponseItem>({
  data,
  localAIBridge,
  prompt,
}: {
  data: T[]
  localAIBridge: LocalAIBridge
  prompt?: string
}): Promise<T[]> => {
  if (data.length <= 1) return data

  try {
    const rankingPrompt = createLocalTimelineRankingPrompt(prompt, data)
    const result = await localAIBridge.runTask({
      context: {
        entries: data.map(toTimelineRankingEntry),
        prompt: prompt?.trim() || DEFAULT_LOCAL_TIMELINE_RANKING_PROMPT,
      },
      feature: "timelineRanking",
      prompt: rankingPrompt,
    })
    const rankedIds = parseTimelineRankingIds(
      result.output,
      new Set(data.map((item) => item.entries.id)),
    )
    if (rankedIds.length === 0) return data

    return reorderEntryResponseItems(data, rankedIds)
  } catch (error) {
    console.error("Local timeline ranking failed:", error)
    return data
  }
}

const createLocalTimelineRankingPrompt = (
  userPrompt: string | undefined,
  data: EntryListResponseItem[],
): string => {
  const preference = userPrompt?.trim() || DEFAULT_LOCAL_TIMELINE_RANKING_PROMPT
  return [
    "Rank these RSS timeline entries for the current reader.",
    "Return only a JSON array of entry ids in the preferred reading order.",
    "Do not include markdown, explanations, scores, or ids that are not present.",
    `Reader preference: ${preference}`,
    `Entries: ${JSON.stringify(data.map(toTimelineRankingEntry))}`,
  ].join("\n\n")
}

const toTimelineRankingEntry = (item: EntryListResponseItem) => ({
  author: item.entries.author ?? null,
  description: item.entries.description ?? null,
  feedId: item.feeds.id,
  feedTitle: item.feeds.title ?? null,
  id: item.entries.id,
  publishedAt:
    item.entries.publishedAt instanceof Date
      ? item.entries.publishedAt.toISOString()
      : (item.entries.publishedAt ?? null),
  title: item.entries.title ?? null,
  url: item.entries.url ?? null,
})

const parseTimelineRankingIds = (output: string, validIds: Set<string>): string[] => {
  const parsed = parseTimelineRankingOutput(output)
  const ids = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.ids)
      ? parsed.ids
      : isRecord(parsed) && Array.isArray(parsed.rankedIds)
        ? parsed.rankedIds
        : []

  const seen = new Set<string>()
  return ids.filter((id): id is string => {
    if (typeof id !== "string") return false
    if (!validIds.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const parseTimelineRankingOutput = (output: string): unknown => {
  const trimmed = output.trim()
  const startIndex = Math.min(
    ...[trimmed.indexOf("["), trimmed.indexOf("{")].filter((index) => index >= 0),
  )
  if (!Number.isFinite(startIndex)) return []

  const opener = trimmed[startIndex]
  const closer = opener === "[" ? "]" : "}"
  const endIndex = trimmed.lastIndexOf(closer)
  if (endIndex <= startIndex) return []

  try {
    return JSON.parse(trimmed.slice(startIndex, endIndex + 1))
  } catch {
    return []
  }
}

const reorderEntryResponseItems = <T extends EntryListResponseItem>(
  data: T[],
  rankedIds: string[],
): T[] => {
  const itemById = new Map(data.map((item) => [item.entries.id, item]))
  const rankedItems = rankedIds.flatMap((id) => {
    const item = itemById.get(id)
    return item ? [item] : []
  })
  const rankedIdSet = new Set(rankedIds)
  return [...rankedItems, ...data.filter((item) => !rankedIdSet.has(item.entries.id))]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

class EntrySyncServices {
  async fetchEntries(props: FetchEntriesProps) {
    const {
      feedId,
      inboxId,
      listId,
      view,
      read,
      limit,
      pageParam,
      isCollection,
      feedIdList,
      excludePrivate,
      aiSort,
      aiTimelinePrompt,
    } = props
    const params = getEntriesParams({
      feedId,
      inboxId,
      listId,
      view,
      feedIdList,
    })

    const localAIBridge = aiSort ? localAI() : undefined
    const shouldRankWithLocalAI =
      aiSort === true && localAIBridge?.isFeatureEnabled("timelineRanking") === true
    const shouldRankWithCloudAI = aiSort === true && !shouldRankWithLocalAI

    const rankWithLocalAI = async <T extends EntryListResponseItem>(
      data: T[],
      bridge: LocalAIBridge,
    ) =>
      rankTimelineEntriesWithLocalAI({
        data,
        localAIBridge: bridge,
        prompt: aiTimelinePrompt,
      })

    const resolvedInboxId = params.inboxId
    const res = resolvedInboxId
      ? await (async () => {
          const inboxRes = await api().entries.inbox.list({
            publishedAfter: pageParam,
            read,
            limit,
            isCollection,
            ...(shouldRankWithCloudAI && { aiSort }),
            ...params,
            inboxId: resolvedInboxId,
          })

          return shouldRankWithLocalAI && localAIBridge && Array.isArray(inboxRes.data)
            ? {
                ...inboxRes,
                data: await rankWithLocalAI(inboxRes.data, localAIBridge),
              }
            : inboxRes
        })()
      : await (async () => {
          const listRes = await api().entries.list(
            {
              publishedAfter: pageParam,
              read,
              limit,
              isCollection,
              excludePrivate,
              ...(shouldRankWithCloudAI && { aiSort }),
              ...params,
            },
            shouldRankWithCloudAI
              ? {
                  timeout: 3 * 60 * 1000,
                }
              : undefined,
          )

          return shouldRankWithLocalAI && localAIBridge && Array.isArray(listRes.data)
            ? {
                ...listRes,
                data: await rankWithLocalAI(listRes.data, localAIBridge),
              }
            : listRes
        })()

    // Mark feed unread dirty, so re-fetch the unread data when view feed unread entires in the next time
    if (read === false) {
      if (typeof params.view === "number" && !params.feedId) {
        clearAllFeedUnreadDirty()
      }
      if (params.feedId) {
        clearFeedUnreadDirty(params.feedId as string)
      }
      if (params.feedIdList) {
        params.feedIdList.forEach((feedId) => {
          clearFeedUnreadDirty(feedId)
        })
      }
    }

    const entries = apiMorph.toEntryList(res.data)
    const entriesInDB = await EntryService.getEntryMany(entries.map((e) => e.id))
    for (const entry of entries) {
      const entryInDB = entriesInDB.find((e) => e.id === entry.id)
      if (entryInDB) {
        entry.content = entryInDB.content
        entry.readabilityContent = entryInDB.readabilityContent
        entry.readabilityUpdatedAt = entryInDB.readabilityUpdatedAt
      }
    }

    await entryActions.upsertMany(entries)

    if (typeof view === "number") {
      const { collections, entryIdsNotInCollections } = apiMorph.toCollections(res.data, view)
      const effectiveLimit = limit !== undefined ? Math.min(limit, 100) : 20
      const shouldResetCollection =
        params.isCollection && !pageParam && entries.length < effectiveLimit
      await collectionActions.upsertMany(collections, {
        // A full reset is only safe once the first page proves there are no more collection rows.
        reset: shouldResetCollection,
      })
      await collectionActions.delete(entryIdsNotInCollections)
    }

    const dataFeeds = res.data?.map((e) => e.feeds).filter((f) => f.type === "feed")
    const feeds = dataFeeds?.map((f) => apiMorph.toFeed(f)) ?? []
    feedActions.upsertMany(feeds)

    return res
  }

  async fetchEntryDetail(entryId: EntryId | undefined, isInbox?: boolean) {
    if (!isBizId(entryId)) return null

    const currentEntry = getEntry(entryId)
    const res =
      currentEntry?.inboxHandle || isInbox
        ? await api().entries.inbox.get({ id: entryId })
        : await api().entries.get({ id: entryId })
    const entry = apiMorph.toEntry(res.data)
    if (!currentEntry && entry) {
      await entryActions.upsertMany([entry])
    } else {
      if (entry?.content && currentEntry?.content !== entry.content) {
        await entryActions.updateEntryContent({ entryId, content: entry.content })
      }
      if (
        entry?.readabilityContent &&
        currentEntry?.readabilityContent !== entry.readabilityContent
      ) {
        await entryActions.updateEntryContent({
          entryId,
          readabilityContent: entry.readabilityContent,
        })
      }
    }
    return entry
  }

  async fetchEntryReadabilityContent(
    entryId: EntryId,
    fallBack?: () => Promise<string | null | undefined>,
  ) {
    const entry = getEntry(entryId)
    if (!entry?.url) return entry
    if (
      entry.readabilityContent &&
      entry.readabilityUpdatedAt &&
      entry.readabilityUpdatedAt.getTime() > Date.now() - 1000 * 60 * 60 * 24 * 3
    ) {
      return entry
    }

    let readabilityContent: string | null | undefined

    try {
      const { data: contentByFetch } = await api().entries.readability({
        id: entryId,
      })
      readabilityContent = contentByFetch?.content || null
    } catch (error) {
      if (fallBack) {
        readabilityContent = await fallBack()
      } else {
        throw error
      }
    }
    if (readabilityContent) {
      await entryActions.updateEntryContent({
        entryId,
        readabilityContent,
      })
    }
    return entry
  }

  async fetchEntryContentByStream(remoteEntryIds?: string[]) {
    if (!remoteEntryIds || remoteEntryIds.length === 0) return

    const onlyNoStored = true

    const nextIds = [] as string[]
    if (onlyNoStored) {
      for (const id of remoteEntryIds) {
        const entry = getEntry(id)!
        if (entry.content) {
          continue
        }

        nextIds.push(id)
      }
    }

    if (nextIds.length === 0) return

    const readStream = async () => {
      const response = await api().entries.stream({
        ids: nextIds.slice(0, 30),
      })

      if (!response.ok) {
        console.error("Failed to fetch stream:", response.statusText, await response.text())
        return
      }

      await readNdjsonStream<{ id: string; content: string }>(response, async (json) => {
        await entryActions.updateEntryContent({ entryId: json.id, content: json.content })
      })
    }

    readStream()
  }

  async fetchEntryReadHistory(entryId: EntryId, size: number) {
    const res = await api().entries.readHistories({
      id: entryId,
      size,
    })

    await userActions.upsertMany(Object.values(res.data.users))

    return res.data
  }

  async deleteInboxEntry(entryId: string) {
    const entry = get().data[entryId]
    if (!entry || !entry.inboxHandle) return
    const tx = createTransaction()
    const currentEntry = cloneDeep(entry)

    tx.store(() => {
      entryActions.deleteInboxEntryById(entryId)
    })
    tx.request(async () => {
      await api().entries.inbox.delete({ entryId })
    })
    tx.rollback(() => {
      entryActions.upsertManyInSession([currentEntry])
    })
    tx.persist(() => {
      return EntryService.deleteMany([entryId])
    })
    await tx.run()
  }
}

export const entrySyncServices = new EntrySyncServices()
export const entryActions = new EntryActions()
export const debouncedFetchEntryContentByStream = debounce(
  entrySyncServices.fetchEntryContentByStream,
  1000,
)
