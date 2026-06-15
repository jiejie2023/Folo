import type { ConfigResponse } from "@follow-app/client-sdk"
import { useQuery } from "@tanstack/react-query"

import { useAISettingValue } from "~/atoms/settings/ai"
import { followApi } from "~/lib/api-client"
import type { DesktopLocalAIProfile } from "~/modules/local-ai/hooks"
import {
  assertLocalAIProfileEnabled,
  getLocalAIIPC,
  resolveLocalAIProfileId,
  resolveLocalAIProfileModel,
  useLocalAIProfiles,
} from "~/modules/local-ai/hooks"

export const useAIConfiguration = () => {
  const aiSettings = useAISettingValue()
  const localChatProfileId = resolveLocalAIProfileId(aiSettings.localAI, "chat")
  const { allowFallbackToCloud } = aiSettings.localAI
  const localProfilesQuery = useLocalAIProfiles()
  const localChatProfile = localChatProfileId
    ? localProfilesQuery.data?.find((profile) => profile.id === localChatProfileId)
    : null
  const localChatProfileSignature = localChatProfile
    ? createProfileSignature(localChatProfile)
    : (localChatProfileId ?? "cloud")

  return useQuery({
    enabled: !localChatProfileId || localProfilesQuery.isFetched,
    queryKey: [
      "aiConfiguration",
      localChatProfileId ?? "cloud",
      allowFallbackToCloud,
      localChatProfileSignature,
    ],
    queryFn: async () => {
      if (localChatProfileId) {
        try {
          return await getLocalAIChatConfiguration(localChatProfileId, localProfilesQuery.data)
        } catch (error) {
          if (allowFallbackToCloud) {
            return followApi.ai.config()
          }
          throw error
        }
      }
      return followApi.ai.config()
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

const getLocalAIChatConfiguration = async (
  profileId: string,
  profiles?: DesktopLocalAIProfile[],
): Promise<ConfigResponse> => {
  const profile = profiles?.find((item) => item.id === profileId) ?? (await getProfile(profileId))
  if (!profile) {
    throw new Error("Local AI profile not found")
  }
  assertLocalAIProfileEnabled(profile)

  const defaultModel = resolveLocalAIProfileModel(profile, "chat")
  const availableModels = createAvailableModels(profile, defaultModel)

  return {
    attachmentLimits: {
      maxFiles: 0,
      remainingFiles: 0,
      windowDuration: 0,
      windowResetTime: 0,
    },
    availableModels,
    availableModelsMenu: availableModels.map((model) => ({
      label: model,
      value: model,
    })),
    defaultModel,
    freeQuota: {
      dailyLimit: 0,
      monthlyLimit: 0,
      remainingMonthlyRequests: 0,
      remainingRequests: 0,
      role: "local",
      shouldCheckDailyLimit: false,
    },
    rateLimit: {
      currentTokens: 0,
      maxTokens: 0,
      remainingTokens: 0,
      warningLevel: "safe",
      windowDuration: 0,
      windowResetTime: 0,
    },
    usage: {
      remaining: 0,
      resetAt: new Date(0),
      total: 0,
      used: 0,
    },
  }
}

const createAvailableModels = (profile: DesktopLocalAIProfile, defaultModel: string): string[] => [
  ...new Set([defaultModel, ...profile.models]),
]

const getProfile = async (profileId: string): Promise<DesktopLocalAIProfile | undefined> => {
  const localAIIPC = getLocalAIIPC()
  if (!localAIIPC) {
    throw new Error("Local AI IPC is unavailable")
  }
  return (await localAIIPC.listProfiles()).find((item) => item.id === profileId)
}

const createProfileSignature = (profile: DesktopLocalAIProfile): string =>
  [
    profile.updatedAt,
    profile.defaultChatModel,
    profile.models.join(","),
    String(profile.enabled),
  ].join("|")
