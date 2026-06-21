import type { UIMessageChunk } from "ai"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BizUIMessage } from "~/modules/ai-chat/store/types"

import { createLocalAIChatTransport } from "./chat-transport"
import type { DesktopLocalAIIPC, DesktopLocalAIProfile } from "./hooks"

const mocks = vi.hoisted(() => ({
  fallbackSendMessages: vi.fn(),
  getActionLanguage: vi.fn(),
  getAISettings: vi.fn(),
  getEntry: vi.fn(),
  getEntryIdsByFeedIds: vi.fn(),
  getEntryIdsByView: vi.fn(),
  getLocalAIIPC: vi.fn(),
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: mocks.getAISettings,
}))

vi.mock("~/atoms/settings/general", () => ({
  getActionLanguage: mocks.getActionLanguage,
}))

vi.mock("@follow/store/entry/getter", () => ({
  getEntry: mocks.getEntry,
  getEntryIdsByFeedIds: mocks.getEntryIdsByFeedIds,
  getEntryIdsByView: mocks.getEntryIdsByView,
}))

vi.mock("./hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks")>()
  return {
    ...actual,
    getLocalAIIPC: mocks.getLocalAIIPC,
  }
})

const profile: DesktopLocalAIProfile = {
  baseURL: "http://localhost:11434/v1",
  createdAt: "2026-06-14T00:00:00.000Z",
  defaultChatModel: "llama3",
  defaultSummaryModel: null,
  defaultTaskModel: null,
  defaultTimelineModel: null,
  defaultTranslationModel: null,
  defaultTtsModel: null,
  enabled: true,
  headers: {},
  id: "profile-1",
  lastTestResult: null,
  lastTestedAt: null,
  maskedApiKey: "sk-...safe",
  models: ["llama3"],
  name: "Local",
  providerType: "openai-compatible",
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsTts: false,
  updatedAt: "2026-06-14T00:00:00.000Z",
}

const createIPC = (overrides: Partial<DesktopLocalAIIPC> = {}): DesktopLocalAIIPC =>
  ({
    clearUsage: vi.fn(),
    completeText: vi.fn(),
    deleteProfile: vi.fn(),
    listModels: vi.fn(),
    listProfiles: vi.fn().mockResolvedValue([profile]),
    listUsage: vi.fn(),
    startChatStream: vi.fn().mockReturnValue({ streamId: "stream-1" }),
    stopTextCompletion: vi.fn(),
    synthesizeSpeech: vi.fn(),
    upsertProfile: vi.fn(),
    ...overrides,
  }) as DesktopLocalAIIPC

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

const readStream = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
  const reader = stream.getReader()
  const chunks: UIMessageChunk[] = []

  while (true) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(result.value)
  }

  return chunks
}

const createMessage = (parts: BizUIMessage["parts"]): BizUIMessage => ({
  createdAt: new Date("2026-06-14T00:00:00.000Z"),
  id: "message-1",
  parts,
  role: "user",
})

const createTransport = () =>
  createLocalAIChatTransport({
    createCloudTransport: () =>
      ({
        reconnectToStream: vi.fn(),
        sendMessages: mocks.fallbackSendMessages,
      }) as ReturnType<Parameters<typeof createLocalAIChatTransport>[0]["createCloudTransport"]>,
  })

describe("createLocalAIChatTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installElectronListeners()
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: false,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "local",
          mcp: "cloud",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "cloud",
          translation: "cloud",
          tts: "cloud",
        },
      },
    })
    mocks.getEntry.mockReset()
    mocks.getEntryIdsByFeedIds.mockReset()
    mocks.getEntryIdsByView.mockReset()
    mocks.getActionLanguage.mockReturnValue("zh-CN")
    mocks.fallbackSendMessages.mockResolvedValue(new ReadableStream<UIMessageChunk>())
  })

  it("converts local IPC chat events to AI SDK UI message chunks", async () => {
    const ipc = createIPC()
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    const transport = createTransport()

    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Hello" }])],
      trigger: "submit-message",
    })
    const chunksPromise = readStream(stream)

    emit("local-ai:chat-delta", { delta: "Hel", streamId: "stream-1" })
    emit("local-ai:chat-delta", { delta: "lo", streamId: "stream-1" })
    emit("local-ai:chat-finish", {
      result: { text: "Hello", totalTokens: 10 },
      streamId: "stream-1",
    })

    await expect(chunksPromise).resolves.toEqual([
      { type: "start" },
      { type: "start-step" },
      { id: "text-1", type: "text-start" },
      { delta: "Hel", id: "text-1", type: "text-delta" },
      { delta: "lo", id: "text-1", type: "text-delta" },
      { id: "text-1", type: "text-end" },
      { type: "finish-step" },
      { finishReason: "stop", type: "finish" },
    ])
  })

  it("extracts text, rich text, and main entry context for local chat prompts", async () => {
    const ipc = createIPC()
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    mocks.getEntry.mockReturnValue({
      content: "Full article content",
      description: "Short description",
      readabilityContent: "Readable article body",
      title: "Article title",
      url: "https://example.com/article",
    })
    const transport = createTransport()

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [
        createMessage([
          { type: "text", text: "Plain text" },
          {
            type: "data-rich-text",
            data: { state: "{}", text: "Rich markdown text" },
          },
          {
            type: "data-block",
            data: [{ id: "entry-block", type: "mainEntry", value: "entry-1" }],
          },
        ]),
      ],
      trigger: "submit-message",
    })

    expect(ipc.startChatStream).toHaveBeenCalledWith({
      feature: "chat",
      messages: [
        expect.objectContaining({
          content: expect.stringContaining("Current entry context"),
          role: "system",
        }),
        expect.objectContaining({
          content: expect.stringContaining("Plain text\nRich markdown text"),
          role: "user",
        }),
      ],
      model: "llama3",
      profileId: "profile-1",
    })
    const [{ messages }] = vi.mocked(ipc.startChatStream).mock.calls[0]!
    expect(messages[0]!.content).toContain("Article title")
    expect(messages[0]!.content).toContain("https://example.com/article")
    expect(messages[0]!.content).toContain("Readable article body")
  })

  it("sends uploaded image attachments as multimodal local chat content", async () => {
    const ipc = createIPC()
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    const transport = createTransport()

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [
        createMessage([
          { type: "text", text: "这张图片？" },
          {
            type: "data-block",
            data: [
              {
                attachment: {
                  id: "image-1",
                  name: "image.png",
                  serverUrl: "https://cdn.example.com/image.png",
                  size: 1234,
                  type: "image/png",
                },
                id: "image-1",
                type: "fileAttachment",
              },
            ],
          },
        ]),
      ],
      trigger: "submit-message",
    })

    const [{ messages }] = vi.mocked(ipc.startChatStream).mock.calls[0]!
    expect(messages[1]).toEqual({
      content: [
        { text: "这张图片？", type: "text" },
        {
          image_url: {
            detail: "auto",
            url: "https://cdn.example.com/image.png",
          },
          type: "image_url",
        },
      ],
      role: "user",
    })
  })

  it("adds current timeline entries to local timeline summary prompts", async () => {
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: false,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "cloud",
          mcp: "cloud",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "local",
          translation: "cloud",
          tts: "cloud",
        },
      },
    })
    const ipc = createIPC()
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    mocks.getEntryIdsByFeedIds.mockReturnValue(["entry-1", "entry-2"])
    mocks.getEntry.mockImplementation((entryId: string) => {
      const entries = {
        "entry-1": {
          content: "Important unread timeline content",
          description: "Important unread description",
          feedId: "feed-1",
          publishedAt: new Date("2026-06-16T08:00:00.000Z"),
          read: false,
          title: "Important unread entry",
          url: "https://example.com/unread",
        },
        "entry-2": {
          content: "Already read content",
          description: "Already read description",
          feedId: "feed-1",
          publishedAt: new Date("2026-06-16T07:00:00.000Z"),
          read: true,
          title: "Already read entry",
          url: "https://example.com/read",
        },
      }
      return entries[entryId as keyof typeof entries]
    })
    const transport = createLocalAIChatTransport({
      createCloudTransport: () =>
        ({
          reconnectToStream: vi.fn(),
          sendMessages: mocks.fallbackSendMessages,
        }) as ReturnType<Parameters<typeof createLocalAIChatTransport>[0]["createCloudTransport"]>,
      feature: "timelineSummary",
    })

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [
        createMessage([
          {
            type: "data-block",
            data: [
              { id: "mainView", type: "mainView", value: "0" },
              { id: "mainFeed", type: "mainFeed", value: "feed-1" },
              { id: "unreadOnly", type: "unreadOnly", value: "true" },
            ],
          },
          {
            type: "data-rich-text",
            data: { state: "{}", text: "/ Summarize" },
          },
        ]),
      ],
      trigger: "submit-message",
    })

    const [{ messages }] = vi.mocked(ipc.startChatStream).mock.calls[0]!
    expect(messages[0]!.content).toContain("Current timeline context")
    expect(messages[0]!.content).toContain("Important unread entry")
    expect(messages[0]!.content).toContain("Important unread timeline content")
    expect(messages[0]!.content).not.toContain("Already read entry")
  })

  it("uses explicit visible timeline entries when summarizing a view timeline", async () => {
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: false,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "cloud",
          mcp: "cloud",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "local",
          translation: "cloud",
          tts: "cloud",
        },
      },
    })
    const ipc = createIPC()
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    mocks.getEntryIdsByView.mockReturnValue([])
    mocks.getEntry.mockImplementation((entryId: string) => {
      const entries = {
        "visible-1": {
          content: "Visible social timeline content",
          description: "Visible social description",
          feedId: "social-feed",
          publishedAt: new Date("2026-06-17T01:00:00.000Z"),
          read: false,
          title: "Visible social entry",
          url: "https://example.com/social",
        },
      }
      return entries[entryId as keyof typeof entries]
    })
    const transport = createLocalAIChatTransport({
      createCloudTransport: () =>
        ({
          reconnectToStream: vi.fn(),
          sendMessages: mocks.fallbackSendMessages,
        }) as ReturnType<Parameters<typeof createLocalAIChatTransport>[0]["createCloudTransport"]>,
      feature: "timelineSummary",
    })

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [
        createMessage([
          {
            type: "data-block",
            data: [
              { id: "mainView", type: "mainView", value: "3" },
              { id: "timelineEntries", type: "timelineEntries", value: "visible-1" },
            ],
          },
          {
            type: "data-rich-text",
            data: { state: "{}", text: "/ Summarize" },
          },
        ]),
      ],
      trigger: "submit-message",
    })

    const [{ messages }] = vi.mocked(ipc.startChatStream).mock.calls[0]!
    expect(messages[0]!.content).toContain("Current timeline context")
    expect(messages[0]!.content).toContain("Visible social entry")
    expect(messages[0]!.content).toContain("Visible social timeline content")
  })

  it("passes enabled local MCP services to tool-capable local chat profiles", async () => {
    const ipc = createIPC({
      listProfiles: vi
        .fn()
        .mockResolvedValue([{ ...profile, supportsStreaming: false, supportsTools: true }]),
    })
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: false,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "local",
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
      mcpEnabled: true,
      mcpServices: [
        {
          createdAt: "2026-06-15T00:00:00.000Z",
          enabled: true,
          headers: { Authorization: "Bearer token" },
          id: "local-mcp-1",
          isConnected: true,
          lastUsed: null,
          name: "Local MCP",
          promptCount: 0,
          resourceCount: 0,
          toolCount: 1,
          transportType: "streamable-http",
          url: "https://mcp.example.com/api",
        },
      ],
    })
    const transport = createTransport()

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Search docs" }])],
      trigger: "submit-message",
    })

    expect(ipc.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: [
          {
            enabled: true,
            headers: { Authorization: "Bearer token" },
            id: "local-mcp-1",
            name: "Local MCP",
            transportType: "streamable-http",
            url: "https://mcp.example.com/api",
          },
        ],
      }),
    )
    expect(ipc.completeText).not.toHaveBeenCalled()
  })

  it("includes the personalized AI prompt in local chat system messages", async () => {
    const ipc = createIPC()
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: false,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "local",
          mcp: "cloud",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "cloud",
          translation: "cloud",
          tts: "cloud",
        },
      },
      personalizePrompt: "Answer in concise Chinese.",
    })
    const transport = createTransport()

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Hello" }])],
      trigger: "submit-message",
    })

    const [{ messages }] = vi.mocked(ipc.startChatStream).mock.calls[0]!
    expect(messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Answer in concise Chinese."),
    })
  })

  it("adds the configured AI output language to local chat system messages", async () => {
    const ipc = createIPC()
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    mocks.getActionLanguage.mockReturnValue("zh-CN")
    const transport = createTransport()

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Summarize this timeline" }])],
      trigger: "submit-message",
    })

    const [{ messages }] = vi.mocked(ipc.startChatStream).mock.calls[0]!
    expect(messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Output language: Simplified Chinese (zh-CN)"),
    })
  })

  it("uses the timeline model when the local chat transport is created for timeline summary", async () => {
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: false,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "cloud",
          mcp: "cloud",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "local",
          translation: "cloud",
          tts: "cloud",
        },
      },
    })
    const ipc = createIPC({
      listProfiles: vi.fn().mockResolvedValue([
        {
          ...profile,
          defaultTimelineModel: "timeline-model",
          models: ["llama3", "timeline-model"],
        },
      ]),
    })
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    const transport = createLocalAIChatTransport({
      createCloudTransport: () =>
        ({
          reconnectToStream: vi.fn(),
          sendMessages: mocks.fallbackSendMessages,
        }) as ReturnType<Parameters<typeof createLocalAIChatTransport>[0]["createCloudTransport"]>,
      feature: "timelineSummary",
    })

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Summarize timeline" }])],
      trigger: "submit-message",
    })

    expect(ipc.startChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "timelineSummary",
        model: "timeline-model",
      }),
    )
  })

  it("falls back to cloud transport when local startup fails and fallback is enabled", async () => {
    const fallbackStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "finish" })
        controller.close()
      },
    })
    mocks.fallbackSendMessages.mockResolvedValue(fallbackStream)
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: true,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "local",
          mcp: "cloud",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "cloud",
          translation: "cloud",
          tts: "cloud",
        },
      },
    })
    mocks.getLocalAIIPC.mockReturnValue(
      createIPC({
        listProfiles: vi
          .fn()
          .mockResolvedValue([{ ...profile, defaultChatModel: null, models: [] }]),
      }),
    )
    const transport = createTransport()
    const options = {
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Hello" }])],
      trigger: "submit-message" as const,
    }

    await expect(transport.sendMessages(options)).resolves.toBe(fallbackStream)
    expect(mocks.fallbackSendMessages).toHaveBeenCalledWith(options)
  })

  it("throws local startup errors when fallback is disabled", async () => {
    mocks.getLocalAIIPC.mockReturnValue(
      createIPC({
        listProfiles: vi.fn().mockResolvedValue([{ ...profile, enabled: false }]),
      }),
    )
    const transport = createTransport()

    await expect(
      transport.sendMessages({
        abortSignal: undefined,
        chatId: "chat-1",
        messageId: undefined,
        messages: [createMessage([{ type: "text", text: "Hello" }])],
        trigger: "submit-message",
      }),
    ).rejects.toThrow("Local AI profile is disabled")
    expect(mocks.fallbackSendMessages).not.toHaveBeenCalled()
  })

  it("wraps completeText output as a chunk stream when the profile does not support streaming", async () => {
    const ipc = createIPC({
      completeText: vi.fn().mockResolvedValue({ text: "Non-streamed response", totalTokens: 7 }),
      listProfiles: vi.fn().mockResolvedValue([{ ...profile, supportsStreaming: false }]),
    })
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    const transport = createTransport()

    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Hello" }])],
      trigger: "submit-message",
    })

    await expect(readStream(stream)).resolves.toEqual([
      { type: "start" },
      { type: "start-step" },
      { id: "text-1", type: "text-start" },
      { delta: "Non-streamed response", id: "text-1", type: "text-delta" },
      { id: "text-1", type: "text-end" },
      { type: "finish-step" },
      { finishReason: "stop", type: "finish" },
    ])
    expect(ipc.startChatStream).not.toHaveBeenCalled()
    expect(ipc.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "chat",
        messages: expect.any(Array),
        model: "llama3",
        profileId: "profile-1",
        requestId: expect.stringMatching(/^local-ai-text-/),
      }),
    )
  })

  it("returns provider errors from non-streaming local chat without cloud fallback", async () => {
    mocks.getAISettings.mockReturnValue({
      localAI: {
        allowFallbackToCloud: true,
        defaultProfileId: "profile-1",
        enabled: true,
        featureRouting: {
          chat: "local",
          mcp: "cloud",
          onboardingRecommendations: "cloud",
          summary: "cloud",
          tasks: "cloud",
          timelineRanking: "cloud",
          timelineSummary: "cloud",
          translation: "cloud",
          tts: "cloud",
        },
      },
    })
    const ipc = createIPC({
      completeText: vi.fn().mockRejectedValue(new Error("provider is down")),
      listProfiles: vi.fn().mockResolvedValue([{ ...profile, supportsStreaming: false }]),
    })
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    const transport = createTransport()

    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Hello" }])],
      trigger: "submit-message",
    })

    await expect(readStream(stream)).resolves.toEqual([
      { errorText: "provider is down", type: "error" },
    ])
    expect(mocks.fallbackSendMessages).not.toHaveBeenCalled()
  })

  it("cancels non-streaming local chat requests when the send is aborted", async () => {
    const abortController = new AbortController()
    const ipc = createIPC({
      completeText: vi.fn(
        (): ReturnType<DesktopLocalAIIPC["completeText"]> =>
          new Promise(() => {
            // Keep the request pending until the abort path closes the UI stream.
          }),
      ),
      listProfiles: vi.fn().mockResolvedValue([{ ...profile, supportsStreaming: false }]),
      stopTextCompletion: vi.fn(async () => {}),
    })
    mocks.getLocalAIIPC.mockReturnValue(ipc)
    const transport = createTransport()

    const stream = await transport.sendMessages({
      abortSignal: abortController.signal,
      chatId: "chat-1",
      messageId: undefined,
      messages: [createMessage([{ type: "text", text: "Hello" }])],
      trigger: "submit-message",
    })
    const chunksPromise = readStream(stream)

    abortController.abort()

    await expect(chunksPromise).resolves.toEqual([{ reason: "user", type: "abort" }])
    expect(ipc.stopTextCompletion).toHaveBeenCalledWith(expect.stringMatching(/^local-ai-text-/))
    expect(ipc.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "chat",
        messages: expect.any(Array),
        model: "llama3",
        profileId: "profile-1",
        requestId: expect.stringMatching(/^local-ai-text-/),
      }),
    )
  })
})
