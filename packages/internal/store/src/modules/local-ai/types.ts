import type { LocalAIFeature } from "@follow/shared/settings/interface"

export interface LocalAIProfile {
  id: string
  name: string
  baseURL: string
  defaultModel: string | null
  enabled: boolean
  hasApiKey: boolean
  headers?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface LocalAIProfileInput {
  id?: string
  name: string
  baseURL: string
  apiKey?: string | null
  defaultModel?: string | null
  enabled: boolean
  headers?: Record<string, string>
}

export interface LocalAIModel {
  id: string
  name?: string
  ownedBy?: string
  contextWindow?: number
  supportsTools?: boolean
  supportsVision?: boolean
}

export interface LocalAIModelListInput {
  profileId?: string | null
  refresh?: boolean
}

export interface LocalAIUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface LocalAITextPart {
  type: "text"
  text: string
}

export interface LocalAIImagePart {
  type: "image_url"
  imageUrl: {
    url: string
    detail?: "auto" | "low" | "high"
  }
}

export type LocalAIMessageContent = string | Array<LocalAITextPart | LocalAIImagePart>

export interface LocalAIToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface LocalAIChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: LocalAIMessageContent | null
  name?: string
  toolCallId?: string
  toolCalls?: LocalAIToolCall[]
}

export interface LocalAIChatCompletionInput {
  feature?: LocalAIFeature
  profileId?: string | null
  model?: string | null
  messages: LocalAIChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  tools?: LocalAIToolDefinition[]
  metadata?: Record<string, unknown>
}

export interface LocalAIChatCompletionResult {
  content: string
  model?: string
  usage?: LocalAIUsage
  toolCalls?: LocalAIToolCall[]
  raw?: Record<string, unknown>
}

export interface LocalAISummaryInput {
  profileId?: string | null
  model?: string | null
  entryId: string
  title: string
  content: string
  target: "content" | "readabilityContent"
  language: string
}

export interface LocalAISummaryResult {
  entryId: string
  summary: string
  usage?: LocalAIUsage
}

export interface LocalAITranslationItem {
  entryId: string
  title?: string | null
  description?: string | null
  content?: string | null
  readabilityContent?: string | null
}

export interface LocalAITranslateEntriesInput {
  profileId?: string | null
  model?: string | null
  items: LocalAITranslationItem[]
  language: string
  fields: string
  mode: "bilingual" | "translation-only"
}

export type LocalAITranslationField = "title" | "description" | "content" | "readabilityContent"

export interface LocalAITranslateTextInput {
  profileId?: string | null
  model?: string | null
  field: LocalAITranslationField
  content: string
  language: string
  mode: "bilingual" | "translation-only"
  onDelta?: (delta: string) => void
}

export interface LocalAIStreamTextResult {
  text: string
  usage?: LocalAIUsage
}

export interface LocalAITranslationResult {
  entryId: string
  title: string | null
  description: string | null
  content: string | null
  readabilityContent: string | null
}

export interface LocalAITTSInput {
  profileId?: string | null
  model?: string | null
  text: string
  voice?: string
  format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"
}

export interface LocalAITTSResult {
  audioBase64: string
  mimeType: string
  durationMs?: number
}

export interface LocalAITaskInput {
  feature: LocalAIFeature
  profileId?: string | null
  model?: string | null
  prompt: string
  context?: Record<string, unknown>
}

export interface LocalAITaskResult {
  output: string
  data?: unknown
  usage?: LocalAIUsage
}

export interface LocalAIToolDefinition {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface LocalAIToolDescriptor {
  id: string
  name: string
  description?: string
  serverId?: string
  inputSchema?: Record<string, unknown>
}

export interface LocalAIToolCallInput {
  toolId: string
  serverId?: string
  arguments?: Record<string, unknown>
}

export interface LocalAIToolCallResult {
  content: Array<
    | {
        type: "text"
        text: string
      }
    | {
        type: "json"
        value: unknown
      }
  >
  isError?: boolean
}

export interface LocalAIMCPServer {
  id: string
  name: string
  enabled: boolean
  connected: boolean
  toolCount: number
  lastError?: string
}

export interface LocalAIProfileTestInput {
  profileId?: string | null
  profile?: LocalAIProfileInput
  model?: string | null
}

export interface LocalAIProfileTestResult {
  ok: boolean
  latencyMs?: number
  model?: string
  error?: string
}

export interface LocalAIBridge {
  isFeatureEnabled: (feature: LocalAIFeature) => boolean
  listProfiles: () => Promise<LocalAIProfile[]>
  saveProfile: (input: LocalAIProfileInput) => Promise<LocalAIProfile>
  deleteProfile: (profileId: string) => Promise<void>
  testProfile: (input: LocalAIProfileTestInput) => Promise<LocalAIProfileTestResult>
  listModels: (input?: LocalAIModelListInput) => Promise<LocalAIModel[]>
  createChatCompletion: (input: LocalAIChatCompletionInput) => Promise<LocalAIChatCompletionResult>
  summarizeEntry: (input: LocalAISummaryInput) => Promise<LocalAISummaryResult | null>
  translateEntries: (
    input: LocalAITranslateEntriesInput,
  ) => Promise<Record<string, LocalAITranslationResult | null>>
  streamTranslateText?: (input: LocalAITranslateTextInput) => Promise<LocalAIStreamTextResult>
  synthesizeSpeech: (input: LocalAITTSInput) => Promise<LocalAITTSResult>
  runTask: (input: LocalAITaskInput) => Promise<LocalAITaskResult>
  listMCPServers: () => Promise<LocalAIMCPServer[]>
  listTools: () => Promise<LocalAIToolDescriptor[]>
  callTool: (input: LocalAIToolCallInput) => Promise<LocalAIToolCallResult>
}
