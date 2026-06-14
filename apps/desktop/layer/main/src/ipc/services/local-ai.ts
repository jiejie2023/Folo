import { randomUUID } from "node:crypto"

import type { IpcContext } from "electron-ipc-decorator"
import { IpcMethod, IpcService } from "electron-ipc-decorator"

import {
  completeOpenAICompatibleText,
  listOpenAICompatibleModels,
  streamOpenAICompatibleChat,
  synthesizeOpenAICompatibleSpeech,
} from "~/lib/local-ai/openai-compatible"
import {
  deleteLocalAIProfile,
  listLocalAIProfiles,
  readLocalAIProfileSecret,
  updateLocalAIProfileTestResult,
  upsertLocalAIProfile,
} from "~/lib/local-ai/profile-store"
import type {
  LocalAIChatMessage,
  LocalAIProfileUpsertInput,
  LocalAIProfileView,
  LocalAIStoredProfile,
  LocalAITextResult,
  LocalAIUsageRecord,
} from "~/lib/local-ai/types"
import { clearLocalAIUsage, listLocalAIUsage, recordLocalAIUsage } from "~/lib/local-ai/usage-store"

type LocalAICompleteTextInput = {
  maxTokens?: number
  messages: LocalAIChatMessage[]
  model: string
  profileId: string
  responseFormat?: "json_object"
  temperature?: number
}

type LocalAIChatStreamInput = {
  maxTokens?: number
  messages: LocalAIChatMessage[]
  model: string
  profileId: string
  temperature?: number
}

type LocalAISpeechInput = {
  format?: string
  input: string
  model: string
  profileId: string
  voice?: string
}

type LocalAISpeechResult = {
  audio: number[]
  mimeType: string
}

type ResolvedProfile = {
  apiKey: string
  profile: LocalAIStoredProfile
}

export class LocalAIService extends IpcService {
  static override readonly groupName = "localAI"

  @IpcMethod()
  listProfiles(_context: IpcContext): LocalAIProfileView[] {
    return listLocalAIProfiles()
  }

  @IpcMethod()
  upsertProfile(_context: IpcContext, input: LocalAIProfileUpsertInput): LocalAIStoredProfile {
    return upsertLocalAIProfile(input)
  }

  @IpcMethod()
  deleteProfile(_context: IpcContext, profileId: string): void {
    deleteLocalAIProfile(profileId)
  }

  @IpcMethod()
  async listModels(_context: IpcContext, profileId: string): Promise<string[]> {
    const { apiKey, profile } = resolveProfile(profileId)

    try {
      const models = await listOpenAICompatibleModels({ apiKey, profile })
      updateLocalAIProfileTestResult?.(profileId, {
        message: `Found ${models.length} models`,
        ok: true,
        testedAt: new Date().toISOString(),
      })
      return models
    } catch (error) {
      const message = sanitizeErrorMessage(error, apiKey)
      updateLocalAIProfileTestResult?.(profileId, {
        message,
        ok: false,
        testedAt: new Date().toISOString(),
      })
      throw new Error(message)
    }
  }

  @IpcMethod()
  async completeText(
    _context: IpcContext,
    input: LocalAICompleteTextInput,
  ): Promise<LocalAITextResult> {
    const { apiKey, profile } = resolveProfile(input.profileId)

    try {
      const result = await completeOpenAICompatibleText({
        apiKey,
        maxTokens: input.maxTokens,
        messages: input.messages,
        model: input.model,
        profile,
        responseFormat: input.responseFormat,
        temperature: input.temperature,
      })
      recordUsage({
        feature: "chat",
        model: input.model,
        ok: true,
        profileId: input.profileId,
        totalTokens: result.totalTokens,
      })
      return result
    } catch (error) {
      const message = sanitizeErrorMessage(error, apiKey)
      recordUsage({
        errorMessage: message,
        feature: "chat",
        model: input.model,
        ok: false,
        profileId: input.profileId,
        totalTokens: null,
      })
      throw new Error(message)
    }
  }

  @IpcMethod()
  startChatStream(context: IpcContext, input: LocalAIChatStreamInput): { streamId: string } {
    const streamId = `local-ai-stream-${randomUUID()}`

    void this.runChatStream(context, streamId, input)

    return { streamId }
  }

  @IpcMethod()
  async synthesizeSpeech(
    _context: IpcContext,
    input: LocalAISpeechInput,
  ): Promise<LocalAISpeechResult> {
    const { apiKey, profile } = resolveProfile(input.profileId)

    try {
      const result = await synthesizeOpenAICompatibleSpeech({
        apiKey,
        format: input.format,
        input: input.input,
        model: input.model,
        profile,
        voice: input.voice,
      })
      recordUsage({
        feature: "tts",
        model: input.model,
        ok: true,
        profileId: input.profileId,
        totalTokens: null,
      })
      return {
        audio: Array.from(result.audio),
        mimeType: result.mimeType,
      }
    } catch (error) {
      const message = sanitizeErrorMessage(error, apiKey)
      recordUsage({
        errorMessage: message,
        feature: "tts",
        model: input.model,
        ok: false,
        profileId: input.profileId,
        totalTokens: null,
      })
      throw new Error(message)
    }
  }

  @IpcMethod()
  listUsage(_context: IpcContext, limit?: number): LocalAIUsageRecord[] {
    return listLocalAIUsage(limit)
  }

  @IpcMethod()
  clearUsage(_context: IpcContext): void {
    clearLocalAIUsage()
  }

  private async runChatStream(
    context: IpcContext,
    streamId: string,
    input: LocalAIChatStreamInput,
  ): Promise<void> {
    let apiKey: string | null = null

    try {
      const resolved = resolveProfile(input.profileId)
      apiKey = resolved.apiKey

      const result = await streamOpenAICompatibleChat({
        apiKey: resolved.apiKey,
        maxTokens: input.maxTokens,
        messages: input.messages,
        model: input.model,
        onDelta: (delta) => {
          context.sender.send("local-ai:chat-delta", { delta, streamId })
        },
        profile: resolved.profile,
        temperature: input.temperature,
      })

      recordUsage({
        feature: "chat",
        model: input.model,
        ok: true,
        profileId: input.profileId,
        totalTokens: result.totalTokens,
      })
      context.sender.send("local-ai:chat-finish", { result, streamId })
    } catch (error) {
      const message = sanitizeErrorMessage(error, apiKey)
      recordUsage({
        errorMessage: message,
        feature: "chat",
        model: input.model,
        ok: false,
        profileId: input.profileId,
        totalTokens: null,
      })
      context.sender.send("local-ai:chat-error", { message, streamId })
    }
  }
}

const resolveProfile = (profileId: string): ResolvedProfile => {
  const profile = listLocalAIProfiles().find((item) => item.id === profileId)
  if (!profile) {
    throw new Error("Local AI profile not found")
  }

  const apiKey = readLocalAIProfileSecret(profileId)
  if (!apiKey) {
    throw new Error("Local AI API key is missing")
  }

  return {
    apiKey,
    profile: toStoredProfile(profile),
  }
}

const toStoredProfile = (profile: LocalAIProfileView): LocalAIStoredProfile => {
  const { maskedApiKey: _maskedApiKey, ...storedProfile } = profile
  return storedProfile
}

const recordUsage = (input: {
  errorMessage?: string
  feature: LocalAIUsageRecord["feature"]
  model: string
  ok: boolean
  profileId: string
  totalTokens: number | null
}): void => {
  recordLocalAIUsage({
    errorMessage: input.errorMessage ?? null,
    feature: input.feature,
    model: input.model,
    ok: input.ok,
    profileId: input.profileId,
    totalTokens: input.totalTokens,
  })
}

const sanitizeErrorMessage = (error: unknown, apiKey: string | null): string => {
  const message = error instanceof Error ? error.message : String(error)
  return apiKey ? message.replaceAll(apiKey, "[redacted]") : message
}
