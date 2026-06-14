import type { LocalAIFeature, LocalAISettings } from "@follow/shared/settings/interface"
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

export type DesktopLocalAICompleteTextInput = {
  maxTokens?: number
  messages: Array<{
    content: string
    name?: string
    role: "assistant" | "system" | "tool" | "user"
    toolCallId?: string
  }>
  model: string
  profileId: string
  responseFormat?: "json_object"
  temperature?: number
}

export type DesktopLocalAIIPC = {
  clearUsage: () => Promise<void>
  completeText: (input: DesktopLocalAICompleteTextInput) => Promise<DesktopLocalAITextResult>
  deleteProfile: (profileId: string) => Promise<void>
  listModels: (profileId: string) => Promise<string[]>
  listProfiles: () => Promise<DesktopLocalAIProfile[]>
  listUsage: (limit?: number) => Promise<DesktopLocalAIUsageRecord[]>
  synthesizeSpeech: (input: {
    format?: string
    input: string
    model: string
    profileId: string
    voice?: string
  }) => Promise<DesktopLocalAISpeechResult>
  upsertProfile: (input: DesktopLocalAIProfileInput) => Promise<DesktopLocalAIProfile>
}

export const getLocalAIIPC = (): DesktopLocalAIIPC | null =>
  (ipcServices as unknown as { localAI?: DesktopLocalAIIPC } | null)?.localAI ?? null

export const localAIQueryKeys = {
  profiles: ["localAI", "profiles"] as const,
  usage: (limit?: number) => ["localAI", "usage", limit ?? "default"] as const,
}

export const resolveLocalAIMode = (
  settings: LocalAISettings,
  feature: LocalAIFeature,
): "cloud" | "local" => settings.featureRouting[feature] ?? "cloud"

export const resolveLocalAIProfileId = (
  settings: LocalAISettings,
  feature: LocalAIFeature,
): string | null => {
  if (!settings.enabled) return null
  if (resolveLocalAIMode(settings, feature) !== "local") return null
  return settings.defaultProfileId
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
