import { randomUUID } from "node:crypto"

import { safeStorage } from "electron"

import { store } from "~/lib/store"

import type {
  LocalAIProfileUpsertInput,
  LocalAIProfileView,
  LocalAIStoredProfile,
  LocalAITestResult,
} from "./types"

const PROFILES_KEY = "localAIProfiles"
const SECRETS_KEY = "localAIEncryptedSecrets"
const SAFE_PREFIX = "safe:"
const TEXT_PREFIX = "text:"
const SENSITIVE_HEADER_NAMES = new Set([
  "api-key",
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-access-token",
  "x-api-key",
  "x-auth-token",
])
const SENSITIVE_HEADER_PARTS = new Set([
  "auth",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "key",
  "password",
  "secret",
  "session",
  "token",
])

export const maskSecret = (secret: string | null | undefined): string | null => {
  if (!secret) {
    return null
  }

  if (secret.length <= 8) {
    return "...."
  }

  return `${secret.slice(0, 3)}...${secret.slice(-4)}`
}

export const listLocalAIProfiles = (): LocalAIProfileView[] =>
  readProfiles().map((profile) => ({
    ...profile,
    maskedApiKey: maskSecret(readLocalAIProfileSecret(profile.id)),
  }))

export const readLocalAIProfileSecret = (profileId: string): string | null => {
  const encoded = readSecrets()[profileId]
  if (!encoded) {
    return null
  }

  try {
    if (encoded.startsWith(SAFE_PREFIX)) {
      const payload = encoded.slice(SAFE_PREFIX.length)
      if (!isBase64Payload(payload)) {
        return null
      }

      const encrypted = Buffer.from(payload, "base64")
      return safeStorage.decryptString(encrypted)
    }

    if (encoded.startsWith(TEXT_PREFIX)) {
      const payload = encoded.slice(TEXT_PREFIX.length)
      if (!isBase64Payload(payload)) {
        return null
      }

      return Buffer.from(payload, "base64").toString("utf8")
    }
  } catch {
    return null
  }

  return null
}

export const upsertLocalAIProfile = (input: LocalAIProfileUpsertInput): LocalAIStoredProfile => {
  const profiles = readProfiles()
  const existing = input.id ? profiles.find((profile) => profile.id === input.id) : undefined
  const now = new Date().toISOString()
  const id = existing?.id ?? input.id ?? randomUUID()
  const nextSecrets = getNextSecrets(id, input.apiKey)

  const profile: LocalAIStoredProfile = {
    baseURL: normalizeBaseURL(input.baseURL),
    createdAt: existing?.createdAt ?? now,
    defaultChatModel: normalizeOptionalModel(input.defaultChatModel),
    defaultSummaryModel: normalizeOptionalModel(input.defaultSummaryModel),
    defaultTaskModel: normalizeOptionalModel(input.defaultTaskModel),
    defaultTimelineModel: normalizeOptionalModel(input.defaultTimelineModel),
    defaultTranslationModel: normalizeOptionalModel(input.defaultTranslationModel),
    defaultTtsModel: normalizeOptionalModel(input.defaultTtsModel),
    enabled: input.enabled,
    headers: sanitizeHeaders(input.headers),
    id,
    lastTestedAt: existing?.lastTestedAt ?? null,
    lastTestResult: existing?.lastTestResult ?? null,
    models: input.models.map(normalizeModelId),
    name: input.name,
    providerType: input.providerType,
    supportsJsonMode: input.supportsJsonMode,
    supportsStreaming: input.supportsStreaming,
    supportsTools: input.supportsTools,
    supportsTts: input.supportsTts,
    updatedAt: now,
  }

  commitProfileAndSecrets(upsertProfile(profiles, profile), nextSecrets)

  return profile
}

export const deleteLocalAIProfile = (profileId: string): void => {
  commitProfileAndSecrets(
    readProfiles().filter((profile) => profile.id !== profileId),
    omitSecret(readSecrets(), profileId),
  )
}

export const updateLocalAIProfileTestResult = (
  profileId: string,
  result: LocalAITestResult,
): LocalAIStoredProfile | null => {
  const profiles = readProfiles()
  const existing = profiles.find((profile) => profile.id === profileId)
  if (!existing) {
    return null
  }

  const updated: LocalAIStoredProfile = {
    ...existing,
    lastTestedAt: result.testedAt,
    lastTestResult: result,
    updatedAt: new Date().toISOString(),
  }

  writeProfiles(upsertProfile(profiles, updated))
  return updated
}

export const updateLocalAIProfileModels = (
  profileId: string,
  models: string[],
): LocalAIStoredProfile | null => {
  const profiles = readProfiles()
  const existing = profiles.find((profile) => profile.id === profileId)
  if (!existing) {
    return null
  }

  const updated: LocalAIStoredProfile = {
    ...existing,
    models: models.map(normalizeModelId),
    updatedAt: new Date().toISOString(),
  }

  writeProfiles(upsertProfile(profiles, updated))
  return updated
}

const normalizeBaseURL = (baseURL: string): string => baseURL.trim().replace(/\/+$/, "")

const normalizeModelId = (model: string): string => model.trim().replace(/^models\//i, "")

const normalizeOptionalModel = (model: string | null): string | null =>
  model ? normalizeModelId(model) : null

const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).filter(([headerName]) => !isSensitiveHeaderName(headerName)),
  )

const isSensitiveHeaderName = (headerName: string): boolean => {
  const normalized = headerName.toLowerCase()
  if (SENSITIVE_HEADER_NAMES.has(normalized)) {
    return true
  }

  if (normalized.includes("apikey") || normalized.includes("api-key")) {
    return true
  }

  return normalized
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((part) => SENSITIVE_HEADER_PARTS.has(part))
}

const sanitizeProfile = (profile: LocalAIStoredProfile): LocalAIStoredProfile => ({
  ...profile,
  defaultChatModel: normalizeOptionalModel(profile.defaultChatModel),
  defaultSummaryModel: normalizeOptionalModel(profile.defaultSummaryModel),
  defaultTaskModel: normalizeOptionalModel(profile.defaultTaskModel),
  defaultTimelineModel: normalizeOptionalModel(profile.defaultTimelineModel),
  defaultTranslationModel: normalizeOptionalModel(profile.defaultTranslationModel),
  defaultTtsModel: normalizeOptionalModel(profile.defaultTtsModel),
  headers: sanitizeHeaders(profile.headers),
  models: profile.models.map(normalizeModelId),
})

const readProfiles = (): LocalAIStoredProfile[] =>
  (store.get(PROFILES_KEY) ?? []).map(sanitizeProfile)

const writeProfiles = (profiles: LocalAIStoredProfile[]): void => {
  store.set(PROFILES_KEY, profiles)
}

const readSecrets = (): Record<string, string> => store.get(SECRETS_KEY) ?? {}

const writeSecrets = (secrets: Record<string, string>): void => {
  store.set(SECRETS_KEY, secrets)
}

const commitProfileAndSecrets = (
  profiles: LocalAIStoredProfile[],
  secrets: Record<string, string>,
): void => {
  const previousSecrets = readSecrets()

  writeSecrets(secrets)
  try {
    writeProfiles(profiles)
  } catch (error) {
    writeSecrets(previousSecrets)
    throw error
  }
}

const upsertProfile = (
  profiles: LocalAIStoredProfile[],
  profile: LocalAIStoredProfile,
): LocalAIStoredProfile[] => {
  const existingIndex = profiles.findIndex((item) => item.id === profile.id)
  if (existingIndex === -1) {
    return [...profiles, profile]
  }

  return profiles.map((item) => (item.id === profile.id ? profile : item))
}

const getNextSecrets = (
  profileId: string,
  apiKey: string | null | undefined,
): Record<string, string> => {
  const secrets = readSecrets()

  if (apiKey === undefined) {
    return secrets
  }

  if (apiKey === null) {
    return omitSecret(secrets, profileId)
  }

  const normalizedSecret = apiKey.trim()
  if (!normalizedSecret) {
    return omitSecret(secrets, profileId)
  }

  return {
    ...secrets,
    [profileId]: encodeSecret(normalizedSecret),
  }
}

const omitSecret = (secrets: Record<string, string>, profileId: string): Record<string, string> => {
  const { [profileId]: _removed, ...remainingSecrets } = secrets
  return remainingSecrets
}

const encodeSecret = (secret: string): string => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(secret)
    return `${SAFE_PREFIX}${encrypted.toString("base64")}`
  }

  return `${TEXT_PREFIX}${Buffer.from(secret, "utf8").toString("base64")}`
}

const isBase64Payload = (payload: string): boolean =>
  payload.length > 0 && payload.length % 4 === 0 && /^[\d+/=A-Z]+$/i.test(payload)
