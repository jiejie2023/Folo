import { beforeEach, describe, expect, it, vi } from "vitest"

import { clearLocalAIUsage, listLocalAIUsage, recordLocalAIUsage } from "./usage-store"

const mocks = vi.hoisted(() => {
  const state = new Map<string, unknown>()

  return {
    state,
    storeGet: vi.fn((key: string) => state.get(key)),
    storeSet: vi.fn((key: string, value: unknown) => {
      state.set(key, value)
    }),
  }
})

vi.mock("~/lib/store", () => ({
  store: {
    get: mocks.storeGet,
    set: mocks.storeSet,
  },
}))

describe("local AI usage store", () => {
  beforeEach(() => {
    mocks.state.clear()
    vi.clearAllMocks()
  })

  it("records usage and lists newest records first", () => {
    const first = recordLocalAIUsage({
      errorMessage: null,
      feature: "summary",
      model: "gpt-4o-mini",
      ok: true,
      profileId: "profile-1",
      totalTokens: 10,
    })
    const second = recordLocalAIUsage({
      errorMessage: "timeout",
      feature: "translation",
      model: "gpt-4o-mini",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })

    expect(listLocalAIUsage()).toEqual([second, first])
    expect(first.id).toEqual(expect.any(String))
    expect(first.createdAt).toEqual(expect.any(String))
  })

  it("returns cloned records so caller mutations do not change history", () => {
    const recorded = recordLocalAIUsage({
      errorMessage: null,
      feature: "summary",
      model: "gpt-4o-mini",
      ok: true,
      profileId: "profile-1",
      totalTokens: 10,
    })

    recorded.feature = "mutated-return"
    const listed = listLocalAIUsage()
    listed[0]!.feature = "mutated-list"

    expect(listLocalAIUsage()[0]).toEqual(
      expect.objectContaining({
        feature: "summary",
        model: "gpt-4o-mini",
        totalTokens: 10,
      }),
    )
  })

  it("clears recorded usage", () => {
    recordLocalAIUsage({
      errorMessage: null,
      feature: "summary",
      model: "gpt-4o-mini",
      ok: true,
      profileId: "profile-1",
      totalTokens: 10,
    })

    clearLocalAIUsage()

    expect(listLocalAIUsage()).toEqual([])
    expect(mocks.state.get("localAIUsageRecords")).toEqual([])
  })

  it("truncates stored usage records to the cap", () => {
    for (let index = 0; index < 501; index++) {
      recordLocalAIUsage({
        errorMessage: null,
        feature: `feature-${index}`,
        model: "gpt-4o-mini",
        ok: true,
        profileId: "profile-1",
        totalTokens: index,
      })
    }

    const records = listLocalAIUsage()

    expect(records).toHaveLength(500)
    expect(records[0]?.feature).toBe("feature-500")
    expect(records.at(-1)?.feature).toBe("feature-1")
  })
})
