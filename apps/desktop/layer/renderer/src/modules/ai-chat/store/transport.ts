import { env } from "@follow/shared/env.desktop"
import type { LocalAIFeature } from "@follow/shared/settings/interface"
import type { ChatTransport, HttpChatTransportInitOptions, UIMessageChunk } from "ai"
import { HttpChatTransport, parseJsonEventStream, uiMessageChunkSchema } from "ai"

import { getActionLanguage } from "~/atoms/settings/general"
import { createLocalAIChatTransport } from "~/modules/local-ai/chat-transport"
import { getLocalAIProfileId } from "~/modules/local-ai/hooks"

import { getAIModelState } from "../atoms/session"
import { AIPersistService } from "../services"
import { TIMELINE_SUMMARY_SCENE } from "../utils/timeline-summary"
import type { BizUIMessage } from "./types"

type TitleHandlerPersistOption = boolean | ((title: string) => void | Promise<void>)

export interface TitleHandlerOptions {
  chatId?: string
  shouldHandle?: () => boolean
  onTitleChange?: (title: string) => void
  persist?: TitleHandlerPersistOption
}

export interface CreateChatTransportOptions {
  onValue?: (value: UIMessageChunk) => void
  titleHandler?: TitleHandlerOptions
}

export interface CreateChatTitleHandlerOptions {
  chatId: string
  getActiveChatId: () => string | null | undefined
  onTitleChange?: (title: string) => void
  persist?: TitleHandlerPersistOption
}

export function createChatTitleHandler(
  options: CreateChatTitleHandlerOptions,
): TitleHandlerOptions {
  const { chatId, getActiveChatId, onTitleChange, persist } = options

  return {
    chatId,
    persist,
    onTitleChange,
    shouldHandle: () => getActiveChatId() === chatId,
  }
}

/**
 * Create a chat transport for AI SDK
 * This is used by the AbstractChat instance to communicate with AI providers
 */
export function createChatTransport({ onValue, titleHandler }: CreateChatTransportOptions = {}) {
  const createCloudTransport = () => createCloudChatTransport({ onValue, titleHandler })

  return new RoutedChatTransport({
    createCloudTransport,
    createLocalTransport: (feature) =>
      createLocalAIChatTransport({
        createCloudTransport,
        feature,
        onValue,
      }),
  })
}

type RoutedChatTransportOptions = {
  createCloudTransport: () => ChatTransport<BizUIMessage>
  createLocalTransport: (feature: LocalAIFeature) => ChatTransport<BizUIMessage>
}

class RoutedChatTransport implements ChatTransport<BizUIMessage> {
  constructor(private readonly options: RoutedChatTransportOptions) {}

  sendMessages(options: Parameters<ChatTransport<BizUIMessage>["sendMessages"]>[0]) {
    return this.createCurrentTransport(resolveLocalAITransportFeature(options)).sendMessages(
      options,
    )
  }

  reconnectToStream(options: Parameters<ChatTransport<BizUIMessage>["reconnectToStream"]>[0]) {
    return this.createCurrentTransport("chat").reconnectToStream(options)
  }

  private createCurrentTransport(feature: LocalAIFeature): ChatTransport<BizUIMessage> {
    if (getLocalAIProfileId(feature)) {
      return this.options.createLocalTransport(feature)
    }

    return this.options.createCloudTransport()
  }
}

const LOCAL_AI_FEATURES = new Set<LocalAIFeature>([
  "chat",
  "summary",
  "translation",
  "timelineSummary",
  "timelineRanking",
  "onboardingRecommendations",
  "tts",
  "tasks",
  "mcp",
])

const resolveLocalAITransportFeature = (
  options: Parameters<ChatTransport<BizUIMessage>["sendMessages"]>[0],
): LocalAIFeature => {
  const { body } = options
  if (isRecord(body) && typeof body.localAIFeature === "string") {
    const feature = body.localAIFeature
    if (LOCAL_AI_FEATURES.has(feature as LocalAIFeature)) {
      return feature as LocalAIFeature
    }
  }
  if (isRecord(body) && body.scene === TIMELINE_SUMMARY_SCENE) {
    return "timelineSummary"
  }

  return "chat"
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const createCloudChatTransport = ({ onValue, titleHandler }: CreateChatTransportOptions = {}) =>
  new ExtendChatTransport({
    onValue,
    titleHandler,
    // Custom fetch configuration
    api: `${env.VITE_API_URL}/ai/chat`,
    credentials: "include",
    // Add selected model to request body
    body: () => {
      const modelState = getAIModelState()
      const { selectedModel } = modelState

      return {
        language: getActionLanguage(),
        ...(selectedModel ? { model: selectedModel } : {}),
      }
    },
  })

type UIMessageChunkParseResult =
  ReturnType<typeof parseJsonEventStream<UIMessageChunk>> extends ReadableStream<infer T>
    ? T
    : never

const coerceFinishChunk = (chunk: UIMessageChunkParseResult): UIMessageChunk | null => {
  const { rawValue } = chunk
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return null
  }

  if ((rawValue as { type?: unknown }).type !== "finish") {
    return null
  }

  const { finishReason, messageMetadata } = rawValue as {
    finishReason?: unknown
    messageMetadata?: unknown
  }

  return {
    type: "finish",
    finishReason: typeof finishReason === "string" ? finishReason : undefined,
    messageMetadata,
  } as UIMessageChunk
}

class ExtendChatTransport extends HttpChatTransport<BizUIMessage> {
  constructor(
    private options: HttpChatTransportInitOptions<BizUIMessage> & {
      onValue?: (value: UIMessageChunk) => void
      titleHandler?: TitleHandlerOptions
    },
  ) {
    super(options)
  }

  protected processResponseStream(
    stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  ): ReadableStream<UIMessageChunk> {
    const { onValue } = this.options || {}
    const handleGeneratedTitle = this.handleGeneratedTitle.bind(this)
    return parseJsonEventStream({
      stream,
      schema: uiMessageChunkSchema,
    }).pipeThrough(
      new TransformStream<UIMessageChunkParseResult, UIMessageChunk>({
        async transform(chunk, controller) {
          const parsedChunk = chunk.success ? chunk.value : coerceFinishChunk(chunk)
          if (!parsedChunk) {
            throw chunk.error
          }

          await handleGeneratedTitle(parsedChunk)
          onValue?.(parsedChunk)
          controller.enqueue(parsedChunk)
        },
      }),
    )
  }

  private async handleGeneratedTitle(chunk: UIMessageChunk) {
    const { titleHandler } = this.options
    if (!titleHandler) {
      return
    }

    if (chunk.type !== "data-generated-title" || typeof chunk.data !== "string") {
      return
    }

    const shouldHandle = titleHandler.shouldHandle?.() ?? true
    if (!shouldHandle) {
      return
    }

    titleHandler.onTitleChange?.(chunk.data)

    const persistOption = titleHandler.persist
    const shouldPersist = persistOption === undefined ? true : persistOption

    if (!shouldPersist) {
      return
    }

    try {
      if (typeof persistOption === "function") {
        await persistOption(chunk.data)
        return
      }

      if (titleHandler.chatId) {
        await AIPersistService.updateSessionTitle(titleHandler.chatId, chunk.data)
      }
    } catch (error) {
      console.error("Failed to persist generated title:", error)
    }
  }

  override reconnectToStream(
    options: Parameters<HttpChatTransport<BizUIMessage>["reconnectToStream"]>[0],
  ) {
    options.chatId = encodeURIComponent(options.chatId)
    return super.reconnectToStream(options)
  }
}
