import { describe, expect, it, vi } from "vitest"

import {
  completeOpenAICompatibleText,
  listOpenAICompatibleModels,
  streamOpenAICompatibleChat,
  synthesizeOpenAICompatibleSpeech,
} from "./openai-compatible"
import type { LocalAIChatMessage, LocalAIStoredProfile } from "./types"

type FetchCall = {
  init?: RequestInit
  url: string
}

const createProfile = (overrides: Partial<LocalAIStoredProfile> = {}): LocalAIStoredProfile => ({
  baseURL: "https://api.example.com/v1/",
  createdAt: "2026-06-14T00:00:00.000Z",
  defaultChatModel: "gpt-4o-mini",
  defaultSummaryModel: null,
  defaultTaskModel: null,
  defaultTimelineModel: null,
  defaultTranslationModel: null,
  defaultTtsModel: "tts-1",
  enabled: true,
  headers: { "X-Provider": "local" },
  id: "profile-1",
  lastTestedAt: null,
  lastTestResult: null,
  models: [],
  name: "Local API",
  providerType: "openai-compatible",
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsTts: true,
  updatedAt: "2026-06-14T00:00:00.000Z",
  ...overrides,
})

const createFetch = (response: Response) => {
  const calls: FetchCall[] = []
  const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ init, url: String(url) })
    return Promise.resolve(response)
  })

  return { calls, fetchFn }
}

const readRequestJson = (init: RequestInit | undefined): unknown => {
  const body = init?.body
  expect(typeof body).toBe("string")
  return JSON.parse(body as string)
}

const createSSEStream = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

const messages: LocalAIChatMessage[] = [{ content: "Hello", role: "user" }]

describe("OpenAI-compatible local AI client", () => {
  it("lists models with normalized URL, authorization, and profile headers", async () => {
    const { calls, fetchFn } = createFetch(
      Response.json({
        data: [{ id: "gpt-4o-mini" }, { id: 123 }, { id: "qwen2.5" }, { name: "missing-id" }],
      }),
    )

    const models = await listOpenAICompatibleModels({
      apiKey: "sk-secret",
      fetchFn,
      profile: createProfile(),
    })

    expect(models).toEqual(["gpt-4o-mini", "qwen2.5"])
    expect(calls).toEqual([
      {
        init: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk-secret",
            "X-Provider": "local",
          }),
          method: "GET",
        }),
        url: "https://api.example.com/v1/models",
      },
    ])
  })

  it("completes non-streaming chat text and returns total token usage", async () => {
    const { calls, fetchFn } = createFetch(
      Response.json({
        choices: [{ message: { content: "Done" } }],
        usage: { total_tokens: 42 },
      }),
    )

    const result = await completeOpenAICompatibleText({
      apiKey: "sk-secret",
      fetchFn,
      maxTokens: 100,
      messages,
      model: "gpt-4o-mini",
      profile: createProfile(),
      responseFormat: "json_object",
      temperature: 0.2,
    })

    expect(result).toEqual({ text: "Done", totalTokens: 42 })
    expect(calls[0]?.url).toBe("https://api.example.com/v1/chat/completions")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-secret",
        "Content-Type": "application/json",
        "X-Provider": "local",
      }),
    )
    expect(readRequestJson(calls[0]?.init)).toEqual({
      max_tokens: 100,
      messages,
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      stream: false,
      temperature: 0.2,
    })
  })

  it("streams SSE chat deltas split across chunks and returns accumulated text and usage", async () => {
    const deltas: string[] = []
    const response = new Response(
      createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hel',
        'lo"}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"content":" world"}}],"usage":{"total_tokens":9}}\n\n',
        "data: [DONE]\n\n",
      ]),
      { headers: { "Content-Type": "text/event-stream" } },
    )
    const { calls, fetchFn } = createFetch(response)

    const result = await streamOpenAICompatibleChat({
      apiKey: "sk-secret",
      fetchFn,
      messages,
      model: "gpt-4o-mini",
      onDelta: (delta) => deltas.push(delta),
      profile: createProfile(),
    })

    expect(deltas).toEqual(["Hello", " world"])
    expect(result).toEqual({ text: "Hello world", totalTokens: 9 })
    expect(readRequestJson(calls[0]?.init)).toEqual({
      messages,
      model: "gpt-4o-mini",
      stream: true,
    })
  })

  it("throws readable non-OK errors without leaking the API key", async () => {
    const { fetchFn } = createFetch(
      new Response(JSON.stringify({ error: { message: "Invalid sk-secret credential" } }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    )

    await expect(
      listOpenAICompatibleModels({
        apiKey: "sk-secret",
        fetchFn,
        profile: createProfile(),
      }),
    ).rejects.toThrow(/OpenAI-compatible request failed/)

    await expect(
      listOpenAICompatibleModels({
        apiKey: "sk-secret",
        fetchFn,
        profile: createProfile(),
      }),
    ).rejects.not.toThrow(/sk-secret/)
  })

  it("requests synthesized speech as binary audio", async () => {
    const audio = new Uint8Array([1, 2, 3, 4])
    const { calls, fetchFn } = createFetch(
      new Response(audio, {
        headers: { "Content-Type": "audio/mpeg" },
      }),
    )

    const result = await synthesizeOpenAICompatibleSpeech({
      apiKey: "sk-secret",
      fetchFn,
      input: "Read this",
      model: "tts-1",
      profile: createProfile(),
      voice: "alloy",
    })

    expect(result).toEqual({ audio, mimeType: "audio/mpeg" })
    expect(calls[0]?.url).toBe("https://api.example.com/v1/audio/speech")
    expect(readRequestJson(calls[0]?.init)).toEqual({
      input: "Read this",
      model: "tts-1",
      voice: "alloy",
    })
  })
})
