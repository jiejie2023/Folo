import type {
  LocalAIFeature,
  LocalAIFeatureRouting,
  LocalAIProfileRouting,
  LocalAISettings,
} from "@follow/shared/settings/interface"
import { useQuery } from "@tanstack/react-query"

import { getAISettings, useAISettingValue } from "~/atoms/settings/ai"
import { ipcServices } from "~/lib/client"

export type DesktopLocalAIProfile = {
  baseURL: string
  createdAt: string
  defaultChatModel: string | null
  defaultSummaryModel: string | null
  defaultTaskModel: string | null
  defaultTimelineModel: string | null
  defaultTranslationModel: string | null
  defaultTtsModel: string | null
  enabled: boolean
  headers: Record<string, string>
  id: string
  lastTestResult: {
    message: string
    ok: boolean
    testedAt: string
  } | null
  lastTestedAt: string | null
  maskedApiKey: string | null
  models: string[]
  name: string
  providerType: "openai-compatible"
  supportsJsonMode: boolean
  supportsStreaming: boolean
  supportsTools: boolean
  supportsTts: boolean
  updatedAt: string
}

export type DesktopLocalAIStoredProfile = Omit<DesktopLocalAIProfile, "maskedApiKey">

export type DesktopLocalAIProfileInput = {
  apiKey?: string | null
  baseURL: string
  defaultChatModel: string | null
  defaultSummaryModel: string | null
  defaultTaskModel: string | null
  defaultTimelineModel: string | null
  defaultTranslationModel: string | null
  defaultTtsModel: string | null
  enabled: boolean
  headers: Record<string, string>
  id?: string
  models: string[]
  name: string
  providerType: "openai-compatible"
  supportsJsonMode: boolean
  supportsStreaming: boolean
  supportsTools: boolean
  supportsTts: boolean
}

export type DesktopLocalAIUsageRecord = {
  createdAt: string
  errorMessage: string | null
  feature: string
  id: string
  model: string
  ok: boolean
  profileId: string
  totalTokens: number | null
}

export type DesktopLocalAITextResult = {
  text: string
  totalTokens: number | null
}

export type DesktopLocalAISpeechResult = {
  audio: number[]
  mimeType: string
}

export type DesktopLocalMCPConnection = {
  headers: Record<string, string>
  transportType: "sse" | "streamable-http"
  url: string
}

export type DesktopLocalMCPTool = {
  description?: string
  inputSchema: Record<string, unknown>
  name: string
}

export type DesktopLocalMCPToolCallResult = {
  content: Array<
    | { text: string; type: "text" }
    | {
        type: "json"
        value: unknown
      }
  >
  isError?: boolean
}

export type DesktopLocalAIProfileTestResult = {
  message: string
  model: string
  models: string[]
  modelsWarning?: string
  ok: boolean
  testedAt: string
}

export type DesktopLocalAICompleteTextInput = {
  feature: LocalAIFeature
  maxTokens?: number
  messages: Array<{
    content: string
    name?: string
    role: "assistant" | "system" | "tool" | "user"
    toolCallId?: string
  }>
  model: string
  profileId: string
  requestId?: string
  responseFormat?: "json_object"
  temperature?: number
}

export type DesktopLocalAIIPC = {
  callMCPTool: (
    input: DesktopLocalMCPConnection & {
      arguments: Record<string, unknown>
      name: string
    },
  ) => Promise<DesktopLocalMCPToolCallResult>
  clearUsage: () => Promise<void>
  completeText: (input: DesktopLocalAICompleteTextInput) => Promise<DesktopLocalAITextResult>
  deleteProfile: (profileId: string) => Promise<void>
  listModels: (profileId: string) => Promise<string[]>
  listMCPTools: (input: DesktopLocalMCPConnection) => Promise<DesktopLocalMCPTool[]>
  listProfiles: () => Promise<DesktopLocalAIProfile[]>
  listUsage: (limit?: number) => Promise<DesktopLocalAIUsageRecord[]>
  startChatStream: (input: {
    feature?: LocalAIFeature
    forceStreaming?: boolean
    maxTokens?: number
    mcpServers?: Array<{
      enabled: boolean
      headers?: Record<string, string>
      id: string
      name: string
      transportType: DesktopLocalMCPConnection["transportType"]
      url?: string
    }>
    messages: DesktopLocalAICompleteTextInput["messages"]
    model: string
    profileId: string
    temperature?: number
  }) => Promise<{ streamId: string }>
  stopChatStream?: (streamId: string) => Promise<void>
  stopTextCompletion?: (requestId: string) => Promise<void>
  synthesizeSpeech: (input: {
    format?: string
    input: string
    model: string
    profileId: string
    voice?: string
  }) => Promise<DesktopLocalAISpeechResult>
  testProfile: (
    profileId: string,
    modelOverride?: string | null,
  ) => Promise<DesktopLocalAIProfileTestResult>
  upsertProfile: (input: DesktopLocalAIProfileInput) => Promise<DesktopLocalAIStoredProfile>
}

export const getLocalAIIPC = (): DesktopLocalAIIPC | null =>
  (ipcServices as unknown as { localAI?: DesktopLocalAIIPC } | null)?.localAI ?? null

export const localAIQueryKeys = {
  profiles: ["localAI", "profiles"] as const,
  usage: (limit?: number) => ["localAI", "usage", limit ?? "default"] as const,
}

const LOCAL_AI_RUNTIME_FEATURES = new Set<LocalAIFeature>([
  "chat",
  "summary",
  "translation",
  "timelineRanking",
  "timelineSummary",
  "tts",
  "tasks",
  "mcp",
])

export const canRouteLocalAIFeature = (feature: LocalAIFeature): boolean =>
  LOCAL_AI_RUNTIME_FEATURES.has(feature)

export const resolveLocalAIMode = (
  settings: LocalAISettings,
  feature: LocalAIFeature,
): "cloud" | "local" => {
  const configuredMode = settings.featureRouting[feature] ?? "cloud"
  if (configuredMode === "local" && !canRouteLocalAIFeature(feature)) return "cloud"
  return configuredMode
}

export const resolveLocalAIProfileId = (
  settings: LocalAISettings,
  feature: LocalAIFeature,
): string | null => {
  if (!settings.enabled) return null
  if (resolveLocalAIMode(settings, feature) !== "local") return null
  return settings.featureProfileIds?.[feature] ?? settings.defaultProfileId
}

export type LocalAIModelPurpose = "chat" | "summary" | "tasks" | "timeline" | "translation" | "tts"

type LocalAIModelConfiguration = Pick<
  DesktopLocalAIProfile,
  | "defaultChatModel"
  | "defaultSummaryModel"
  | "defaultTaskModel"
  | "defaultTimelineModel"
  | "defaultTranslationModel"
  | "defaultTtsModel"
  | "models"
>

export const resolveLocalAIProfileModel = (
  profile: LocalAIModelConfiguration,
  purpose: LocalAIModelPurpose,
): string => {
  const normalizedModels = profile.models.map(normalizeLocalAIModelId)
  const modelByPurpose = {
    chat: normalizeOptionalLocalAIModelId(profile.defaultChatModel),
    summary: normalizeOptionalLocalAIModelId(profile.defaultSummaryModel),
    tasks: normalizeOptionalLocalAIModelId(profile.defaultTaskModel),
    timeline: normalizeOptionalLocalAIModelId(profile.defaultTimelineModel),
    translation: normalizeOptionalLocalAIModelId(profile.defaultTranslationModel),
    tts: normalizeOptionalLocalAIModelId(profile.defaultTtsModel),
  } satisfies Record<LocalAIModelPurpose, string | null>

  const hasDiscoveredModels = normalizedModels.length > 0
  const purposeModel = modelByPurpose[purpose]
  const chatModel = modelByPurpose.chat
  if (
    purposeModel &&
    (!hasDiscoveredModels || normalizedModels.includes(purposeModel) || purposeModel !== chatModel)
  ) {
    return purposeModel
  }

  const model =
    chatModel && (!hasDiscoveredModels || normalizedModels.includes(chatModel))
      ? chatModel
      : normalizedModels[0]
  if (!model) {
    throw new Error(`No local AI model is configured for ${purpose}`)
  }
  return model
}

const normalizeLocalAIModelId = (model: string): string => model.trim().replace(/^models\//i, "")

const normalizeOptionalLocalAIModelId = (model: string | null): string | null =>
  model ? normalizeLocalAIModelId(model) : null

export const resolveLocalAITaskModelPurpose = (
  feature: LocalAIFeature,
): Extract<LocalAIModelPurpose, "tasks" | "timeline"> =>
  feature === "timelineSummary" || feature === "timelineRanking" ? "timeline" : "tasks"

export const assertLocalAIProfileEnabled = (profile: Pick<DesktopLocalAIProfile, "enabled">) => {
  if (!profile.enabled) {
    throw new Error("Local AI profile is disabled")
  }
}

const LOCAL_AI_FEATURES: LocalAIFeature[] = [
  "chat",
  "summary",
  "translation",
  "timelineSummary",
  "timelineRanking",
  "onboardingRecommendations",
  "tts",
  "tasks",
  "mcp",
]

const cloneLocalAIProfileRouting = (routing?: LocalAIProfileRouting): LocalAIProfileRouting => ({
  ...routing,
})

export const clearDeletedLocalAIDefaultProfile = (
  settings: LocalAISettings,
  deletedProfileId: string,
): LocalAISettings => {
  let changed = false
  let featureProfileIdsChanged = false
  const featureProfileIds = cloneLocalAIProfileRouting(settings.featureProfileIds)

  for (const feature of LOCAL_AI_FEATURES) {
    if (featureProfileIds[feature] !== deletedProfileId) continue
    featureProfileIds[feature] = null
    changed = true
    featureProfileIdsChanged = true
  }

  const defaultProfileId =
    settings.defaultProfileId === deletedProfileId ? null : settings.defaultProfileId
  if (defaultProfileId !== settings.defaultProfileId) {
    changed = true
  }

  const nextSettings: LocalAISettings = {
    ...settings,
    defaultProfileId,
    ...(settings.featureProfileIds || featureProfileIdsChanged ? { featureProfileIds } : {}),
  }

  const featureRouting = LOCAL_AI_FEATURES.reduce<LocalAIFeatureRouting>(
    (routing, feature) => {
      if (routing[feature] !== "local") return routing
      if (resolveLocalAIProfileId(nextSettings, feature) !== null) return routing
      routing[feature] = "cloud"
      changed = true
      return routing
    },
    { ...settings.featureRouting },
  )

  if (!changed) return settings

  return {
    ...nextSettings,
    featureRouting,
  }
}

export const applySavedLocalAIProfileDefaults = (
  settings: LocalAISettings,
  savedProfileId: string,
): LocalAISettings => {
  if (settings.defaultProfileId !== null) return settings

  return {
    ...settings,
    defaultProfileId: savedProfileId,
    enabled: true,
  }
}

export const resolveLocalAIProfileApiKey = ({
  apiKey,
  isEditing,
  removeApiKey,
}: {
  apiKey: string
  isEditing: boolean
  removeApiKey: boolean
}): string | null | undefined => {
  if (removeApiKey) return null
  const trimmedApiKey = apiKey.trim()
  if (trimmedApiKey) return trimmedApiKey
  return isEditing ? undefined : null
}

export const getLocalAIProfileId = (feature: LocalAIFeature): string | null =>
  resolveLocalAIProfileId(getAISettings().localAI, feature)

export const useLocalAIProfileId = (feature: LocalAIFeature): string | null => {
  const settings = useAISettingValue()
  return resolveLocalAIProfileId(settings.localAI, feature)
}

export const useLocalAIProfiles = () =>
  useQuery({
    queryKey: localAIQueryKeys.profiles,
    queryFn: async (): Promise<DesktopLocalAIProfile[]> => {
      const localAIIPC = getLocalAIIPC()
      if (!localAIIPC) return []
      return localAIIPC.listProfiles()
    },
  })

export const useLocalAIUsage = (limit = 20) =>
  useQuery({
    queryKey: localAIQueryKeys.usage(limit),
    queryFn: async (): Promise<DesktopLocalAIUsageRecord[]> => {
      const localAIIPC = getLocalAIIPC()
      if (!localAIIPC) return []
      return localAIIPC.listUsage(limit)
    },
  })
