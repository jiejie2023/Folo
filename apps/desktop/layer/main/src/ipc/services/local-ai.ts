import { randomUUID } from "node:crypto"

import type { LocalAIFeature } from "@follow/shared/settings/interface"
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
  updateLocalAIProfileModels,
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
  feature?: LocalAIFeature
  maxTokens?: number
  messages: LocalAIChatMessage[]
  model: string
  profileId: string
  requestId?: string
  responseFormat?: "json_object"
  temperature?: number
}

type LocalAIChatStreamInput = {
  feature?: LocalAIFeature
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

type LocalAIProfileTestResult = {
  message: string
  model: string
  models: string[]
  ok: boolean
  testedAt: string
}

type ResolvedProfile = {
  apiKey: string
  profile: LocalAIStoredProfile
}

export class LocalAIService extends IpcService {
  static override readonly groupName = "localAI"

  private readonly chatStreamControllers = new Map<string, AbortController>()
  private readonly textCompletionControllers = new Map<string, AbortController>()

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
      updateLocalAIProfileModels(profileId, models)
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
  async testProfile(
    _context: IpcContext,
    profileId: string,
    modelOverride?: string | null,
  ): Promise<LocalAIProfileTestResult> {
    let apiKey: string | null = null

    try {
      const resolved = resolveProfile(profileId)
      apiKey = resolved.apiKey

      const models = await listOpenAICompatibleModels({
        apiKey: resolved.apiKey,
        profile: resolved.profile,
      })
      updateLocalAIProfileModels(profileId, models)

      const model =
        modelOverride ??
        resolved.profile.defaultChatModel ??
        models[0] ??
        resolved.profile.models[0]
      if (!model) {
        throw new Error("Local AI profile has no chat model to test")
      }

      await completeOpenAICompatibleText({
        apiKey: resolved.apiKey,
        maxTokens: 4,
        messages: [{ content: "Reply with OK.", role: "user" }],
        model,
        profile: resolved.profile,
        temperature: 0,
      })

      const testedAt = new Date().toISOString()
      const message = `Connection test succeeded with ${model}`
      updateLocalAIProfileTestResult?.(profileId, {
        message,
        ok: true,
        testedAt,
      })

      return {
        message,
        model,
        models,
        ok: true,
        testedAt,
      }
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
    let apiKey: string | null = null
    const feature = input.feature ?? "chat"
    const abortController = input.requestId ? new AbortController() : null
    if (input.requestId && abortController) {
      this.textCompletionControllers.set(input.requestId, abortController)
    }

    try {
      const resolved = resolveProfile(input.profileId)
      apiKey = resolved.apiKey
      if (input.responseFormat === "json_object" && !resolved.profile.supportsJsonMode) {
        throw new Error("Local AI profile does not support JSON mode")
      }

      const result = await completeOpenAICompatibleText({
        abortSignal: abortController?.signal,
        apiKey: resolved.apiKey,
        maxTokens: input.maxTokens,
        messages: input.messages,
        model: input.model,
        profile: resolved.profile,
        responseFormat: input.responseFormat,
        temperature: input.temperature,
      })
      recordUsage({
        feature,
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
        feature,
        model: input.model,
        ok: false,
        profileId: input.profileId,
        totalTokens: null,
      })
      throw new Error(message)
    } finally {
      if (input.requestId) {
        this.textCompletionControllers.delete(input.requestId)
      }
    }
  }

  @IpcMethod()
  stopTextCompletion(_context: IpcContext, requestId: string): void {
    this.textCompletionControllers.get(requestId)?.abort()
    this.textCompletionControllers.delete(requestId)
  }

  @IpcMethod()
  startChatStream(context: IpcContext, input: LocalAIChatStreamInput): { streamId: string } {
    const streamId = `local-ai-stream-${randomUUID()}`
    const abortController = new AbortController()

    this.chatStreamControllers.set(streamId, abortController)
    void this.runChatStream(context, streamId, input, abortController.signal)

    return { streamId }
  }

  @IpcMethod()
  stopChatStream(_context: IpcContext, streamId: string): void {
    this.chatStreamControllers.get(streamId)?.abort()
    this.chatStreamControllers.delete(streamId)
  }

  @IpcMethod()
  async synthesizeSpeech(
    _context: IpcContext,
    input: LocalAISpeechInput,
  ): Promise<LocalAISpeechResult> {
    let apiKey: string | null = null

    try {
      const resolved = resolveProfile(input.profileId)
      apiKey = resolved.apiKey
      if (!resolved.profile.supportsTts) {
        throw new Error("Local AI profile does not support TTS")
      }

      const result = await synthesizeOpenAICompatibleSpeech({
        apiKey: resolved.apiKey,
        format: input.format,
        input: input.input,
        model: input.model,
        profile: resolved.profile,
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
    abortSignal: AbortSignal,
  ): Promise<void> {
    let apiKey: string | null = null
    const feature = input.feature ?? "chat"

    try {
      const resolved = resolveProfile(input.profileId)
      apiKey = resolved.apiKey

      const result = await streamOpenAICompatibleChat({
        abortSignal,
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
        feature,
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
        feature,
        model: input.model,
        ok: false,
        profileId: input.profileId,
        totalTokens: null,
      })
      context.sender.send("local-ai:chat-error", { message, streamId })
    } finally {
      this.chatStreamControllers.delete(streamId)
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
