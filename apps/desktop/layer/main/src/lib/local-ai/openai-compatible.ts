import type { LocalAIChatMessage, LocalAIStoredProfile, LocalAITextResult } from "./types"

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

type OpenAICompatibleResponseFormat = "json_object"

type OpenAICompatibleChatRequestMessage = {
  content: string | null
  name?: string
  role: LocalAIChatMessage["role"]
  tool_call_id?: string
  tool_calls?: LocalAIToolCall[]
}

export type LocalAIChatTool = {
  function: {
    description?: string
    name: string
    parameters?: Record<string, unknown>
  }
  type: "function"
}

export type LocalAIToolCall = {
  function: {
    arguments: string
    name: string
  }
  id: string
  type: "function"
}

type ModelListItem = {
  id?: unknown
}

type ModelListResponse = {
  data?: unknown
}

type ChatCompletionResponse = {
  choices?: unknown
  usage?: unknown
}

type ChatChoice = {
  delta?: unknown
  message?: unknown
}

type ChatMessageResponse = {
  content?: unknown
  role?: unknown
  tool_calls?: unknown
}

type ChatDeltaResponse = {
  content?: unknown
}

type UsageResponse = {
  total_tokens?: unknown
}

export const listOpenAICompatibleModels = async ({
  apiKey,
  fetchFn = fetch,
  profile,
}: {
  apiKey: string
  fetchFn?: FetchFn
  profile: LocalAIStoredProfile
}): Promise<string[]> => {
  const response = await fetchFn(buildEndpoint(profile.baseURL, "/models"), {
    headers: buildHeaders(profile, apiKey),
    method: "GET",
  })

  await assertOK(response, apiKey)

  const payload = (await response.json()) as ModelListResponse
  if (!Array.isArray(payload.data)) {
    return []
  }

  return payload.data
    .map((item: unknown) => (isRecord(item) ? (item as ModelListItem).id : undefined))
    .filter((id): id is string => typeof id === "string")
    .map(normalizeOpenAICompatibleModelId)
}

export const completeOpenAICompatibleText = async ({
  abortSignal,
  apiKey,
  fetchFn = fetch,
  maxTokens,
  messages,
  model,
  profile,
  responseFormat,
  temperature,
}: {
  abortSignal?: AbortSignal
  apiKey: string
  fetchFn?: FetchFn
  maxTokens?: number
  messages: LocalAIChatMessage[]
  model: string
  profile: LocalAIStoredProfile
  responseFormat?: OpenAICompatibleResponseFormat
  temperature?: number
}): Promise<LocalAITextResult> => {
  const response = await fetchFn(buildEndpoint(profile.baseURL, "/chat/completions"), {
    body: JSON.stringify(
      compactObject({
        max_tokens: maxTokens,
        messages: serializeMessages(messages),
        model: normalizeOpenAICompatibleModelId(model),
        response_format: responseFormat ? { type: responseFormat } : undefined,
        stream: false,
        temperature,
      }),
    ),
    headers: buildHeaders(profile, apiKey, true),
    method: "POST",
    signal: abortSignal,
  })

  await assertOK(response, apiKey)

  const payload = (await response.json()) as ChatCompletionResponse
  const text = getFirstMessageContent(payload)
  if (text === null) {
    throw new Error("OpenAI-compatible response was malformed: missing message content")
  }

  return {
    text,
    totalTokens: getTotalTokens(payload.usage),
  }
}

export const streamOpenAICompatibleChat = async ({
  abortSignal,
  apiKey,
  callTool,
  fetchFn = fetch,
  forceStreaming = false,
  maxTokens,
  messages,
  model,
  onDelta,
  profile,
  temperature,
  tools,
}: {
  abortSignal?: AbortSignal
  apiKey: string
  callTool?: (toolCall: LocalAIToolCall) => Promise<string>
  fetchFn?: FetchFn
  forceStreaming?: boolean
  maxTokens?: number
  messages: LocalAIChatMessage[]
  model: string
  onDelta: (deltaText: string) => void
  profile: LocalAIStoredProfile
  temperature?: number
  tools?: LocalAIChatTool[]
}): Promise<LocalAITextResult> => {
  let requestMessages: OpenAICompatibleChatRequestMessage[] = serializeMessages(messages)
  let totalTokens: number | null = null

  if (tools?.length && callTool) {
    const planningResponse = await fetchFn(buildEndpoint(profile.baseURL, "/chat/completions"), {
      body: JSON.stringify(
        compactObject({
          max_tokens: maxTokens,
          messages: requestMessages,
          model: normalizeOpenAICompatibleModelId(model),
          stream: false,
          temperature,
          tool_choice: "auto",
          tools,
        }),
      ),
      headers: buildHeaders(profile, apiKey, true),
      method: "POST",
      signal: abortSignal,
    })
    await assertOK(planningResponse, apiKey)

    const planningPayload = (await planningResponse.json()) as ChatCompletionResponse
    totalTokens = getTotalTokens(planningPayload.usage)
    const planningMessage = getFirstResponseMessage(planningPayload)
    const toolCalls = getToolCalls(planningMessage)

    if (toolCalls.length === 0) {
      const text = getMessageContent(planningMessage)
      if (text === null) {
        throw new Error("OpenAI-compatible response was malformed: missing message content")
      }
      if (text) onDelta(text)
      return { text, totalTokens }
    }

    const toolResults = await Promise.all(
      toolCalls.map(
        async (toolCall): Promise<OpenAICompatibleChatRequestMessage> => ({
          content: await executeToolSafely(callTool, toolCall),
          role: "tool",
          tool_call_id: toolCall.id,
        }),
      ),
    )
    requestMessages = [
      ...requestMessages,
      { content: null, role: "assistant", tool_calls: toolCalls },
      ...toolResults,
    ]
  }

  if (!forceStreaming && !profile.supportsStreaming) {
    const response = await fetchFn(buildEndpoint(profile.baseURL, "/chat/completions"), {
      body: JSON.stringify(
        compactObject({
          max_tokens: maxTokens,
          messages: requestMessages,
          model: normalizeOpenAICompatibleModelId(model),
          stream: false,
          temperature,
        }),
      ),
      headers: buildHeaders(profile, apiKey, true),
      method: "POST",
      signal: abortSignal,
    })
    await assertOK(response, apiKey)
    const payload = (await response.json()) as ChatCompletionResponse
    const text = getFirstMessageContent(payload)
    if (text === null) {
      throw new Error("OpenAI-compatible response was malformed: missing message content")
    }
    if (text) onDelta(text)
    const finalTokens = getTotalTokens(payload.usage)
    return {
      text,
      totalTokens:
        totalTokens === null
          ? finalTokens
          : finalTokens === null
            ? totalTokens
            : totalTokens + finalTokens,
    }
  }

  const response = await fetchFn(buildEndpoint(profile.baseURL, "/chat/completions"), {
    body: JSON.stringify(
      compactObject({
        max_tokens: maxTokens,
        messages: requestMessages,
        model: normalizeOpenAICompatibleModelId(model),
        stream: true,
        temperature,
      }),
    ),
    headers: buildHeaders(profile, apiKey, true),
    method: "POST",
    signal: abortSignal,
  })

  await assertOK(response, apiKey)

  if (!response.body) {
    throw new Error("OpenAI-compatible streaming response was malformed: missing body")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let text = ""
  let done = false

  while (!done) {
    const read = await reader.read()
    buffer += decoder.decode(read.value, { stream: !read.done })

    const parsed = drainSSEEvents(buffer)
    buffer = parsed.remaining

    for (const event of parsed.events) {
      if (event === "[DONE]") {
        done = true
        break
      }

      const payload = parseStreamEvent(event)
      const usageTokens = getTotalTokens(payload.usage)
      if (usageTokens !== null) {
        totalTokens = (totalTokens ?? 0) + usageTokens
      }

      for (const delta of getDeltaContents(payload)) {
        text += delta
        onDelta(delta)
      }
    }

    if (read.done) {
      break
    }
  }

  if (isPendingSSEEvent(buffer)) {
    throw new Error("OpenAI-compatible streaming response was malformed: truncated event")
  }

  return { text, totalTokens }
}

export const synthesizeOpenAICompatibleSpeech = async ({
  apiKey,
  fetchFn = fetch,
  format,
  input,
  model,
  profile,
  voice,
}: {
  apiKey: string
  fetchFn?: FetchFn
  format?: string
  input: string
  model: string
  profile: LocalAIStoredProfile
  voice?: string
}): Promise<{ audio: Uint8Array; mimeType: string }> => {
  const response = await fetchFn(buildEndpoint(profile.baseURL, "/audio/speech"), {
    body: JSON.stringify(
      compactObject({
        input,
        model: normalizeOpenAICompatibleModelId(model),
        response_format: format,
        voice,
      }),
    ),
    headers: buildHeaders(profile, apiKey, true),
    method: "POST",
  })

  await assertOK(response, apiKey)

  return {
    audio: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("Content-Type") ?? "application/octet-stream",
  }
}

const buildEndpoint = (baseURL: string, path: string): string =>
  `${baseURL.trim().replace(/\/+$/, "")}${path}`

const normalizeOpenAICompatibleModelId = (model: string): string =>
  model.trim().replace(/^models\//i, "")

const buildHeaders = (
  profile: LocalAIStoredProfile,
  apiKey: string,
  includeJsonContentType = false,
): Record<string, string> => ({
  ...sanitizeProfileHeaders(profile.headers),
  ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
  Authorization: `Bearer ${apiKey}`,
})

const SENSITIVE_HEADER_PARTS = [
  "auth",
  "token",
  "secret",
  "key",
  "cookie",
  "password",
  "credential",
  "session",
]

const sanitizeProfileHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !isSensitiveProfileHeader(name)))

const isSensitiveProfileHeader = (name: string): boolean => {
  const normalized = name.trim().toLowerCase()
  if (normalized === "authorization" || normalized === "proxy-authorization") {
    return true
  }

  const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  return parts.some((part) =>
    SENSITIVE_HEADER_PARTS.some(
      (sensitivePart) => part === sensitivePart || part.includes(sensitivePart),
    ),
  )
}

const serializeMessages = (messages: LocalAIChatMessage[]): OpenAICompatibleChatRequestMessage[] =>
  messages.map((message) =>
    compactObject({
      content: message.content,
      name: message.name,
      role: message.role,
      tool_call_id: message.toolCallId,
    }),
  )

const assertOK = async (response: Response, apiKey: string): Promise<void> => {
  if (response.ok) {
    return
  }

  const detail = sanitizeErrorDetail(await readErrorDetail(response), apiKey)
  const message = detail
    ? `OpenAI-compatible request failed (${response.status} ${response.statusText}): ${detail}`
    : `OpenAI-compatible request failed (${response.status} ${response.statusText})`

  throw new Error(message.trim())
}

const readErrorDetail = async (response: Response): Promise<string | null> => {
  try {
    const payload = (await response.clone().json()) as unknown
    const message = getErrorMessage(payload)
    if (message) {
      return message
    }
  } catch {
    // Fall through to text body.
  }

  try {
    const text = await response.text()
    return text || null
  } catch {
    return null
  }
}

const getErrorMessage = (payload: unknown): string | null => {
  if (!isRecord(payload)) {
    return null
  }

  const { error } = payload
  if (isRecord(error) && typeof error.message === "string") {
    return error.message
  }

  return typeof payload.message === "string" ? payload.message : null
}

const sanitizeErrorDetail = (detail: string | null, apiKey: string): string | null => {
  if (!detail) {
    return null
  }

  return apiKey ? detail.replaceAll(apiKey, "[redacted]") : detail
}

const getFirstMessageContent = (payload: ChatCompletionResponse): string | null => {
  return getMessageContent(getFirstResponseMessage(payload))
}

const getFirstResponseMessage = (payload: ChatCompletionResponse): ChatMessageResponse | null => {
  if (!Array.isArray(payload.choices)) {
    return null
  }

  for (const choice of payload.choices) {
    if (!isRecord(choice)) {
      continue
    }

    const chatChoice = choice as ChatChoice
    if (!isRecord(chatChoice.message)) {
      continue
    }

    return chatChoice.message as ChatMessageResponse
  }

  return null
}

const getMessageContent = (message: ChatMessageResponse | null): string | null =>
  message ? getTextContent(message.content) : null

const getToolCalls = (message: ChatMessageResponse | null): LocalAIToolCall[] => {
  if (!message || !Array.isArray(message.tool_calls)) return []

  return message.tool_calls.filter((value): value is LocalAIToolCall => {
    if (!isRecord(value) || value.type !== "function" || typeof value.id !== "string") return false
    if (!isRecord(value.function)) return false
    return typeof value.function.name === "string" && typeof value.function.arguments === "string"
  })
}

const executeToolSafely = async (
  callTool: (toolCall: LocalAIToolCall) => Promise<string>,
  toolCall: LocalAIToolCall,
): Promise<string> => {
  try {
    return await callTool(toolCall)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Tool execution failed: ${message}`
  }
}

const getDeltaContents = (payload: ChatCompletionResponse): string[] => {
  if (!Array.isArray(payload.choices)) {
    return []
  }

  return payload.choices.flatMap((choice: unknown) => {
    if (!isRecord(choice)) {
      return []
    }

    const chatChoice = choice as ChatChoice
    if (!isRecord(chatChoice.delta)) {
      return []
    }

    const delta = chatChoice.delta as ChatDeltaResponse
    return getTextContentParts(delta.content)
  })
}

const getTextContent = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    const parts = getTextContentParts(value)
    return parts.length > 0 ? parts.join("") : null
  }

  if (isRecord(value) && typeof value.text === "string") {
    return value.text
  }

  return null
}

const getTextContentParts = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value]
  }

  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((part) => {
    if (typeof part === "string") {
      return [part]
    }

    if (isRecord(part) && typeof part.text === "string") {
      return [part.text]
    }

    return []
  })
}

const getTotalTokens = (usage: unknown): number | null => {
  if (!isRecord(usage)) {
    return null
  }

  const { total_tokens: totalTokens } = usage as UsageResponse
  return typeof totalTokens === "number" ? totalTokens : null
}

const parseStreamEvent = (event: string): ChatCompletionResponse => {
  try {
    const payload = JSON.parse(event) as unknown
    if (isRecord(payload)) {
      return payload as ChatCompletionResponse
    }
  } catch {
    throw new Error("OpenAI-compatible streaming response was malformed: invalid JSON event")
  }

  throw new Error("OpenAI-compatible streaming response was malformed: invalid event")
}

const drainSSEEvents = (buffer: string): { events: string[]; remaining: string } => {
  const normalized = buffer.replaceAll("\r\n", "\n")
  const parts = normalized.split("\n\n")
  const remaining = parts.pop() ?? ""

  return {
    events: parts.map(readSSEData).filter((event): event is string => event !== null),
    remaining,
  }
}

const readSSEData = (event: string): string | null => {
  const dataLines = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())

  return dataLines.length > 0 ? dataLines.join("\n").trimEnd() : null
}

const isPendingSSEEvent = (buffer: string): boolean => {
  const trimmed = buffer.trim()
  if (!trimmed) {
    return false
  }

  return trimmed
    .replaceAll("\r\n", "\n")
    .split("\n")
    .some((line) => /^(?:data|event|id|retry):/.test(line))
}

const compactObject = <T extends Record<string, unknown>>(input: T): T => {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined)
  return Object.fromEntries(entries) as T
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
