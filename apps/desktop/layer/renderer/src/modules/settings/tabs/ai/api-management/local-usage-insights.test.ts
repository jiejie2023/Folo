import { describe, expect, it } from "vitest"

import type { DesktopLocalAIUsageRecord } from "~/modules/local-ai/hooks"

import { buildLocalUsageInsights } from "./local-usage-insights"

const record = (
  input: Partial<DesktopLocalAIUsageRecord> & Pick<DesktopLocalAIUsageRecord, "createdAt" | "id">,
): DesktopLocalAIUsageRecord => ({
  errorMessage: null,
  feature: "chat",
  model: "deepseek-v4-flash",
  ok: true,
  profileId: "profile-1",
  totalTokens: 0,
  ...input,
})

describe("buildLocalUsageInsights", () => {
  it("summarizes local usage and builds a year of activity cells", () => {
    const insights = buildLocalUsageInsights(
      [
        record({ createdAt: "2026-06-15T13:30:00.000Z", id: "1", totalTokens: 400 }),
        record({ createdAt: "2026-06-15T13:10:00.000Z", id: "2", totalTokens: 100 }),
        record({ createdAt: "2026-06-15T12:45:00.000Z", id: "3", ok: false }),
        record({ createdAt: "2026-06-14T10:00:00.000Z", id: "4", totalTokens: 900 }),
        record({ createdAt: "2026-06-01T10:00:00.000Z", id: "5", totalTokens: 700 }),
      ],
      new Date("2026-06-15T13:59:00.000Z"),
    )

    expect(insights.summary.totalTokens).toBe(2100)
    expect(insights.summary.peakDailyTokens).toBe(900)
    expect(insights.summary.totalRequests).toBe(5)
    expect(insights.summary.currentStreakDays).toBe(2)
    expect(insights.summary.longestStreakDays).toBe(2)
    expect(insights.recentRecords).toHaveLength(5)
    expect(insights.activityDays).toHaveLength(365)
    expect(insights.maxDailyTokens).toBe(900)
    expect(insights.activityDays.at(-1)).toMatchObject({
      failureCount: 1,
      requestCount: 3,
      totalTokens: 500,
    })
    expect(insights.activityDays.at(-2)).toMatchObject({
      failureCount: 0,
      requestCount: 1,
      totalTokens: 900,
    })
    expect(insights.monthLabels.at(-1)).toMatchObject({ month: 6 })
  })

  it("keeps failed-only days visible without token intensity", () => {
    const insights = buildLocalUsageInsights(
      [record({ createdAt: "2026-06-15T13:10:00.000Z", id: "1", ok: false })],
      new Date("2026-06-15T13:59:00.000Z"),
    )

    expect(insights.summary.totalTokens).toBe(0)
    expect(insights.summary.totalRequests).toBe(1)
    expect(insights.maxDailyTokens).toBe(0)
    expect(insights.activityDays.at(-1)).toMatchObject({
      failureCount: 1,
      level: 0,
      requestCount: 1,
      totalTokens: 0,
    })
  })
})
