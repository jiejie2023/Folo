import type { IpcContext } from "electron-ipc-decorator"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  LocalAIProfileView,
  LocalAIStoredProfile,
  LocalAITextResult,
} from "~/lib/local-ai/types"

import { LocalAIService } from "./local-ai"

const {
  clearLocalAIUsage,
  completeOpenAICompatibleText,
  deleteLocalAIProfile,
  listLocalAIProfiles,
  listLocalAIUsage,
  listOpenAICompatibleModels,
  readLocalAIProfileSecret,
  recordLocalAIUsage,
  streamOpenAICompatibleChat,
  synthesizeOpenAICompatibleSpeech,
  updateLocalAIProfileModels,
  updateLocalAIProfileTestResult,
  upsertLocalAIProfile,
} = vi.hoisted(() => ({
  clearLocalAIUsage: vi.fn(),
  completeOpenAICompatibleText: vi.fn(),
  deleteLocalAIProfile: vi.fn(),
  listLocalAIProfiles: vi.fn(),
  listLocalAIUsage: vi.fn(),
  listOpenAICompatibleModels: vi.fn(),
  readLocalAIProfileSecret: vi.fn(),
  recordLocalAIUsage: vi.fn(),
  streamOpenAICompatibleChat: vi.fn(),
  synthesizeOpenAICompatibleSpeech: vi.fn(),
  updateLocalAIProfileModels: vi.fn(),
  updateLocalAIProfileTestResult: vi.fn(),
  upsertLocalAIProfile: vi.fn(),
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))

vi.mock("~/lib/local-ai/profile-store", () => ({
  deleteLocalAIProfile,
  listLocalAIProfiles,
  readLocalAIProfileSecret,
  updateLocalAIProfileModels,
  updateLocalAIProfileTestResult,
  upsertLocalAIProfile,
}))

vi.mock("~/lib/local-ai/openai-compatible", () => ({
  completeOpenAICompatibleText,
  listOpenAICompatibleModels,
  streamOpenAICompatibleChat,
  synthesizeOpenAICompatibleSpeech,
}))

vi.mock("~/lib/local-ai/usage-store", () => ({
  clearLocalAIUsage,
  listLocalAIUsage,
  recordLocalAIUsage,
}))

const profile: LocalAIProfileView = {
  baseURL: "http://localhost:11434/v1",
  createdAt: "2026-06-14T00:00:00.000Z",
  defaultChatModel: "llama3",
  defaultSummaryModel: null,
  defaultTaskModel: null,
  defaultTimelineModel: null,
  defaultTranslationModel: null,
  defaultTtsModel: "tts-1",
  enabled: true,
  headers: {},
  id: "profile-1",
  lastTestedAt: null,
  lastTestResult: null,
  maskedApiKey: "sk-...safe",
  models: [],
  name: "Local",
  providerType: "openai-compatible",
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsTts: true,
  updatedAt: "2026-06-14T00:00:00.000Z",
}

const storedProfile: LocalAIStoredProfile = {
  ...profile,
}
delete (storedProfile as Partial<LocalAIProfileView>).maskedApiKey

const context = {
  sender: {
    send: vi.fn(),
  },
} as unknown as IpcContext

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("LocalAIService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listLocalAIProfiles.mockReturnValue([profile])
    readLocalAIProfileSecret.mockReturnValue("sk-secret-raw")
  })

  it("delegates listProfiles to the profile store", () => {
    const service = new LocalAIService()

    expect(service.listProfiles(context)).toEqual([profile])
    expect(listLocalAIProfiles).toHaveBeenCalledTimes(1)
  })

  it("finds the profile and secret before listing models", async () => {
    listOpenAICompatibleModels.mockResolvedValue(["llama3", "nomic-embed"])
    const service = new LocalAIService()

    await expect(service.listModels(context, "profile-1")).resolves.toEqual([
      "llama3",
      "nomic-embed",
    ])

    expect(readLocalAIProfileSecret).toHaveBeenCalledWith("profile-1")
    expect(listOpenAICompatibleModels).toHaveBeenCalledWith({
      apiKey: "sk-secret-raw",
      profile: storedProfile,
    })
    expect(updateLocalAIProfileModels).toHaveBeenCalledWith("profile-1", ["llama3", "nomic-embed"])
    expect(updateLocalAIProfileTestResult).toHaveBeenCalledWith(
      "profile-1",
      expect.objectContaining({ message: "Found 2 models", ok: true }),
    )
  })

  it("tests a profile by listing models and completing a tiny chat request", async () => {
    listOpenAICompatibleModels.mockResolvedValue(["llama3", "nomic-embed"])
    completeOpenAICompatibleText.mockResolvedValue({ text: "OK", totalTokens: 2 })
    const service = new LocalAIService()

    await expect(service.testProfile(context, "profile-1")).resolves.toEqual(
      expect.objectContaining({
        model: "llama3",
        models: ["llama3", "nomic-embed"],
        ok: true,
      }),
    )

    expect(updateLocalAIProfileModels).toHaveBeenCalledWith("profile-1", ["llama3", "nomic-embed"])
    expect(completeOpenAICompatibleText).toHaveBeenCalledWith({
      apiKey: "sk-secret-raw",
      maxTokens: 4,
      messages: [{ content: "Reply with OK.", role: "user" }],
      model: "llama3",
      profile: storedProfile,
      temperature: 0,
    })
    expect(updateLocalAIProfileTestResult).toHaveBeenCalledWith(
      "profile-1",
      expect.objectContaining({ ok: true }),
    )
  })

  it("continues profile tests with a configured model when model listing is unavailable", async () => {
    listOpenAICompatibleModels.mockRejectedValue(new Error("models endpoint disabled"))
    completeOpenAICompatibleText.mockResolvedValue({ text: "OK", totalTokens: 2 })
    const service = new LocalAIService()

    await expect(service.testProfile(context, "profile-1")).resolves.toEqual(
      expect.objectContaining({
        model: "llama3",
        models: [],
        modelsWarning: "models endpoint disabled",
        ok: true,
      }),
    )

    expect(updateLocalAIProfileModels).not.toHaveBeenCalled()
    expect(completeOpenAICompatibleText).toHaveBeenCalledWith({
      apiKey: "sk-secret-raw",
      maxTokens: 4,
      messages: [{ content: "Reply with OK.", role: "user" }],
      model: "llama3",
      profile: storedProfile,
      temperature: 0,
    })
    expect(updateLocalAIProfileTestResult).toHaveBeenCalledWith(
      "profile-1",
      expect.objectContaining({
        message: "Connection test succeeded with llama3; model list unavailable",
        ok: true,
      }),
    )
  })

  it("returns completeText result and records successful usage", async () => {
    const result: LocalAITextResult = { text: "Hello", totalTokens: 12 }
    completeOpenAICompatibleText.mockResolvedValue(result)
    const service = new LocalAIService()

    await expect(
      service.completeText(context, {
        messages: [{ content: "Hi", role: "user" }],
        model: "llama3",
        profileId: "profile-1",
      }),
    ).resolves.toEqual(result)

    expect(completeOpenAICompatibleText).toHaveBeenCalledWith({
      abortSignal: undefined,
      apiKey: "sk-secret-raw",
      messages: [{ content: "Hi", role: "user" }],
      model: "llama3",
      profile: storedProfile,
    })
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: null,
      feature: "chat",
      model: "llama3",
      ok: true,
      profileId: "profile-1",
      totalTokens: 12,
    })
  })

  it.each(["summary", "translation", "tasks"] as const)(
    "records successful %s completeText usage with the requested feature",
    async (feature) => {
      const result: LocalAITextResult = { text: "Result", totalTokens: 8 }
      completeOpenAICompatibleText.mockResolvedValue(result)
      const service = new LocalAIService()

      await service.completeText(context, {
        feature,
        messages: [{ content: "Prompt", role: "user" }],
        model: "llama3",
        profileId: "profile-1",
      })

      expect(recordLocalAIUsage).toHaveBeenCalledWith({
        errorMessage: null,
        feature,
        model: "llama3",
        ok: true,
        profileId: "profile-1",
        totalTokens: 8,
      })
    },
  )

  it("records completeText failure without exposing the raw API key", async () => {
    completeOpenAICompatibleText.mockRejectedValue(new Error("bad sk-secret-raw token"))
    const service = new LocalAIService()

    await expect(
      service.completeText(context, {
        messages: [{ content: "Hi", role: "user" }],
        model: "llama3",
        profileId: "profile-1",
      }),
    ).rejects.toThrow("bad [redacted] token")

    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "bad [redacted] token",
      feature: "chat",
      model: "llama3",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })
  })

  it("aborts an active completeText request when stopTextCompletion is called", async () => {
    let abortSignal: AbortSignal | undefined
    completeOpenAICompatibleText.mockImplementation(
      async ({ abortSignal: signal }: { abortSignal?: AbortSignal }) => {
        abortSignal = signal

        return new Promise<LocalAITextResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
      },
    )
    const service = new LocalAIService()

    const promise = service.completeText(context, {
      messages: [{ content: "Hi", role: "user" }],
      model: "llama3",
      profileId: "profile-1",
      requestId: "request-1",
    })

    expect(abortSignal?.aborted).toBe(false)

    service.stopTextCompletion(context, "request-1")

    await expect(promise).rejects.toThrow("aborted")
    expect(abortSignal?.aborted).toBe(true)
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "aborted",
      feature: "chat",
      model: "llama3",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })
  })

  it("rejects unsupported JSON mode and records translation failure", async () => {
    listLocalAIProfiles.mockReturnValue([{ ...profile, supportsJsonMode: false }])
    const service = new LocalAIService()

    await expect(
      service.completeText(context, {
        feature: "translation",
        messages: [{ content: "Translate", role: "user" }],
        model: "llama3",
        profileId: "profile-1",
        responseFormat: "json_object",
      }),
    ).rejects.toThrow("Local AI profile does not support JSON mode")

    expect(completeOpenAICompatibleText).not.toHaveBeenCalled()
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "Local AI profile does not support JSON mode",
      feature: "translation",
      model: "llama3",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })
  })

  it("returns a stream id and emits chat delta and finish events", async () => {
    streamOpenAICompatibleChat.mockImplementation(
      async ({ onDelta }: { onDelta: (delta: string) => void }) => {
        onDelta("Hel")
        onDelta("lo")
        return { text: "Hello", totalTokens: 10 } satisfies LocalAITextResult
      },
    )
    const service = new LocalAIService()

    const result = service.startChatStream(context, {
      messages: [{ content: "Hi", role: "user" }],
      model: "llama3",
      profileId: "profile-1",
    })

    expect(result.streamId).toMatch(/^local-ai-stream-/)
    await flushPromises()

    expect(context.sender.send).toHaveBeenCalledWith("local-ai:chat-delta", {
      delta: "Hel",
      streamId: result.streamId,
    })
    expect(context.sender.send).toHaveBeenCalledWith("local-ai:chat-delta", {
      delta: "lo",
      streamId: result.streamId,
    })
    expect(context.sender.send).toHaveBeenCalledWith("local-ai:chat-finish", {
      result: { text: "Hello", totalTokens: 10 },
      streamId: result.streamId,
    })
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: null,
      feature: "chat",
      model: "llama3",
      ok: true,
      profileId: "profile-1",
      totalTokens: 10,
    })
  })

  it("aborts an active chat stream when stopChatStream is called", async () => {
    let abortSignal: AbortSignal | undefined
    streamOpenAICompatibleChat.mockImplementation(
      async ({ abortSignal: signal }: { abortSignal?: AbortSignal }) => {
        abortSignal = signal

        return new Promise<LocalAITextResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
      },
    )
    const service = new LocalAIService()

    const result = service.startChatStream(context, {
      messages: [{ content: "Hi", role: "user" }],
      model: "llama3",
      profileId: "profile-1",
    })

    expect(abortSignal?.aborted).toBe(false)

    service.stopChatStream(context, result.streamId)
    await flushPromises()

    expect(abortSignal?.aborted).toBe(true)
    expect(context.sender.send).toHaveBeenCalledWith("local-ai:chat-error", {
      message: "aborted",
      streamId: result.streamId,
    })
  })

  it("emits stream errors and records failure without exposing the raw API key", async () => {
    streamOpenAICompatibleChat.mockRejectedValue(new Error("bad sk-secret-raw token"))
    const service = new LocalAIService()

    const result = service.startChatStream(context, {
      messages: [{ content: "Hi", role: "user" }],
      model: "llama3",
      profileId: "profile-1",
    })
    await flushPromises()

    expect(context.sender.send).toHaveBeenCalledWith("local-ai:chat-error", {
      message: "bad [redacted] token",
      streamId: result.streamId,
    })
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "bad [redacted] token",
      feature: "chat",
      model: "llama3",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })
  })

  it("throws useful errors for missing profiles and missing API keys", async () => {
    const service = new LocalAIService()

    listLocalAIProfiles.mockReturnValueOnce([])
    await expect(service.listModels(context, "missing")).rejects.toThrow(
      "Local AI profile not found",
    )

    readLocalAIProfileSecret.mockReturnValueOnce(null)
    await expect(service.listModels(context, "profile-1")).rejects.toThrow(
      "Local AI API key is missing",
    )
  })

  it("records completeText setup failures for missing profiles and missing API keys", async () => {
    const service = new LocalAIService()
    const input = {
      messages: [{ content: "Hi", role: "user" as const }],
      model: "llama3",
      profileId: "profile-1",
    }

    listLocalAIProfiles.mockReturnValueOnce([])
    await expect(service.completeText(context, input)).rejects.toThrow("Local AI profile not found")
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "Local AI profile not found",
      feature: "chat",
      model: "llama3",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })

    vi.clearAllMocks()
    listLocalAIProfiles.mockReturnValue([profile])
    readLocalAIProfileSecret.mockReturnValueOnce(null)
    await expect(service.completeText(context, input)).rejects.toThrow(
      "Local AI API key is missing",
    )
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "Local AI API key is missing",
      feature: "chat",
      model: "llama3",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })
  })

  it("returns serializable speech audio and records usage", async () => {
    synthesizeOpenAICompatibleSpeech.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
    })
    const service = new LocalAIService()

    await expect(
      service.synthesizeSpeech(context, {
        input: "Read this",
        model: "tts-1",
        profileId: "profile-1",
        voice: "alloy",
      }),
    ).resolves.toEqual({ audio: [1, 2, 3], mimeType: "audio/mpeg" })

    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: null,
      feature: "tts",
      model: "tts-1",
      ok: true,
      profileId: "profile-1",
      totalTokens: null,
    })
  })

  it("rejects unsupported TTS and records failed usage", async () => {
    listLocalAIProfiles.mockReturnValue([{ ...profile, supportsTts: false }])
    const service = new LocalAIService()

    await expect(
      service.synthesizeSpeech(context, {
        input: "Read this",
        model: "tts-1",
        profileId: "profile-1",
      }),
    ).rejects.toThrow("Local AI profile does not support TTS")

    expect(synthesizeOpenAICompatibleSpeech).not.toHaveBeenCalled()
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "Local AI profile does not support TTS",
      feature: "tts",
      model: "tts-1",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })
  })

  it("records synthesizeSpeech setup failures for missing profiles and missing API keys", async () => {
    const service = new LocalAIService()
    const input = {
      input: "Read this",
      model: "tts-1",
      profileId: "profile-1",
    }

    listLocalAIProfiles.mockReturnValueOnce([])
    await expect(service.synthesizeSpeech(context, input)).rejects.toThrow(
      "Local AI profile not found",
    )
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "Local AI profile not found",
      feature: "tts",
      model: "tts-1",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })

    vi.clearAllMocks()
    listLocalAIProfiles.mockReturnValue([profile])
    readLocalAIProfileSecret.mockReturnValueOnce(null)
    await expect(service.synthesizeSpeech(context, input)).rejects.toThrow(
      "Local AI API key is missing",
    )
    expect(recordLocalAIUsage).toHaveBeenCalledWith({
      errorMessage: "Local AI API key is missing",
      feature: "tts",
      model: "tts-1",
      ok: false,
      profileId: "profile-1",
      totalTokens: null,
    })
  })
})
