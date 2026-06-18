import type { FeedSchema } from "@follow/database/schemas/types"

export const RECOVERED_LOCAL_SUBSCRIPTION_CATEGORY = "Recovered"

const CATEGORY_RULES = [
  {
    category: "Podcasts",
    patterns: [/podcast/, /ted talks daily/, /simplecast/, /mp3/],
  },
  {
    category: "AI",
    patterns: [
      /openai/,
      /anthropic/,
      /nvidia/,
      /last week in ai/,
      /ahead of ai/,
      /artificial intelligence/,
      /\bai\b/,
      /llm/,
      /gemini/,
      /deepseek/,
      /karpathy/,
      /sam altman/,
      /归藏/,
      /橘鸦/,
      /人工智能/,
    ],
  },
  {
    category: "Developer",
    patterns: [
      /github/,
      /developer/,
      /linux\.do/,
      /linux do/,
      /selfh\.st/,
      /self-host/,
      /y combinator/,
      /hacker news/,
      /indie/,
      /ezindie/,
      /programming/,
      /node-rss/,
    ],
  },
  {
    category: "Science",
    patterns: [/nasa/, /astronomy/, /apod/, /3blue1brown/, /science/, /physics/, /math/],
  },
  {
    category: "Games",
    patterns: [/game/, /games/, /playstation/, /xbox/, /nintendo/, /steam/, /ign/],
  },
  {
    category: "Social",
    patterns: [/telegram/, /twitter/, /\bx\.com\b/, /pavel durov/, /elon musk/],
  },
  {
    category: "Books",
    patterns: [/bookfere/, /book/, /books/, /每周一书/, /书伴/],
  },
  {
    category: "News",
    patterns: [/wechat/, /微信/, /热文/, /the verge/, /vox/, /economist/, /经济学人/, /huxiu/],
  },
] as const

export const inferRecoveredSubscriptionCategory = (feed: FeedSchema) => {
  const haystack = [feed.title, feed.url, feed.siteUrl, feed.description]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase()

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return rule.category
    }
  }

  return "News"
}
