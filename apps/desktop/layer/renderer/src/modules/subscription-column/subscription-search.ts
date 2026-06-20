import type { FeedModel } from "@follow/store/feed/types"
import type { SubscriptionModel } from "@follow/store/subscription/types"

type SearchableFeed = Pick<FeedModel, "id" | "title" | "url" | "siteUrl">
type SearchableSubscription = Pick<SubscriptionModel, "feedId" | "title" | "category">

export const normalizeSubscriptionSearchQuery = (query: string) => query.trim().toLocaleLowerCase()

const includesQuery = (value: Nullable<string>, query: string) =>
  typeof value === "string" && value.toLocaleLowerCase().includes(query)

export const doesSubscriptionMatchSearch = ({
  feed,
  subscription,
  category,
  query,
}: {
  feed?: SearchableFeed
  subscription?: SearchableSubscription
  category?: string
  query: string
}) => {
  const normalizedQuery = normalizeSubscriptionSearchQuery(query)
  if (!normalizedQuery) return true

  return [
    subscription?.title,
    subscription?.category,
    subscription?.feedId,
    feed?.title,
    feed?.url,
    feed?.siteUrl,
    feed?.id,
    category,
  ].some((value) => includesQuery(value, normalizedQuery))
}

export const filterGroupedSubscriptionsBySearch = ({
  grouped,
  feeds,
  subscriptions,
  query,
}: {
  grouped: Record<string, string[]>
  feeds: Record<string, FeedModel | undefined>
  subscriptions: Record<string, SubscriptionModel | undefined>
  query: string
}) => {
  const normalizedQuery = normalizeSubscriptionSearchQuery(query)
  if (!normalizedQuery) return grouped

  const nextGrouped = {} as Record<string, string[]>

  for (const [category, ids] of Object.entries(grouped)) {
    const categoryMatched = includesQuery(category, normalizedQuery)
    const matchedIds = ids.filter((id) => {
      if (categoryMatched) return true

      return doesSubscriptionMatchSearch({
        feed: feeds[id],
        subscription: subscriptions[id],
        category,
        query: normalizedQuery,
      })
    })

    if (matchedIds.length > 0) {
      nextGrouped[category] = matchedIds
    }
  }

  return nextGrouped
}
