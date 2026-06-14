import type { LocalAISettings } from "@follow/shared/settings/interface"
import { describe, expect, test } from "vitest"

import { resolveLocalAIProfileId } from "./hooks"

const createSettings = (overrides: Partial<LocalAISettings> = {}): LocalAISettings => ({
  allowFallbackToCloud: false,
  defaultProfileId: "profile-1",
  enabled: true,
  featureRouting: {
    chat: "cloud",
    mcp: "cloud",
    onboardingRecommendations: "cloud",
    summary: "local",
    tasks: "cloud",
    timelineRanking: "cloud",
    timelineSummary: "cloud",
    translation: "cloud",
    tts: "cloud",
  },
  ...overrides,
})

describe("resolveLocalAIProfileId", () => {
  test("returns the default profile id when local AI is enabled and the feature routes locally", () => {
    expect(resolveLocalAIProfileId(createSettings(), "summary")).toBe("profile-1")
  })

  test("returns null when local AI is disabled", () => {
    expect(resolveLocalAIProfileId(createSettings({ enabled: false }), "summary")).toBeNull()
  })

  test("returns null when the feature routes to cloud", () => {
    expect(resolveLocalAIProfileId(createSettings(), "chat")).toBeNull()
  })

  test("returns null when no default profile is selected", () => {
    expect(
      resolveLocalAIProfileId(createSettings({ defaultProfileId: null }), "summary"),
    ).toBeNull()
  })
})
