import { FollowAPIError } from "@follow-app/client-sdk"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { apiContext, localAIContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useEntryStore } from "../entry/store"
import type { EntryModel } from "../entry/types"
import type { LocalAIBridge } from "../local-ai/types"
import { SummaryGeneratingStatus } from "./enum"
import { summarySyncService, useSummaryStore } from "./store"
import { getGenerateSummaryStatusId } from "./utils"

const { insertSummaryMock } = vi.hoisted(() => ({
  insertSummaryMock: vi.fn(),
}))

vi.mock("@follow/database/services/summary", () => ({
  summaryService: {
    getAllSummaries: vi.fn(),
    insertSummary: insertSummaryMock,
    reset: vi.fn(),
  },
}))

const createEntry = (id: string): EntryModel => ({
  content: `${id} content`,
  description: `${id} description`,
  id,
  guid: `${id}-guid`,
  insertedAt: new Date("2026-01-01T00:00:00.000Z"),
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  readabilityContent: `${id} readability`,
  title: `${id} title`,
})

const createLocalAIBridge = (overrides: Partial<LocalAIBridge>): LocalAIBridge =>
  ({
    isFeatureEnabled: vi.fn(() => false),
    summarizeEntry: vi.fn(),
    ...overrides,
  }) as LocalAIBridge

describe("summarySyncService", () => {
  const entryId = "entry-1"
  const actionLanguage = "en"
  const target = "content"
  const summaryApiMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    useEntryStore.setState({
      data: {
        [entryId]: createEntry(entryId),
      },
    })
    useSummaryStore.setState({
      data: {},
      generatingStatus: {},
    })
    apiContext.provide({
      ai: {
        summary: summaryApiMock,
      },
    } as unknown as FollowAPI)
    localAIContext.provide()
  })

  test.each([
    { apiData: null, expected: null },
    { apiData: "", expected: null },
  ])(
    "treats empty API summary data as unavailable instead of payment failure",
    async ({ apiData, expected }) => {
      summaryApiMock.mockResolvedValue({ data: apiData })

      await expect(
        summarySyncService.generateSummary({
          entryId,
          target,
          actionLanguage,
        }),
      ).resolves.toBe(expected)

      expect(insertSummaryMock).not.toHaveBeenCalled()
      expect(
        useSummaryStore.getState().generatingStatus[
          getGenerateSummaryStatusId(entryId, actionLanguage, target)
        ],
      ).toBe(SummaryGeneratingStatus.Success)
    },
  )

  test("keeps real API payment errors for the upgrade prompt", async () => {
    const paymentError = new FollowAPIError("Payment required", 402)
    summaryApiMock.mockRejectedValue(paymentError)

    await expect(
      summarySyncService.generateSummary({
        entryId,
        target,
        actionLanguage,
      }),
    ).rejects.toBe(paymentError)

    expect(
      useSummaryStore.getState().generatingStatus[
        getGenerateSummaryStatusId(entryId, actionLanguage, target)
      ],
    ).toBe(SummaryGeneratingStatus.Error)
  })

  test("uses the local AI bridge when summary is routed locally", async () => {
    const summarizeEntry = vi.fn().mockResolvedValue({
      entryId,
      summary: "Local summary",
    })
    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "summary"),
        summarizeEntry,
      }),
    )

    await expect(
      summarySyncService.generateSummary({
        entryId,
        target,
        actionLanguage,
      }),
    ).resolves.toBe("Local summary")

    expect(summaryApiMock).not.toHaveBeenCalled()
    expect(summarizeEntry).toHaveBeenCalledWith({
      content: "entry-1 content",
      entryId,
      language: actionLanguage,
      target,
      title: "entry-1 title",
    })
    expect(insertSummaryMock).toHaveBeenCalledWith({
      entryId,
      language: actionLanguage,
      readabilitySummary: null,
      summary: "Local summary",
    })
  })
})
