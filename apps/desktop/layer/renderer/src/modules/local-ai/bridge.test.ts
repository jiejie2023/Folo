import { beforeEach, describe, expect, it, vi } from "vitest"

import { createDesktopLocalAIBridge } from "./bridge"
import type { DesktopLocalAIProfile, DesktopLocalAIStoredProfile } from "./hooks"

const mocks = vi.hoisted(() => ({
  completeText: vi.fn(),
  listProfiles: vi.fn(),
  testProfile: vi.fn(),
  upsertProfile: vi.fn(),
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: vi.fn(),
}))

vi.mock("./hooks", () => ({
  assertLocalAIProfileEnabled: vi.fn(),
  getLocalAIIPC: () => ({
    completeText: mocks.completeText,
    listProfiles: mocks.listProfiles,
    testProfile: mocks.testProfile,
    upsertProfile: mocks.upsertProfile,
  }),
  resolveLocalAIProfileId: vi.fn(),
  resolveLocalAIProfileModel: vi.fn(),
  resolveLocalAITaskModelPurpose: vi.fn(),
}))

const existingProfile: DesktopLocalAIProfile = {
  baseURL: "https://old.example.com/v1",
  createdAt: "2026-06-14T00:00:00.000Z",
  defaultChatModel: "chat-model",
  defaultSummaryModel: "summary-model",
  defaultTaskModel: "task-model",
  defaultTimelineModel: "timeline-model",
  defaultTranslationModel: "translation-model",
  defaultTtsModel: "tts-model",
  enabled: true,
  headers: { "X-Existing": "preserved" },
  id: "profile-1",
  lastTestedAt: "2026-06-14T01:00:00.000Z",
  lastTestResult: {
    message: "Found 2 models",
    ok: true,
    testedAt: "2026-06-14T01:00:00.000Z",
  },
  maskedApiKey: "sk-...safe",
  models: ["chat-model", "discovered-model"],
  name: "Existing profile",
  providerType: "openai-compatible",
  supportsJsonMode: false,
  supportsStreaming: false,
  supportsTools: true,
  supportsTts: true,
  updatedAt: "2026-06-14T01:00:00.000Z",
}

const storedProfile: DesktopLocalAIStoredProfile = {
  ...existingProfile,
}
delete (storedProfile as Partial<DesktopLocalAIProfile>).maskedApiKey

describe("createDesktopLocalAIBridge saveProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProfiles.mockResolvedValue([existingProfile])
    mocks.upsertProfile.mockResolvedValue(storedProfile)
  })

  it("preserves unexpressed models, capabilities, headers, and purpose defaults when editing", async () => {
    const bridge = createDesktopLocalAIBridge()

    await bridge.saveProfile({
      apiKey: undefined,
      baseURL: "https://new.example.com/v1",
      defaultModel: undefined,
      enabled: false,
      id: existingProfile.id,
      name: "Renamed profile",
    })

    expect(mocks.upsertProfile).toHaveBeenCalledWith({
      apiKey: undefined,
      baseURL: "https://new.example.com/v1",
      defaultChatModel: "chat-model",
      defaultSummaryModel: "summary-model",
      defaultTaskModel: "task-model",
      defaultTimelineModel: "timeline-model",
      defaultTranslationModel: "translation-model",
      defaultTtsModel: "tts-model",
      enabled: false,
      headers: { "X-Existing": "preserved" },
      id: existingProfile.id,
      models: ["chat-model", "discovered-model"],
      name: "Renamed profile",
      providerType: "openai-compatible",
      supportsJsonMode: false,
      supportsStreaming: false,
      supportsTools: true,
      supportsTts: true,
    })
  })

  it("clears only the chat default when defaultModel is null", async () => {
    const bridge = createDesktopLocalAIBridge()

    await bridge.saveProfile({
      baseURL: existingProfile.baseURL,
      defaultModel: null,
      enabled: existingProfile.enabled,
      id: existingProfile.id,
      name: existingProfile.name,
    })

    expect(mocks.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultChatModel: null,
        defaultSummaryModel: "summary-model",
        defaultTaskModel: "task-model",
        defaultTimelineModel: "timeline-model",
        defaultTranslationModel: "translation-model",
        defaultTtsModel: "tts-model",
        models: ["chat-model", "discovered-model"],
      }),
    )
  })

  it("adds a new non-empty chat default to the existing model list", async () => {
    const bridge = createDesktopLocalAIBridge()

    await bridge.saveProfile({
      baseURL: existingProfile.baseURL,
      defaultModel: "new-chat-model",
      enabled: existingProfile.enabled,
      id: existingProfile.id,
      name: existingProfile.name,
    })

    expect(mocks.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultChatModel: "new-chat-model",
        models: ["chat-model", "discovered-model", "new-chat-model"],
      }),
    )
  })
})

describe("createDesktopLocalAIBridge testProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.testProfile.mockResolvedValue({
      message: "Connection test succeeded with chat-model",
      model: "chat-model",
      models: ["chat-model"],
      ok: true,
      testedAt: "2026-06-14T01:00:00.000Z",
    })
  })

  it("delegates profile tests to the desktop IPC connection test", async () => {
    const bridge = createDesktopLocalAIBridge()

    await expect(
      bridge.testProfile({ model: "chat-model", profileId: "profile-1" }),
    ).resolves.toEqual(
      expect.objectContaining({
        model: "chat-model",
        ok: true,
      }),
    )

    expect(mocks.testProfile).toHaveBeenCalledWith("profile-1", "chat-model")
  })
})

describe("createDesktopLocalAIBridge translateEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProfiles.mockResolvedValue([existingProfile])
  })

  it("parses translation JSON wrapped in a fenced code block", async () => {
    mocks.completeText.mockResolvedValue({
      text: [
        "```json",
        JSON.stringify({
          "entry-1": {
            content: "正文",
            description: "描述",
            readabilityContent: null,
            title: "标题",
          },
        }),
        "```",
      ].join("\n"),
      totalTokens: 12,
    })
    const bridge = createDesktopLocalAIBridge()

    await expect(
      bridge.translateEntries({
        fields: "title,description,content",
        items: [
          {
            content: "Content",
            description: "Description",
            entryId: "entry-1",
            readabilityContent: null,
            title: "Title",
          },
        ],
        language: "zh-CN",
        mode: "translation-only",
        model: "translation-model",
        profileId: "profile-1",
      }),
    ).resolves.toEqual({
      "entry-1": {
        content: "正文",
        description: "描述",
        entryId: "entry-1",
        readabilityContent: null,
        title: "标题",
      },
    })
  })
})
