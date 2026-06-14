import { describe, expect, it, vi } from "vitest"

import { localAI, localAIContext } from "../../context"
import type { LocalAIBridge } from "./types"

describe("local AI context", () => {
  it("returns undefined before desktop provides a bridge", () => {
    localAIContext.provide()
    expect(localAI()).toBeUndefined()
  })

  it("returns the provided bridge", async () => {
    const bridge: LocalAIBridge = {
      isFeatureEnabled: vi.fn(() => true),
      summarizeEntry: vi.fn(async () => "summary"),
      translateEntries: vi.fn(async () => ({})),
    }

    localAIContext.provide(bridge)

    expect(localAI()?.isFeatureEnabled("summary")).toBe(true)
    await expect(
      localAI()?.summarizeEntry({
        entryId: "entry-1",
        title: "Title",
        content: "Body",
        target: "content",
        language: "en",
      }),
    ).resolves.toBe("summary")
  })
})
