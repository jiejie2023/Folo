import type { LocalAISettings } from "@follow/shared/settings/interface"
import { describe, expect, test } from "vitest"

import {
  applySavedLocalAIProfileDefaults,
  assertLocalAIProfileEnabled,
  clearDeletedLocalAIDefaultProfile,
  resolveLocalAIMode,
  resolveLocalAIProfileApiKey,
  resolveLocalAIProfileId,
  resolveLocalAIProfileModel,
  resolveLocalAITaskModelPurpose,
} from "./hooks"

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
  test("treats cloud-managed features as cloud even when old settings route them locally", () => {
    const settings = createSettings({
      featureRouting: {
        ...createSettings().featureRouting,
        onboardingRecommendations: "local",
      },
    })

    expect(resolveLocalAIMode(settings, "onboardingRecommendations")).toBe("cloud")
    expect(resolveLocalAIProfileId(settings, "onboardingRecommendations")).toBeNull()
  })

  test("allows timeline ranking to route to local AI", () => {
    const settings = createSettings({
      featureRouting: {
        ...createSettings().featureRouting,
        timelineRanking: "local",
      },
    })

    expect(resolveLocalAIMode(settings, "timelineRanking")).toBe("local")
    expect(resolveLocalAIProfileId(settings, "timelineRanking")).toBe("profile-1")
  })

  test("allows scheduled tasks to route to local AI", () => {
    const settings = createSettings({
      featureRouting: {
        ...createSettings().featureRouting,
        tasks: "local",
      },
    })

    expect(resolveLocalAIMode(settings, "tasks")).toBe("local")
    expect(resolveLocalAIProfileId(settings, "tasks")).toBe("profile-1")
  })

  test("allows MCP to route to local AI", () => {
    const settings = createSettings({
      featureRouting: {
        ...createSettings().featureRouting,
        mcp: "local",
      },
    })

    expect(resolveLocalAIMode(settings, "mcp")).toBe("local")
    expect(resolveLocalAIProfileId(settings, "mcp")).toBe("profile-1")
  })

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

describe("resolveLocalAIProfileModel", () => {
  test("uses the purpose-specific model before chat and listed models", () => {
    expect(
      resolveLocalAIProfileModel(
        {
          defaultChatModel: "chat-model",
          defaultSummaryModel: "summary-model",
          defaultTaskModel: null,
          defaultTimelineModel: null,
          defaultTranslationModel: null,
          defaultTtsModel: null,
          models: ["listed-model"],
        },
        "summary",
      ),
    ).toBe("summary-model")
  })

  test("throws when no model is configured", () => {
    expect(() =>
      resolveLocalAIProfileModel(
        {
          defaultChatModel: null,
          defaultSummaryModel: null,
          defaultTaskModel: null,
          defaultTimelineModel: null,
          defaultTranslationModel: null,
          defaultTtsModel: null,
          models: [],
        },
        "translation",
      ),
    ).toThrow("No local AI model is configured for translation")
  })
})

describe("resolveLocalAITaskModelPurpose", () => {
  test.each(["timelineSummary", "timelineRanking"] as const)(
    "uses the timeline model for %s",
    (feature) => {
      expect(resolveLocalAITaskModelPurpose(feature)).toBe("timeline")
    },
  )

  test.each(["tasks", "onboardingRecommendations"] as const)(
    "uses the task model for %s",
    (feature) => {
      expect(resolveLocalAITaskModelPurpose(feature)).toBe("tasks")
    },
  )

  test("selects the configured timeline model for timeline tasks", () => {
    const purpose = resolveLocalAITaskModelPurpose("timelineSummary")
    expect(
      resolveLocalAIProfileModel(
        {
          defaultChatModel: "chat-model",
          defaultSummaryModel: null,
          defaultTaskModel: "task-model",
          defaultTimelineModel: "timeline-model",
          defaultTranslationModel: null,
          defaultTtsModel: null,
          models: [],
        },
        purpose,
      ),
    ).toBe("timeline-model")
  })
})

describe("assertLocalAIProfileEnabled", () => {
  test("rejects a disabled profile", () => {
    expect(() => assertLocalAIProfileEnabled({ enabled: false })).toThrow(
      "Local AI profile is disabled",
    )
  })

  test("allows an enabled profile", () => {
    expect(() => assertLocalAIProfileEnabled({ enabled: true })).not.toThrow()
  })
})

describe("clearDeletedLocalAIDefaultProfile", () => {
  test("clears the default and changes local routes to cloud", () => {
    const settings = createSettings({
      featureRouting: {
        ...createSettings().featureRouting,
        chat: "local",
        summary: "local",
      },
    })

    expect(clearDeletedLocalAIDefaultProfile(settings, "profile-1")).toEqual({
      ...settings,
      defaultProfileId: null,
      featureRouting: {
        ...settings.featureRouting,
        chat: "cloud",
        summary: "cloud",
      },
    })
  })

  test("returns unchanged settings when another profile is deleted", () => {
    const settings = createSettings()
    expect(clearDeletedLocalAIDefaultProfile(settings, "profile-2")).toBe(settings)
  })
})

describe("applySavedLocalAIProfileDefaults", () => {
  test("sets the saved profile as default and enables local AI when no default exists", () => {
    expect(
      applySavedLocalAIProfileDefaults(
        createSettings({
          defaultProfileId: null,
          enabled: false,
        }),
        "profile-1",
      ),
    ).toEqual(
      createSettings({
        defaultProfileId: "profile-1",
        enabled: true,
      }),
    )
  })

  test("does not replace an existing default profile", () => {
    const settings = createSettings({
      defaultProfileId: "profile-1",
      enabled: false,
    })

    expect(applySavedLocalAIProfileDefaults(settings, "profile-2")).toBe(settings)
  })
})

describe("resolveLocalAIProfileApiKey", () => {
  test("preserves an existing key when edit input is empty", () => {
    expect(resolveLocalAIProfileApiKey({ apiKey: "", isEditing: true, removeApiKey: false })).toBe(
      undefined,
    )
  })

  test("removes an existing key only when explicitly requested", () => {
    expect(resolveLocalAIProfileApiKey({ apiKey: "", isEditing: true, removeApiKey: true })).toBe(
      null,
    )
  })

  test("uses null for an empty key on a new profile", () => {
    expect(resolveLocalAIProfileApiKey({ apiKey: "", isEditing: false, removeApiKey: false })).toBe(
      null,
    )
  })
})
