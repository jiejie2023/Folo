import { beforeEach, describe, expect, it, vi } from "vitest"

import { createDesktopLocalAIBridge } from "./bridge"
import type { DesktopLocalAIProfile, DesktopLocalAIStoredProfile } from "./hooks"

const mocks = vi.hoisted(() => ({
  callMCPTool: vi.fn(),
  completeText: vi.fn(),
  listMCPTools: vi.fn(),
  listProfiles: vi.fn(),
  startChatStream: vi.fn(),
  stopChatStream: vi.fn(),
  testProfile: vi.fn(),
  upsertProfile: vi.fn(),
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: vi.fn(),
}))

vi.mock("./hooks", () => ({
  assertLocalAIProfileEnabled: vi.fn(),
  getLocalAIIPC: () => ({
    callMCPTool: mocks.callMCPTool,
    completeText: mocks.completeText,
    listProfiles: mocks.listProfiles,
    listMCPTools: mocks.listMCPTools,
    startChatStream: mocks.startChatStream,
    stopChatStream: mocks.stopChatStream,
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

const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()

const installElectronListeners = () => {
  listeners.clear()
  window.electron = {
    ipcRenderer: {
      on: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
        const channelListeners = listeners.get(channel) ?? new Set()
        channelListeners.add(listener)
        listeners.set(channel, channelListeners)
        return () => {
          channelListeners.delete(listener)
        }
      }),
    },
  } as unknown as typeof window.electron
}

const emit = (channel: string, payload: unknown) => {
  listeners.get(channel)?.forEach((listener) => listener({}, payload))
}

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

describe("createDesktopLocalAIBridge MCP", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.listMCPTools.mockResolvedValue([
      { description: "Search docs", inputSchema: { type: "object" }, name: "search" },
    ])
    mocks.callMCPTool.mockResolvedValue({
      content: [{ text: "tool result", type: "text" }],
    })
    const { getAISettings } = await import("~/atoms/settings/ai")
    vi.mocked(getAISettings).mockReturnValue({
      localAI: {
        allowFallbackToCloud: false,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "cloud",
          mcp: "local",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "cloud",
          translation: "cloud",
          tts: "cloud",
        },
      },
      mcpServices: [
        {
          createdAt: "2026-06-15T00:00:00.000Z",
          enabled: true,
          id: "local-mcp-1",
          isConnected: true,
          lastUsed: null,
          name: "Local MCP",
          promptCount: 0,
          resourceCount: 0,
          toolCount: 1,
          transportType: "streamable-http",
          url: "https://example.com/mcp",
        },
      ],
    } as ReturnType<typeof getAISettings>)
  })

  it("lists local MCP services as MCP servers", async () => {
    const bridge = createDesktopLocalAIBridge()

    await expect(bridge.listMCPServers()).resolves.toEqual([
      {
        connected: true,
        enabled: true,
        id: "local-mcp-1",
        name: "Local MCP",
        toolCount: 1,
      },
    ])
  })

  it("lists and calls tools from enabled local MCP services", async () => {
    const bridge = createDesktopLocalAIBridge()

    await expect(bridge.listTools()).resolves.toEqual([
      {
        description: "Search docs",
        id: "local-mcp-1:search",
        inputSchema: { type: "object" },
        name: "search",
        serverId: "local-mcp-1",
      },
    ])
    await expect(
      bridge.callTool({
        arguments: { q: "folo" },
        serverId: "local-mcp-1",
        toolId: "local-mcp-1:search",
      }),
    ).resolves.toEqual({ content: [{ text: "tool result", type: "text" }] })
    expect(mocks.callMCPTool).toHaveBeenCalledWith({
      arguments: { q: "folo" },
      headers: {},
      name: "search",
      transportType: "streamable-http",
      url: "https://example.com/mcp",
    })
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

  it("rejects malformed translation responses instead of silently returning no results", async () => {
    mocks.completeText.mockResolvedValue({
      text: "I could not translate this response.",
      totalTokens: 8,
    })
    const bridge = createDesktopLocalAIBridge()

    await expect(
      bridge.translateEntries({
        fields: "content",
        items: [{ content: "Content", entryId: "entry-1" }],
        language: "zh-CN",
        mode: "translation-only",
        model: "translation-model",
        profileId: "profile-1",
      }),
    ).rejects.toThrow("Local AI translation response was not valid JSON")
  })
})

describe("createDesktopLocalAIBridge streamTranslateText", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installElectronListeners()
    mocks.listProfiles.mockResolvedValue([{ ...existingProfile, supportsStreaming: true }])
    mocks.startChatStream.mockResolvedValue({ streamId: "translation-stream-1" })
  })

  it("streams translation text through local chat IPC deltas", async () => {
    const bridge = createDesktopLocalAIBridge()
    const deltas: string[] = []

    const resultPromise = bridge.streamTranslateText?.({
      content: "<p>Hello world.</p>",
      field: "content",
      language: "zh-CN",
      mode: "translation-only",
      model: "translation-model",
      onDelta: (delta) => deltas.push(delta),
      profileId: "profile-1",
    })

    await vi.waitFor(() => {
      expect(listeners.get("local-ai:chat-delta")?.size).toBe(1)
      expect(listeners.get("local-ai:chat-finish")?.size).toBe(1)
    })

    emit("local-ai:chat-delta", { delta: "你好", streamId: "translation-stream-1" })
    emit("local-ai:chat-delta", { delta: "世界", streamId: "translation-stream-1" })
    emit("local-ai:chat-finish", {
      result: { text: "你好世界", totalTokens: 8 },
      streamId: "translation-stream-1",
    })

    await expect(resultPromise).resolves.toEqual({
      text: "你好世界",
      usage: {
        totalTokens: 8,
      },
    })
    expect(deltas).toEqual(["你好", "世界"])
    expect(mocks.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "translation",
        model: "translation-model",
        profileId: "profile-1",
        temperature: 0.1,
      }),
    )
    const [{ messages }] = vi.mocked(mocks.startChatStream).mock.calls[0]!
    expect(messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Return only the translated text"),
    })
    expect(messages[1]).toMatchObject({
      role: "user",
      content: expect.stringContaining("<p>Hello world.</p>"),
    })
  })

  it("does not ask the model to produce bilingual translation output", async () => {
    const bridge = createDesktopLocalAIBridge()

    const resultPromise = bridge.streamTranslateText?.({
      content: "<p>Hello world.</p>",
      field: "content",
      language: "zh-CN",
      mode: "bilingual",
      model: "translation-model",
      profileId: "profile-1",
    })

    await vi.waitFor(() => {
      expect(listeners.get("local-ai:chat-finish")?.size).toBe(1)
    })

    emit("local-ai:chat-finish", {
      result: { text: "你好世界", totalTokens: 8 },
      streamId: "translation-stream-1",
    })

    await expect(resultPromise).resolves.toMatchObject({ text: "你好世界" })

    const [{ messages }] = vi.mocked(mocks.startChatStream).mock.calls[0]!
    expect(messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("The app handles bilingual display"),
    })
    expect(messages[1]).toMatchObject({
      role: "user",
      content: expect.not.stringContaining("Display mode: bilingual"),
    })
  })

  it("forces streaming for translation even when the profile disables generic streaming", async () => {
    mocks.listProfiles.mockResolvedValue([{ ...existingProfile, supportsStreaming: false }])
    const bridge = createDesktopLocalAIBridge()

    const resultPromise = bridge.streamTranslateText?.({
      content: "<li>Long first item.</li>",
      field: "content",
      language: "zh-CN",
      mode: "bilingual",
      model: "translation-model",
      profileId: "profile-1",
    })

    await vi.waitFor(() => {
      expect(listeners.get("local-ai:chat-finish")?.size).toBe(1)
    })

    emit("local-ai:chat-finish", {
      result: { text: "<li>Translated first item.</li>", totalTokens: 8 },
      streamId: "translation-stream-1",
    })

    await expect(resultPromise).resolves.toMatchObject({
      text: "<li>Translated first item.</li>",
    })
    expect(mocks.completeText).not.toHaveBeenCalled()
    expect(mocks.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "translation",
        forceStreaming: true,
      }),
    )
  })

  it("keeps translation streams alive while waiting for the first token", async () => {
    vi.useFakeTimers()
    const bridge = createDesktopLocalAIBridge()

    try {
      const resultPromise = bridge.streamTranslateText?.({
        content: "<p>Hello world.</p>",
        field: "content",
        language: "zh-CN",
        mode: "translation-only",
        model: "translation-model",
        profileId: "profile-1",
      })

      await vi.waitFor(() => {
        expect(listeners.get("local-ai:chat-delta")?.size).toBe(1)
      })

      await vi.advanceTimersByTimeAsync(10_000)

      expect(mocks.stopChatStream).not.toHaveBeenCalled()

      emit("local-ai:chat-delta", { delta: "姝ｅ湪缈昏瘧", streamId: "translation-stream-1" })
      emit("local-ai:chat-finish", {
        result: { text: "姝ｅ湪缈昏瘧", totalTokens: 8 },
        streamId: "translation-stream-1",
      })

      await expect(resultPromise).resolves.toMatchObject({
        text: "姝ｅ湪缈昏瘧",
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
