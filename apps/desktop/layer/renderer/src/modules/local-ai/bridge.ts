import type { LocalAIFeature } from "@follow/shared/settings/interface"
import type {
  LocalAIBridge,
  LocalAIChatCompletionInput,
  LocalAIChatCompletionResult,
  LocalAIProfile,
  LocalAIProfileInput,
  LocalAISummaryResult,
  LocalAITaskResult,
  LocalAIToolCallResult,
  LocalAITranslationResult,
  LocalAITTSResult,
  LocalAIUsage,
} from "@follow/store/local-ai/types"

import { getAISettings } from "~/atoms/settings/ai"

import type {
  DesktopLocalAICompleteTextInput,
  DesktopLocalAIProfile,
  DesktopLocalAIProfileInput,
  DesktopLocalAIStoredProfile,
  DesktopLocalAITextResult,
} from "./hooks"
import {
  assertLocalAIProfileEnabled,
  getLocalAIIPC,
  resolveLocalAIProfileId,
  resolveLocalAIProfileModel,
  resolveLocalAITaskModelPurpose,
} from "./hooks"

export const createDesktopLocalAIBridge = (): LocalAIBridge => ({
  isFeatureEnabled(feature) {
    return resolveLocalAIProfileId(getAISettings().localAI, feature) !== null
  },
  async listProfiles() {
    return (await listDesktopProfiles()).map(toSharedProfile)
  },
  async saveProfile(input) {
    const storedProfile = await upsertDesktopProfile(toDesktopProfileInput(input))
    const profile = (await listDesktopProfiles()).find((item) => item.id === storedProfile.id)
    if (!profile) {
      throw new Error("Saved local AI profile could not be reloaded")
    }
    return toSharedProfile(profile)
  },
  async deleteProfile(profileId) {
    await requireLocalAIIPC().deleteProfile(profileId)
  },
  async testProfile(input) {
    const startedAt = Date.now()
    try {
      const profileId = input.profileId ?? input.profile?.id
      if (!profileId) {
        return { error: "Save the profile before testing it.", ok: false }
      }

      const models = await requireLocalAIIPC().listModels(profileId)
      return {
        latencyMs: Date.now() - startedAt,
        model: input.model ?? models[0],
        ok: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
        ok: false,
      }
    }
  },
  async listModels(input) {
    const profileId = input?.profileId ?? getAISettings().localAI.defaultProfileId
    if (!profileId) return []
    const models = await requireLocalAIIPC().listModels(profileId)
    return models.map((model) => ({ id: model, name: model }))
  },
  async createChatCompletion(input) {
    const feature = input.feature ?? "chat"
    const profile = await resolveProfile(input.profileId, feature)
    const model = input.model ?? resolveLocalAIProfileModel(profile, "chat")
    const result = await completeText({
      feature,
      maxTokens: input.maxTokens,
      messages: input.messages.map((message) => ({
        content: stringifyMessageContent(message.content),
        name: message.name,
        role: message.role,
        toolCallId: message.toolCallId,
      })),
      model,
      profileId: profile.id,
      temperature: input.temperature,
    })
    return textResultToCompletion(result, model)
  },
  async summarizeEntry(input) {
    const profile = await resolveProfile(input.profileId, "summary")
    const model = input.model ?? resolveLocalAIProfileModel(profile, "summary")
    const result = await completeText({
      feature: "summary",
      maxTokens: 800,
      messages: [
        {
          content:
            "Summarize the provided entry clearly and concisely. Return only the summary text.",
          role: "system",
        },
        {
          content: `Language: ${input.language}\nTitle: ${input.title}\nContent:\n${input.content}`,
          role: "user",
        },
      ],
      model,
      profileId: profile.id,
      temperature: 0.2,
    })

    const summary = result.text.trim()
    if (!summary) return null
    return {
      entryId: input.entryId,
      summary,
      usage: usageFromTextResult(result),
    } satisfies LocalAISummaryResult
  },
  async translateEntries(input) {
    const profile = await resolveProfile(input.profileId, "translation")
    const model = input.model ?? resolveLocalAIProfileModel(profile, "translation")
    const result = await completeText({
      feature: "translation",
      messages: [
        {
          content:
            "Translate the requested entry fields. Respond with a strict JSON object keyed by entryId. Each value must include title, description, content, and readabilityContent with string or null values.",
          role: "system",
        },
        {
          content: JSON.stringify({
            fields: input.fields,
            items: input.items,
            language: input.language,
            mode: input.mode,
          }),
          role: "user",
        },
      ],
      model,
      profileId: profile.id,
      responseFormat: "json_object",
      temperature: 0.1,
    })
    try {
      return parseTranslationRecord(result.text)
    } catch {
      return {}
    }
  },
  async synthesizeSpeech(input) {
    const profile = await resolveProfile(input.profileId, "tts")
    const model = input.model ?? resolveLocalAIProfileModel(profile, "tts")
    const result = await requireLocalAIIPC().synthesizeSpeech({
      format: input.format,
      input: input.text,
      model,
      profileId: profile.id,
      voice: input.voice,
    })
    return {
      audioBase64: numberArrayToBase64(result.audio),
      mimeType: result.mimeType,
    } satisfies LocalAITTSResult
  },
  async runTask(input) {
    const profile = await resolveProfile(input.profileId, input.feature)
    const model =
      input.model ??
      resolveLocalAIProfileModel(profile, resolveLocalAITaskModelPurpose(input.feature))
    const result = await completeText({
      feature: input.feature,
      messages: [
        {
          content:
            "Run the requested local AI task. Return the useful result directly unless the prompt asks for another format.",
          role: "system",
        },
        {
          content: JSON.stringify({ context: input.context ?? {}, prompt: input.prompt }),
          role: "user",
        },
      ],
      model,
      profileId: profile.id,
      temperature: 0.2,
    })
    return {
      output: result.text,
      usage: usageFromTextResult(result),
    } satisfies LocalAITaskResult
  },
  async listMCPServers() {
    return []
  },
  async listTools() {
    return []
  },
  async callTool() {
    return {
      content: [],
      isError: true,
    } satisfies LocalAIToolCallResult
  },
})

const listDesktopProfiles = async (): Promise<DesktopLocalAIProfile[]> =>
  requireLocalAIIPC().listProfiles()

const upsertDesktopProfile = async (
  input: DesktopLocalAIProfileInput,
): Promise<DesktopLocalAIStoredProfile> => requireLocalAIIPC().upsertProfile(input)

const completeText = async (
  input: DesktopLocalAICompleteTextInput,
): Promise<DesktopLocalAITextResult> => requireLocalAIIPC().completeText(input)

const resolveProfile = async (
  profileId: string | null | undefined,
  feature: LocalAIFeature,
): Promise<DesktopLocalAIProfile> => {
  const resolvedProfileId = profileId ?? resolveLocalAIProfileId(getAISettings().localAI, feature)
  if (!resolvedProfileId) {
    throw new Error("Local AI profile is not configured for this feature")
  }

  const profile = (await listDesktopProfiles()).find((item) => item.id === resolvedProfileId)
  if (!profile) {
    throw new Error("Local AI profile not found")
  }
  assertLocalAIProfileEnabled(profile)
  return profile
}

const toSharedProfile = (profile: DesktopLocalAIProfile): LocalAIProfile => ({
  baseURL: profile.baseURL,
  createdAt: profile.createdAt,
  defaultModel: profile.defaultChatModel,
  enabled: profile.enabled,
  hasApiKey: typeof profile.maskedApiKey === "string",
  headers: profile.headers,
  id: profile.id,
  name: profile.name,
  updatedAt: profile.updatedAt,
})

const toDesktopProfileInput = (input: LocalAIProfileInput): DesktopLocalAIProfileInput => ({
  apiKey: input.apiKey,
  baseURL: input.baseURL,
  defaultChatModel: input.defaultModel ?? null,
  defaultSummaryModel: input.defaultModel ?? null,
  defaultTaskModel: input.defaultModel ?? null,
  defaultTimelineModel: input.defaultModel ?? null,
  defaultTranslationModel: input.defaultModel ?? null,
  defaultTtsModel: input.defaultModel ?? null,
  enabled: input.enabled,
  headers: input.headers ?? {},
  id: input.id,
  models: input.defaultModel ? [input.defaultModel] : [],
  name: input.name,
  providerType: "openai-compatible",
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsTts: false,
})

const stringifyMessageContent = (
  content: LocalAIChatCompletionInput["messages"][number]["content"],
): string => {
  if (typeof content === "string") return content
  if (!content) return ""
  return content
    .map((part) => (part.type === "text" ? part.text : `[Image: ${part.imageUrl.url}]`))
    .join("\n")
}

const textResultToCompletion = (
  result: DesktopLocalAITextResult,
  model: string,
): LocalAIChatCompletionResult => ({
  content: result.text,
  model,
  usage: usageFromTextResult(result),
})

const usageFromTextResult = (result: DesktopLocalAITextResult): LocalAIUsage | undefined =>
  result.totalTokens === null
    ? undefined
    : {
        totalTokens: result.totalTokens,
      }

const parseTranslationRecord = (text: string): Record<string, LocalAITranslationResult | null> => {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) return {}

  const entries: Array<[string, LocalAITranslationResult | null]> = []
  for (const [entryId, value] of Object.entries(parsed)) {
    if (value === null) {
      entries.push([entryId, null])
      continue
    }
    if (isTranslationResult(value)) {
      entries.push([entryId, { ...value, entryId }])
    }
  }
  return Object.fromEntries(entries)
}

const isTranslationResult = (value: unknown): value is LocalAITranslationResult => {
  if (!isRecord(value)) return false
  return (
    isNullableString(value.title) &&
    isNullableString(value.description) &&
    isNullableString(value.content) &&
    isNullableString(value.readabilityContent)
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNullableString = (value: unknown): value is string | null =>
  typeof value === "string" || value === null

const numberArrayToBase64 = (bytes: number[]): string => {
  const chunkSize = 0x8000
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize)
    chunks.push(String.fromCodePoint(...chunk))
  }
  return btoa(chunks.join(""))
}

const requireLocalAIIPC = () => {
  const localAIIPC = getLocalAIIPC()
  if (!localAIIPC) {
    throw new Error("Local AI IPC is unavailable")
  }
  return localAIIPC
}
