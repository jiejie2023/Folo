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
      listProfiles: vi.fn(async () => []),
      saveProfile: vi.fn(async (input) => ({
        id: input.id ?? "profile-1",
        name: input.name,
        baseURL: input.baseURL,
        defaultModel: input.defaultModel ?? null,
        enabled: input.enabled,
        hasApiKey: !!input.apiKey,
        headers: input.headers,
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      })),
      deleteProfile: vi.fn(async () => {}),
      testProfile: vi.fn(async () => ({ ok: true })),
      listModels: vi.fn(async () => [{ id: "gpt-4o-mini" }]),
      createChatCompletion: vi.fn(async () => ({ content: "hello" })),
      summarizeEntry: vi.fn(async (input) => ({
        entryId: input.entryId,
        summary: "summary",
      })),
      translateEntries: vi.fn(async () => ({})),
      synthesizeSpeech: vi.fn(async () => ({
        audioBase64: "",
        mimeType: "audio/mpeg",
      })),
      runTask: vi.fn(async () => ({ output: "done" })),
      listMCPServers: vi.fn(async () => []),
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({ content: [] })),
    }

    localAIContext.provide(bridge)

    expect(localAI()?.isFeatureEnabled("summary")).toBe(true)
    await expect(localAI()?.listProfiles()).resolves.toEqual([])
    await expect(
      localAI()?.createChatCompletion({
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).resolves.toEqual({ content: "hello" })
    await expect(
      localAI()?.summarizeEntry({
        entryId: "entry-1",
        title: "Title",
        content: "Body",
        target: "content",
        language: "en",
      }),
    ).resolves.toEqual({ entryId: "entry-1", summary: "summary" })
  })
})
