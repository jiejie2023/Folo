import type { UserRole } from "@follow/constants"
import { isFreeRole } from "@follow/constants"
import type { AISettings } from "@follow/shared/settings/interface"

import { getAISettings, useAISettingSelector } from "./ai"

const LOCAL_AI_TRANSLATION_GENERAL_SETTING_KEYS = new Set(["translation", "translationMode"])

export const isLocalAITranslationAccessEnabled = (localAI: AISettings["localAI"]) =>
  localAI.enabled &&
  localAI.featureRouting.translation === "local" &&
  (localAI.featureProfileIds?.translation ?? localAI.defaultProfileId) !== null

export const canLocalAIUnlockGeneralSetting = (key: string, localAI: AISettings["localAI"]) =>
  LOCAL_AI_TRANSLATION_GENERAL_SETTING_KEYS.has(key) && isLocalAITranslationAccessEnabled(localAI)

export const getCanLocalAIUnlockGeneralSetting = (key: string) =>
  canLocalAIUnlockGeneralSetting(key, getAISettings().localAI)

export const useIsLocalAITranslationAccessEnabled = () =>
  useAISettingSelector((settings) => isLocalAITranslationAccessEnabled(settings.localAI))

export const shouldPrefetchAITranslation = ({
  enabled,
  isLocalAITranslationAccessEnabled,
  userRole,
}: {
  enabled: boolean
  isLocalAITranslationAccessEnabled: boolean
  userRole?: UserRole | null
}) => enabled && (!isFreeRole(userRole) || isLocalAITranslationAccessEnabled)
