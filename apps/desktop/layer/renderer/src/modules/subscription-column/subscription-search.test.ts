import type { FeedModel } from "@follow/store/feed/types"
import type { SubscriptionModel } from "@follow/store/subscription/types"
import { describe, expect, it } from "vitest"

import {
  doesSubscriptionMatchSearch,
  filterGroupedSubscriptionsBySearch,
} from "./subscription-search"

const createFeed = (feed: Partial<FeedModel> & Pick<FeedModel, "id" | "url">): FeedModel => ({
  title: null,
  description: null,
  image: null,
  errorAt: null,
  siteUrl: null,
  ownerUserId: null,
  errorMessage: null,
  subscriptionCount: null,
  updatesPerWeek: null,
  latestEntryPublishedAt: null,
  tipUserIds: null,
  updatedAt: null,
  type: "feed",
  ...feed,
})

const createSubscription = (
  subscription: Partial<SubscriptionModel> & Pick<SubscriptionModel, "feedId">,
): SubscriptionModel => ({
  listId: null,
  inboxId: null,
  userId: "me",
  view: 0,
  isPrivate: false,
  hideFromTimeline: null,
  title: null,
  category: null,
  createdAt: null,
  type: "feed",
  source: "local",
  synced: false,
  ...subscription,
})

describe("subscription search", () => {
  it("matches custom titles and feed urls", () => {
    const feed = createFeed({
      id: "feed-1",
      title: "The GitHub Blog",
      url: "https://github.blog/feed/",
    })
    const subscription = createSubscription({
      feedId: "feed-1",
      title: "GitHub Official",
    })

    expect(doesSubscriptionMatchSearch({ feed, subscription, query: "official" })).toBe(true)
    expect(doesSubscriptionMatchSearch({ feed, subscription, query: "github.blog" })).toBe(true)
    expect(doesSubscriptionMatchSearch({ feed, subscription, query: "openai" })).toBe(false)
  })

  it("keeps a whole category when the category name matches", () => {
    const feeds = {
      "feed-1": createFeed({ id: "feed-1", title: "OpenAI News", url: "https://openai.com/rss" }),
      "feed-2": createFeed({
        id: "feed-2",
        title: "Anthropic Research",
        url: "https://anthropic.com/rss",
      }),
      "feed-3": createFeed({ id: "feed-3", title: "The GitHub Blog", url: "https://github.blog" }),
    }
    const subscriptions = {
      "feed-1": createSubscription({ feedId: "feed-1", category: "01 AI" }),
      "feed-2": createSubscription({ feedId: "feed-2", category: "01 AI" }),
      "feed-3": createSubscription({ feedId: "feed-3", category: "02 Development" }),
    }

    expect(
      filterGroupedSubscriptionsBySearch({
        grouped: {
          "01 AI": ["feed-1", "feed-2"],
          "02 Development": ["feed-3"],
        },
        feeds,
        subscriptions,
        query: "ai",
      }),
    ).toEqual({
      "01 AI": ["feed-1", "feed-2"],
    })
  })
})
