import { describe, expect, it } from "vitest"

import { insertSyncedTimeline } from "./subscription-timeline"

describe("insertSyncedTimeline", () => {
  it("places synced immediately after all", () => {
    expect(insertSyncedTimeline(["all", "articles", "social-media"])).toEqual([
      "all",
      "synced",
      "articles",
      "social-media",
    ])
  })

  it("does not duplicate synced when the input already contains it", () => {
    expect(insertSyncedTimeline(["all", "synced", "articles"])).toEqual([
      "all",
      "synced",
      "articles",
    ])
  })
})
