import type { FeedSchema } from "@follow/database/schemas/types"
import { describe, expect, test } from "vitest"

import { inferRecoveredSubscriptionCategory } from "./recovery-category"

const feed = (feed: Partial<FeedSchema> & Pick<FeedSchema, "id" | "url">): FeedSchema => feed

describe("inferRecoveredSubscriptionCategory", () => {
  test.each([
    [feed({ id: "openai", title: "OpenAI News", url: "https://openai.com/news/rss.xml" }), "AI"],
    [
      feed({
        id: "anthropic",
        title: "Anthropic Research",
        url: "rsshub://anthropic/research",
      }),
      "AI",
    ],
    [
      feed({
        id: "github",
        title: "GitHub Blog",
        url: "https://github.blog/feed/",
      }),
      "Developer",
    ],
    [
      feed({
        id: "linux-do",
        title: "福利羊毛 - LINUX DO",
        url: "https://linux.do/c/welfare/36.rss",
      }),
      "Developer",
    ],
    [
      feed({
        id: "wechat",
        title: "微信 · 24h热文榜",
        url: "rsshub://tophub/WnBeO1o371",
      }),
      "News",
    ],
    [
      feed({
        id: "science",
        title: "NASA Astronomy Picture of the Day",
        url: "rsshub://nasa/apod",
      }),
      "Science",
    ],
    [
      feed({
        id: "podcast",
        title: "TED Talks Daily",
        url: "https://feeds.simplecast.com/ted-talks-daily",
      }),
      "Podcasts",
    ],
    [
      feed({
        id: "games",
        title: "PlayStation Blog",
        url: "https://blog.playstation.com/feed/",
      }),
      "Games",
    ],
    [
      feed({
        id: "social",
        title: "Pavel Durov - Telegram Channel",
        url: "rsshub://telegram/channel/durov",
      }),
      "Social",
    ],
    [
      feed({
        id: "books",
        title: "每周一书 - 书伴",
        url: "rsshub://bookfere/weekly",
      }),
      "Books",
    ],
  ])("classifies %s as %s", (input, expected) => {
    expect(inferRecoveredSubscriptionCategory(input)).toBe(expected)
  })
})
