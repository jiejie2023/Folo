import { describe, expect, it } from "vitest"

import { canUseTimelineAI } from "./timeline-ai-availability"

describe("canUseTimelineAI", () => {
  it("allows timeline AI when cloud AI is enabled", () => {
    expect(canUseTimelineAI({ aiEnabled: true, localProfileId: null })).toBe(true)
  })

  it("allows timeline AI when the feature is routed to local AI", () => {
    expect(canUseTimelineAI({ aiEnabled: false, localProfileId: "profile-1" })).toBe(true)
  })

  it("keeps timeline AI unavailable when neither cloud nor local AI is available", () => {
    expect(canUseTimelineAI({ aiEnabled: false, localProfileId: null })).toBe(false)
  })
})
