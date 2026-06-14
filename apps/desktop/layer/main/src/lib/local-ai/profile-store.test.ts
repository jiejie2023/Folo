import { Buffer } from "node:buffer"

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  deleteLocalAIProfile,
  listLocalAIProfiles,
  maskSecret,
  readLocalAIProfileSecret,
  updateLocalAIProfileModels,
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
    storeGet: vi.fn((key: string) => state.get(key)),
    storeSet: vi.fn((key: string, value: unknown) => {
      state.set(key, value)
    }),
  }
})

vi.mock("electron", () => ({
  safeStorage: mocks.safeStorage,
}))

vi.mock("~/lib/store", () => ({
  store: {
    get: mocks.storeGet,
    set: mocks.storeSet,
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
    mocks.safeStorage.decryptString.mockImplementation((encrypted: Buffer) =>
      encrypted.toString("utf8").replace(/^encrypted:/, ""),
    )
    mocks.safeStorage.encryptString.mockImplementation((secret: string) =>
      Buffer.from(`encrypted:${secret}`, "utf8"),
    )
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(true)
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

  it("strips sensitive headers from stored metadata and list views", () => {
    const profile = upsertLocalAIProfile(
      createInput({
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
          "Proxy-Authorization": "Basic secret",
          "Set-Cookie": "session=secret",
          "CF-Access-Client-Secret": "cloudflare-secret",
          "Helicone-Auth": "helicone-secret",
          "X-Credential": "credential",
          "X-Access-Token": "access-token",
          "X-Api-Key": "api-key",
          "X-Auth-Token": "auth-token",
          "X-Provider-Token": "provider-token",
          "X-Session": "session",
          "X-Public-Header": "public",
          "api-key": "api-key",
        },
      }),
    )

    expect(profile.headers).toEqual({ "X-Public-Header": "public" })
    expect(listLocalAIProfiles()[0]?.headers).toEqual({ "X-Public-Header": "public" })
    expect(mocks.state.get("localAIProfiles")).toEqual([
      expect.objectContaining({
        headers: { "X-Public-Header": "public" },
      }),
    ])
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

  it("updates discovered models without replacing other profile data", () => {
    const created = upsertLocalAIProfile(
      createInput({
        defaultSummaryModel: "summary-model",
        defaultTaskModel: "task-model",
        defaultTimelineModel: "timeline-model",
        defaultTranslationModel: "translation-model",
        defaultTtsModel: "tts-model",
        headers: { "X-Public-Header": "public" },
        supportsJsonMode: false,
        supportsStreaming: false,
        supportsTools: true,
        supportsTts: true,
      }),
    )

    const updated = updateLocalAIProfileModels(created.id, ["gpt-4.1", "gpt-4o-mini"])

    expect(updated).toEqual({
      ...created,
      models: ["gpt-4.1", "gpt-4o-mini"],
      updatedAt: expect.any(String),
    })
    expect(listLocalAIProfiles()[0]).toEqual({
      ...created,
      maskedApiKey: "sk-...3456",
      models: ["gpt-4.1", "gpt-4o-mini"],
      updatedAt: expect.any(String),
    })
    expect(readLocalAIProfileSecret(created.id)).toBe("sk-secret123456")
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

  it("does not write metadata or secrets for a new profile when secret encryption fails", () => {
    mocks.safeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error("encrypt failed")
    })

    expect(() => upsertLocalAIProfile(createInput())).toThrow("encrypt failed")
    expect(mocks.state.get("localAIProfiles")).toBeUndefined()
    expect(mocks.state.get("localAIEncryptedSecrets")).toBeUndefined()
  })

  it("keeps existing metadata and secrets unchanged when update secret encryption fails", () => {
    const created = upsertLocalAIProfile(createInput())
    const profilesBefore = mocks.state.get("localAIProfiles")
    const secretsBefore = mocks.state.get("localAIEncryptedSecrets")

    mocks.safeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error("encrypt failed")
    })

    expect(() =>
      upsertLocalAIProfile(
        createInput({
          apiKey: "sk-new-secret123456",
          id: created.id,
          name: "Should Not Persist",
        }),
      ),
    ).toThrow("encrypt failed")

    expect(mocks.state.get("localAIProfiles")).toEqual(profilesBefore)
    expect(mocks.state.get("localAIEncryptedSecrets")).toEqual(secretsBefore)
    expect(readLocalAIProfileSecret(created.id)).toBe("sk-secret123456")
  })

  it("does not write profile metadata when the secret store write fails", () => {
    mocks.storeSet.mockImplementationOnce((key: string, value: unknown) => {
      if (key === "localAIEncryptedSecrets") {
        throw new Error("secret write failed")
      }
      mocks.state.set(key, value)
    })

    expect(() => upsertLocalAIProfile(createInput())).toThrow("secret write failed")
    expect(mocks.state.get("localAIProfiles")).toBeUndefined()
    expect(mocks.state.get("localAIEncryptedSecrets")).toBeUndefined()
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
