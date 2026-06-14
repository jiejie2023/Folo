import { Buffer } from "node:buffer"

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  deleteLocalAIProfile,
  listLocalAIProfiles,
  maskSecret,
  readLocalAIProfileSecret,
  upsertLocalAIProfile,
} from "./profile-store"
import type { LocalAIProfileUpsertInput } from "./types"

const mocks = vi.hoisted(() => {
  const state = new Map<string, unknown>()

  return {
    state,
    safeStorage: {
      decryptString: vi.fn((encrypted: Buffer) =>
        encrypted.toString("utf8").replace(/^encrypted:/, ""),
      ),
      encryptString: vi.fn((secret: string) => Buffer.from(`encrypted:${secret}`, "utf8")),
      isEncryptionAvailable: vi.fn(() => true),
    },
  }
})

vi.mock("electron", () => ({
  safeStorage: mocks.safeStorage,
}))

vi.mock("~/lib/store", () => ({
  store: {
    get: vi.fn((key: string) => mocks.state.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      mocks.state.set(key, value)
    }),
  },
}))

const createInput = (
  overrides: Partial<LocalAIProfileUpsertInput> = {},
): LocalAIProfileUpsertInput => ({
  apiKey: "sk-secret123456",
  baseURL: " https://api.example.com/v1/// ",
  defaultChatModel: "gpt-4o",
  defaultSummaryModel: null,
  defaultTaskModel: null,
  defaultTimelineModel: null,
  defaultTranslationModel: null,
  defaultTtsModel: null,
  enabled: true,
  headers: { "X-Test": "yes" },
  models: ["gpt-4o"],
  name: "Local OpenAI",
  providerType: "openai-compatible",
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsTts: false,
  ...overrides,
})

describe("local AI profile store", () => {
  beforeEach(() => {
    mocks.state.clear()
    vi.clearAllMocks()
  })

  it("creates profile metadata and exposes only masked API key in list views", () => {
    const profile = upsertLocalAIProfile(createInput())

    expect(profile.baseURL).toBe("https://api.example.com/v1")
    expect(profile).not.toHaveProperty("apiKey")
    expect(readLocalAIProfileSecret(profile.id)).toBe("sk-secret123456")
    expect(listLocalAIProfiles()).toEqual([
      expect.objectContaining({
        id: profile.id,
        maskedApiKey: "sk-...3456",
        name: "Local OpenAI",
      }),
    ])

    expect(mocks.state.get("localAIProfiles")).toEqual([
      expect.not.objectContaining({ apiKey: expect.any(String) }),
    ])
    expect(mocks.state.get("localAIEncryptedSecrets")).toEqual({
      [profile.id]: expect.stringMatching(/^safe:/),
    })
  })

  it("preserves the existing secret when updating metadata with apiKey undefined", () => {
    const created = upsertLocalAIProfile(createInput())

    const updated = upsertLocalAIProfile(
      createInput({
        apiKey: undefined,
        id: created.id,
        name: "Renamed",
      }),
    )

    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.name).toBe("Renamed")
    expect(readLocalAIProfileSecret(created.id)).toBe("sk-secret123456")
    expect(listLocalAIProfiles()[0]?.maskedApiKey).toBe("sk-...3456")
  })

  it.each([null, ""])("removes the existing secret when apiKey is %s", (apiKey) => {
    const created = upsertLocalAIProfile(createInput())

    upsertLocalAIProfile(createInput({ apiKey, id: created.id }))

    expect(readLocalAIProfileSecret(created.id)).toBeNull()
    expect(listLocalAIProfiles()[0]?.maskedApiKey).toBeNull()
    expect(mocks.state.get("localAIEncryptedSecrets")).toEqual({})
  })

  it("deletes profile metadata and its stored secret", () => {
    const created = upsertLocalAIProfile(createInput())

    deleteLocalAIProfile(created.id)

    expect(listLocalAIProfiles()).toEqual([])
    expect(readLocalAIProfileSecret(created.id)).toBeNull()
    expect(mocks.state.get("localAIEncryptedSecrets")).toEqual({})
  })

  it("decodes text fallback secrets when safeStorage encryption is unavailable", () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    const created = upsertLocalAIProfile(createInput({ apiKey: "short" }))

    expect(mocks.state.get("localAIEncryptedSecrets")).toEqual({
      [created.id]: `text:${Buffer.from("short", "utf8").toString("base64")}`,
    })
    expect(readLocalAIProfileSecret(created.id)).toBe("short")
    expect(listLocalAIProfiles()[0]?.maskedApiKey).toBe("....")
  })

  it("returns null instead of throwing when secret decoding fails", () => {
    const created = upsertLocalAIProfile(createInput())
    mocks.state.set("localAIEncryptedSecrets", { [created.id]: "safe:not-valid-base64" })
    mocks.safeStorage.decryptString.mockImplementationOnce(() => {
      throw new Error("decrypt failed")
    })

    expect(readLocalAIProfileSecret(created.id)).toBeNull()
    expect(listLocalAIProfiles()[0]?.maskedApiKey).toBeNull()
  })

  it("masks short secrets with a safe placeholder", () => {
    const missingSecret = undefined

    expect(maskSecret("tiny")).toBe("....")
    expect(maskSecret(null)).toBeNull()
    expect(maskSecret(missingSecret)).toBeNull()
  })
})
