import type { FeedViewType } from "@follow/constants"
import type { LocalAIFeature } from "@follow/shared/settings/interface"
import { getEntry, getEntryIdsByFeedIds, getEntryIdsByView } from "@follow/store/entry/getter"
import type { ChatTransport, UIMessageChunk } from "ai"

import { getAISettings } from "~/atoms/settings/ai"
import { getActionLanguage } from "~/atoms/settings/general"
import { getAIModelState } from "~/modules/ai-chat/atoms/session"
import type { AIChatContextBlock, BizUIMessage } from "~/modules/ai-chat/store/types"
import { getAIOutputLanguageLabel } from "~/modules/ai-chat/utils/output-language"

import type {
  DesktopLocalAICompleteTextInput,
  DesktopLocalAIIPC,
  DesktopLocalAIProfile,
} from "./hooks"
import {
  assertLocalAIProfileEnabled,
  getLocalAIIPC,
  resolveLocalAIProfileId,
  resolveLocalAIProfileModel,
} from "./hooks"

type LocalAIChatTransportOptions = {
  createCloudTransport: () => ChatTransport<BizUIMessage>
  feature?: LocalAIFeature
  onValue?: (value: UIMessageChunk) => void
}

type SendMessagesOptions = Parameters<ChatTransport<BizUIMessage>["sendMessages"]>[0]

type LocalChatRequest = {
  mcpServers: NonNullable<Parameters<DesktopLocalAIIPC["startChatStream"]>[0]["mcpServers"]>
  messages: DesktopLocalAICompleteTextInput["messages"]
  model: string
  profile: DesktopLocalAIProfile
  profileId: string
  feature: LocalAIFeature
}

type LocalAIChatDeltaPayload = {
  delta: string
  streamId: string
}

type LocalAIChatErrorPayload = {
  message: string
  streamId: string
}

type LocalAIChatFinishPayload = {
  result?: {
    text: string
    totalTokens: number | null
  }
  streamId: string
}

const TEXT_PART_ID = "text-1"
const MAX_CONTEXT_LENGTH = 4000
const MAX_DESCRIPTION_LENGTH = 1000
const MAX_TIMELINE_CONTEXT_ENTRIES = 20
const MAX_TIMELINE_ENTRY_CONTENT_LENGTH = 1200
const DEFAULT_SYSTEM_PROMPT = "You are Folo AI, an RSS reading assistant."

export const createLocalAIChatTransport = (
  options: LocalAIChatTransportOptions,
): ChatTransport<BizUIMessage> => new LocalAIChatTransport(options)

class LocalAIChatTransport implements ChatTransport<BizUIMessage> {
  constructor(private readonly options: LocalAIChatTransportOptions) {}

  async sendMessages(options: SendMessagesOptions): Promise<ReadableStream<UIMessageChunk>> {
    try {
      return await this.sendLocalMessages(options)
    } catch (error) {
      if (error instanceof LocalAIChatSetupError && getAISettings().localAI.allowFallbackToCloud) {
        return this.options.createCloudTransport().sendMessages(options)
      }
      throw error
    }
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  private async sendLocalMessages({
    abortSignal,
    messages,
  }: SendMessagesOptions): Promise<ReadableStream<UIMessageChunk>> {
    const localAIIPC = getLocalAIIPC()
    if (!localAIIPC) {
      throw new LocalAIChatSetupError("Local AI IPC is unavailable")
    }

    const request = await createLocalChatRequest(
      localAIIPC,
      messages,
      this.options.feature ?? "chat",
    )

    if (!request.profile.supportsStreaming && request.mcpServers.length === 0) {
      return createCompleteTextChunkStream({
        abortSignal,
        input: {
          feature: request.feature,
          messages: request.messages,
          model: request.model,
          profileId: request.profileId,
        },
        localAIIPC,
        onValue: this.options.onValue,
      })
    }

    if (!window.electron?.ipcRenderer) {
      throw new LocalAIChatSetupError("Local AI IPC renderer is unavailable")
    }

    const { streamId } = await startLocalChatStream(localAIIPC, {
      feature: request.feature,
      ...(request.mcpServers.length > 0 ? { mcpServers: request.mcpServers } : {}),
      messages: request.messages,
      model: request.model,
      profileId: request.profileId,
    })

    return createIPCChunkStream({
      abortSignal,
      localAIIPC,
      onValue: this.options.onValue,
      streamId,
    })
  }
}

const createLocalChatRequest = async (
  localAIIPC: DesktopLocalAIIPC,
  messages: BizUIMessage[],
  feature: LocalAIFeature,
): Promise<LocalChatRequest> => {
  const aiSettings = getAISettings()
  const settings = aiSettings.localAI
  const profileId = resolveLocalAIProfileId(settings, feature)
  if (!profileId) {
    throw new LocalAIChatSetupError(`Local AI profile is not configured for ${feature}`)
  }

  const profiles = await listProfilesForChat(localAIIPC)
  const profile = profiles.find((item) => item.id === profileId)
  if (!profile) {
    throw new LocalAIChatSetupError("Local AI profile not found")
  }
  try {
    assertLocalAIProfileEnabled(profile)
  } catch (error) {
    throw toSetupError(error)
  }

  let defaultModel: string
  try {
    defaultModel = resolveLocalAIProfileModel(profile, resolveLocalChatModelPurpose(feature))
  } catch (error) {
    throw toSetupError(error)
  }
  const availableModels = createAvailableModels(profile, defaultModel)
  const { selectedModel } = getAIModelState()
  const model =
    selectedModel && availableModels.includes(selectedModel) ? selectedModel : defaultModel

  return {
    messages: buildLocalChatMessages(messages),
    feature,
    model,
    mcpServers:
      profile.supportsTools &&
      aiSettings.mcpEnabled &&
      resolveLocalAIProfileId(settings, "mcp") !== null
        ? aiSettings.mcpServices
            .filter((service) => service.enabled && Boolean(service.url))
            .map((service) => ({
              enabled: service.enabled,
              headers: service.headers,
              id: service.id,
              name: service.name,
              transportType: service.transportType,
              url: service.url,
            }))
        : [],
    profile,
    profileId,
  }
}

const resolveLocalChatModelPurpose = (
  feature: LocalAIFeature,
): Parameters<typeof resolveLocalAIProfileModel>[1] =>
  feature === "timelineSummary" || feature === "timelineRanking" ? "timeline" : "chat"

const createAvailableModels = (profile: DesktopLocalAIProfile, defaultModel: string): string[] => [
  ...new Set([defaultModel, ...profile.models]),
]

const listProfilesForChat = async (
  localAIIPC: DesktopLocalAIIPC,
): Promise<DesktopLocalAIProfile[]> => {
  try {
    return await localAIIPC.listProfiles()
  } catch (error) {
    throw toSetupError(error)
  }
}

const startLocalChatStream = async (
  localAIIPC: DesktopLocalAIIPC,
  input: Parameters<DesktopLocalAIIPC["startChatStream"]>[0],
): ReturnType<DesktopLocalAIIPC["startChatStream"]> => {
  try {
    return await localAIIPC.startChatStream(input)
  } catch (error) {
    throw toSetupError(error)
  }
}

const buildLocalChatMessages = (
  messages: BizUIMessage[],
): DesktopLocalAICompleteTextInput["messages"] => {
  const entryContext = buildEntryContext(messages)
  const localMessages: DesktopLocalAICompleteTextInput["messages"] = []
  let hasConversationText = false
  localMessages.push({
    content: buildSystemPrompt(entryContext),
    role: "system",
  })

  for (const message of messages) {
    const content = extractMessageText(message)
    if (!content) continue

    localMessages.push({
      content,
      role: message.role,
    })
    hasConversationText = true
  }

  if (!hasConversationText) {
    localMessages.push({
      content: "Use the provided context to answer the user.",
      role: "user",
    })
  }

  return localMessages
}

const buildSystemPrompt = (entryContext: string | null): string => {
  const personalizePrompt = getAISettings().personalizePrompt?.trim()
  const actionLanguage = getActionLanguage()
  return [
    DEFAULT_SYSTEM_PROMPT,
    `Output language: ${getAIOutputLanguageLabel(actionLanguage)}. Always answer in this language unless the user explicitly asks for another language.`,
    personalizePrompt ? `User preference:\n${personalizePrompt}` : null,
    entryContext,
  ]
    .filter(Boolean)
    .join("\n\n")
}

const extractMessageText = (message: BizUIMessage): string => {
  const segments: string[] = []

  for (const part of message.parts) {
    switch (part.type) {
      case "text": {
        segments.push(part.text)
        break
      }
      case "data-rich-text": {
        segments.push(part.data.text)
        break
      }
    }
  }

  return segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("\n")
}

const buildEntryContext = (messages: BizUIMessage[]): string | null => {
  const entryIds = new Set<string>()
  const timelineEntryIds = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "data-block") continue

      for (const entryId of resolveTimelineEntryIds(part.data)) {
        timelineEntryIds.add(entryId)
      }

      for (const block of part.data) {
        if (block.type === "mainEntry" && block.value.trim()) {
          entryIds.add(block.value.trim())
        }
      }
    }
  }

  const entryContexts = Array.from(entryIds)
    .map((entryId) => {
      const entry = getEntry(entryId)
      if (!entry) return null

      const lines = [
        `Entry ID: ${entryId}`,
        entry.title ? `Title: ${entry.title}` : null,
        entry.url ? `URL: ${entry.url}` : null,
        entry.description
          ? `Description: ${truncateText(entry.description, MAX_DESCRIPTION_LENGTH)}`
          : null,
        entry.content ? `Content: ${truncateText(entry.content, MAX_CONTEXT_LENGTH)}` : null,
        entry.readabilityContent
          ? `Readable Content: ${truncateText(entry.readabilityContent, MAX_CONTEXT_LENGTH)}`
          : null,
      ].filter(Boolean)

      return lines.join("\n")
    })
    .filter(Boolean)

  const timelineContexts = Array.from(timelineEntryIds)
    .filter((entryId) => !entryIds.has(entryId))
    .slice(0, MAX_TIMELINE_CONTEXT_ENTRIES)
    .map((entryId) => {
      const entry = getEntry(entryId)
      if (!entry) return null

      const lines = [
        `Entry ID: ${entryId}`,
        entry.title ? `Title: ${entry.title}` : null,
        entry.url ? `URL: ${entry.url}` : null,
        entry.feedId ? `Feed ID: ${entry.feedId}` : null,
        entry.publishedAt ? `Published At: ${formatDateForPrompt(entry.publishedAt)}` : null,
        entry.description
          ? `Description: ${truncateText(entry.description, MAX_DESCRIPTION_LENGTH)}`
          : null,
        entry.content
          ? `Content: ${truncateText(entry.content, MAX_TIMELINE_ENTRY_CONTENT_LENGTH)}`
          : null,
        entry.readabilityContent
          ? `Readable Content: ${truncateText(
              entry.readabilityContent,
              MAX_TIMELINE_ENTRY_CONTENT_LENGTH,
            )}`
          : null,
      ].filter(Boolean)

      return lines.join("\n")
    })
    .filter(Boolean)

  const sections: string[] = []

  if (entryContexts.length > 0) {
    sections.push(
      [
        "Current entry context is provided by Folo. Use it when answering the user's question.",
        ...entryContexts,
      ].join("\n\n"),
    )
  }

  if (timelineContexts.length > 0) {
    sections.push(
      [
        "Current timeline context is provided by Folo. Use these RSS entries when summarizing the timeline. Do not claim that the timeline is unavailable when entries are listed below.",
        ...timelineContexts,
      ].join("\n\n"),
    )
  }

  return sections.length > 0 ? sections.join("\n\n") : null
}

const resolveTimelineEntryIds = (blocks: AIChatContextBlock[]): string[] => {
  let explicitEntryIds: string[] = []
  let view: FeedViewType | null = null
  let feedIds: string[] = []
  let unreadOnly = false

  for (const block of blocks) {
    if (block.type === "timelineEntries") {
      explicitEntryIds = block.value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    }

    if (block.type === "mainView") {
      const parsedView = Number(block.value)
      if (Number.isFinite(parsedView)) {
        view = parsedView as FeedViewType
      }
    }

    if (block.type === "mainFeed") {
      feedIds = block.value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    }

    if (block.type === "unreadOnly") {
      unreadOnly = block.value === "true"
    }
  }

  const entryIds =
    explicitEntryIds.length > 0
      ? explicitEntryIds
      : feedIds.length > 0
        ? getEntryIdsByFeedIds(feedIds)
        : view !== null
          ? getEntryIdsByView(view, false)
          : null

  return (entryIds ?? []).filter((entryId) => {
    const entry = getEntry(entryId)
    if (!entry) return false
    return !unreadOnly || entry.read === false
  })
}

const truncateText = (text: string, maxLength: number): string => {
  const normalized = text.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

const formatDateForPrompt = (date: Date | string): string => {
  if (date instanceof Date) return date.toISOString()
  return date
}

const createCompleteTextChunkStream = ({
  abortSignal,
  input,
  localAIIPC,
  onValue,
}: {
  abortSignal?: AbortSignal
  input: DesktopLocalAICompleteTextInput
  localAIIPC: DesktopLocalAIIPC
  onValue?: (value: UIMessageChunk) => void
}): ReadableStream<UIMessageChunk> =>
  new ReadableStream<UIMessageChunk>({
    start(controller) {
      const requestId = createLocalAITextRequestId()
      let closed = false

      const enqueue = (chunk: UIMessageChunk) => {
        if (closed) return
        onValue?.(chunk)
        controller.enqueue(chunk)
      }

      const close = () => {
        if (closed) return
        closed = true
        if (abortSignal) {
          abortSignal.removeEventListener("abort", handleAbort)
        }
        controller.close()
      }

      const handleAbort = () => {
        void localAIIPC.stopTextCompletion?.(requestId)
        enqueue({ reason: "user", type: "abort" })
        close()
      }

      if (abortSignal?.aborted) {
        handleAbort()
        return
      }

      if (abortSignal) {
        abortSignal.addEventListener("abort", handleAbort, { once: true })
      }

      void localAIIPC
        .completeText({
          ...input,
          requestId,
        })
        .then((result) => {
          for (const chunk of createTextChunks(result.text)) {
            enqueue(chunk)
          }
          close()
        })
        .catch((error) => {
          enqueue({ errorText: getErrorMessage(error), type: "error" })
          close()
        })
    },
  })

const createTextChunks = (text: string): UIMessageChunk[] => [
  { type: "start" },
  { type: "start-step" },
  { id: TEXT_PART_ID, type: "text-start" },
  ...(text ? [{ delta: text, id: TEXT_PART_ID, type: "text-delta" } satisfies UIMessageChunk] : []),
  { id: TEXT_PART_ID, type: "text-end" },
  { type: "finish-step" },
  { finishReason: "stop", type: "finish" },
]

const createIPCChunkStream = ({
  abortSignal,
  localAIIPC,
  onValue,
  streamId,
}: {
  abortSignal?: AbortSignal
  localAIIPC: DesktopLocalAIIPC
  onValue?: (value: UIMessageChunk) => void
  streamId: string
}): ReadableStream<UIMessageChunk> =>
  new ReadableStream<UIMessageChunk>({
    start(controller) {
      const cleanups: Array<() => void> = []
      let closed = false
      let hasTextStarted = false

      const cleanup = () => {
        for (const dispose of cleanups.splice(0)) {
          dispose()
        }
      }

      const enqueue = (chunk: UIMessageChunk) => {
        if (closed) return
        onValue?.(chunk)
        controller.enqueue(chunk)
      }

      const close = () => {
        if (closed) return
        closed = true
        cleanup()
        controller.close()
      }

      const ensureTextStarted = () => {
        if (hasTextStarted) return
        enqueue({ type: "start" })
        enqueue({ type: "start-step" })
        enqueue({ id: TEXT_PART_ID, type: "text-start" })
        hasTextStarted = true
      }

      const handleAbort = () => {
        void localAIIPC.stopChatStream?.(streamId)
        enqueue({ reason: "user", type: "abort" })
        close()
      }

      if (abortSignal?.aborted) {
        handleAbort()
        return
      }

      if (!window.electron?.ipcRenderer) {
        enqueue({ errorText: "Local AI IPC renderer is unavailable", type: "error" })
        close()
        return
      }

      cleanups.push(
        window.electron.ipcRenderer.on("local-ai:chat-delta", (_event, payload: unknown) => {
          if (!isDeltaPayload(payload, streamId)) return
          ensureTextStarted()
          enqueue({ delta: payload.delta, id: TEXT_PART_ID, type: "text-delta" })
        }),
        window.electron.ipcRenderer.on("local-ai:chat-error", (_event, payload: unknown) => {
          if (!isErrorPayload(payload, streamId)) return
          enqueue({ errorText: payload.message, type: "error" })
          close()
        }),
        window.electron.ipcRenderer.on("local-ai:chat-finish", (_event, payload: unknown) => {
          if (!isFinishPayload(payload, streamId)) return
          ensureTextStarted()
          enqueue({ id: TEXT_PART_ID, type: "text-end" })
          enqueue({ type: "finish-step" })
          enqueue({ finishReason: "stop", type: "finish" })
          close()
        }),
      )

      if (abortSignal) {
        abortSignal.addEventListener("abort", handleAbort, { once: true })
        cleanups.push(() => abortSignal.removeEventListener("abort", handleAbort))
      }
    },
  })

const isDeltaPayload = (payload: unknown, streamId: string): payload is LocalAIChatDeltaPayload =>
  isRecord(payload) && payload.streamId === streamId && typeof payload.delta === "string"

const isErrorPayload = (payload: unknown, streamId: string): payload is LocalAIChatErrorPayload =>
  isRecord(payload) && payload.streamId === streamId && typeof payload.message === "string"

const isFinishPayload = (payload: unknown, streamId: string): payload is LocalAIChatFinishPayload =>
  isRecord(payload) && payload.streamId === streamId

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

class LocalAIChatSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LocalAIChatSetupError"
  }
}

const toSetupError = (error: unknown): LocalAIChatSetupError =>
  error instanceof LocalAIChatSetupError ? error : new LocalAIChatSetupError(getErrorMessage(error))

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const createLocalAITextRequestId = (): string => {
  const randomUUID = globalThis.crypto?.randomUUID?.()
  if (randomUUID) {
    return `local-ai-text-${randomUUID}`
  }
  return `local-ai-text-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
