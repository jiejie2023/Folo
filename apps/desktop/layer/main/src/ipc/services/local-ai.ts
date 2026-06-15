import { randomUUID } from "node:crypto"

import type { LocalAIFeature } from "@follow/shared/settings/interface"
import type { IpcContext } from "electron-ipc-decorator"
import { IpcMethod, IpcService } from "electron-ipc-decorator"

import type { LocalMCPConnectionInput, LocalMCPToolCallResult } from "~/lib/local-ai/mcp-client"
import { callLocalMCPTool, listLocalMCPTools } from "~/lib/local-ai/mcp-client"
import type { LocalAIChatTool, LocalAIToolCall } from "~/lib/local-ai/openai-compatible"
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
  mcpServers?: LocalAIMCPServerInput[]
  messages: LocalAIChatMessage[]
  model: string
  profileId: string
  temperature?: number
}

type LocalAIMCPServerInput = {
  enabled: boolean
  headers?: Record<string, string>
  id: string
  name: string
  transportType: LocalMCPConnectionInput["transportType"]
  url?: string
}

type LocalMCPToolCallIPCInput = LocalMCPConnectionInput & {
  arguments: Record<string, unknown>
  name: string
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
  modelsWarning?: string
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

      const { models, warning: modelsWarning } = await listProfileModelsForTest({
        apiKey: resolved.apiKey,
        profile: resolved.profile,
        profileId,
      })

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
      const message = modelsWarning
        ? `Connection test succeeded with ${model}; model list unavailable`
        : `Connection test succeeded with ${model}`
      updateLocalAIProfileTestResult?.(profileId, {
        message,
        ok: true,
        testedAt,
      })

      return {
        message,
        model,
        models,
        ...(modelsWarning ? { modelsWarning } : {}),
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
  listMCPTools(
    _context: IpcContext,
    input: LocalMCPConnectionInput,
  ): ReturnType<typeof listLocalMCPTools> {
    return listLocalMCPTools(input)
  }

  @IpcMethod()
  callMCPTool(
    _context: IpcContext,
    input: LocalMCPToolCallIPCInput,
  ): ReturnType<typeof callLocalMCPTool> {
    return callLocalMCPTool(input)
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
      const mcpRuntime =
        resolved.profile.supportsTools && input.mcpServers?.some((server) => server.enabled)
          ? await createMCPToolRuntime(input.mcpServers)
          : null

      const result = await streamOpenAICompatibleChat({
        abortSignal,
        apiKey: resolved.apiKey,
        maxTokens: input.maxTokens,
        messages: input.messages,
        model: input.model,
        ...(mcpRuntime
          ? {
              callTool: mcpRuntime.callTool,
              tools: mcpRuntime.tools,
            }
          : {}),
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

const createMCPToolRuntime = async (
  servers: LocalAIMCPServerInput[],
): Promise<{
  callTool: (toolCall: LocalAIToolCall) => Promise<string>
  tools: LocalAIChatTool[]
}> => {
  const bindings = new Map<
    string,
    { server: LocalAIMCPServerInput & { url: string }; toolName: string }
  >()
  const tools: LocalAIChatTool[] = []
  const errors: string[] = []

  for (const server of servers) {
    if (!server.enabled || !server.url) continue
    try {
      const serverTools = await listLocalMCPTools({
        headers: server.headers ?? {},
        transportType: server.transportType,
        url: server.url,
      })
      for (const tool of serverTools) {
        const functionName = createMCPFunctionName(server.id, tool.name, bindings)
        bindings.set(functionName, {
          server: { ...server, url: server.url },
          toolName: tool.name,
        })
        tools.push({
          function: {
            ...(tool.description ? { description: tool.description } : {}),
            name: functionName,
            parameters: tool.inputSchema,
          },
          type: "function",
        })
      }
    } catch (error) {
      errors.push(`${server.name}: ${sanitizeErrorMessage(error, null)}`)
    }
  }

  if (tools.length === 0 && errors.length > 0) {
    throw new Error(`Unable to load MCP tools. ${errors.join("; ")}`)
  }

  return {
    async callTool(toolCall) {
      const binding = bindings.get(toolCall.function.name)
      if (!binding) throw new Error(`Unknown MCP tool: ${toolCall.function.name}`)
      const result = await callLocalMCPTool({
        arguments: parseToolArguments(toolCall.function.arguments),
        headers: binding.server.headers ?? {},
        name: binding.toolName,
        transportType: binding.server.transportType,
        url: binding.server.url,
      })
      return formatMCPToolResult(result)
    },
    tools,
  }
}

const createMCPFunctionName = (
  serverId: string,
  toolName: string,
  bindings: ReadonlyMap<string, unknown>,
): string => {
  const base = `mcp_${serverId}_${toolName}`.replaceAll(/\W/g, "_").slice(0, 60)
  let candidate = base
  let suffix = 2
  while (bindings.has(candidate)) {
    candidate = `${base.slice(0, 60 - String(suffix).length)}_${suffix}`
    suffix += 1
  }
  return candidate
}

const parseToolArguments = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown
    if (isRecord(parsed)) return parsed
  } catch {
    // Handled by the common error below.
  }
  throw new Error("MCP tool arguments must be a JSON object")
}

const formatMCPToolResult = (result: LocalMCPToolCallResult): string => {
  const content = result.content
    .map((item) => (item.type === "text" ? item.text : JSON.stringify(item.value)))
    .filter(Boolean)
    .join("\n")
  return result.isError ? `MCP tool reported an error:\n${content}` : content
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

const listProfileModelsForTest = async ({
  apiKey,
  profile,
  profileId,
}: {
  apiKey: string
  profile: LocalAIStoredProfile
  profileId: string
}): Promise<{ models: string[]; warning?: string }> => {
  try {
    const models = await listOpenAICompatibleModels({ apiKey, profile })
    updateLocalAIProfileModels(profileId, models)
    return { models }
  } catch (error) {
    return {
      models: profile.models,
      warning: sanitizeErrorMessage(error, apiKey),
    }
  }
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
