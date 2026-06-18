import { describe, expect, test } from "vitest"

import { getFeedCategoryOpenState } from "./FeedCategory.utils"

describe("getFeedCategoryOpenState", () => {
  test("opens categories by default when no state was saved", () => {
    expect(
      getFeedCategoryOpenState({
        categoryOpenStateData: {},
        folderName: "AI",
        isCategory: true,
      }),
    ).toBe(true)
  })

  test("keeps an explicitly collapsed category closed", () => {
    expect(
      getFeedCategoryOpenState({
        categoryOpenStateData: { AI: false },
        folderName: "AI",
        isCategory: true,
      }),
    ).toBe(false)
  })

  test("always opens single feed rows", () => {
    expect(
      getFeedCategoryOpenState({
        categoryOpenStateData: {},
        folderName: undefined,
        isCategory: false,
      }),
    ).toBe(true)
  })
})
