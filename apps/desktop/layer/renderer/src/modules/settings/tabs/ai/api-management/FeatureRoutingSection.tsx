import { Label } from "@follow/components/ui/label/index.jsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@follow/components/ui/select/index.js"
import type { LocalAIFeature } from "@follow/shared/settings/interface"
import { useTranslation } from "react-i18next"

import { getAISettings, setAISetting, useAISettingValue } from "~/atoms/settings/ai"
import {
  canRouteLocalAIFeature,
  resolveLocalAIMode,
  resolveLocalAIProfileId,
  useLocalAIProfiles,
} from "~/modules/local-ai/hooks"

const FEATURES: LocalAIFeature[] = [
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

const CLOUD_VALUE = "cloud"
const PROFILE_VALUE_PREFIX = "profile:"

export const FeatureRoutingSection = () => {
  const { t } = useTranslation("ai")
  const { localAI } = useAISettingValue()
  const { data: profiles = [] } = useLocalAIProfiles()
  const hasProfiles = profiles.length > 0

  const updateFeatureTarget = (feature: LocalAIFeature, value: string) => {
    const latest = getAISettings().localAI
    const featureProfileIds = {
      ...latest.featureProfileIds,
    }

    if (value === CLOUD_VALUE) {
      featureProfileIds[feature] = null
      setAISetting("localAI", {
        ...latest,
        featureProfileIds,
        featureRouting: {
          ...latest.featureRouting,
          [feature]: "cloud",
        },
      })
      return
    }

    const profileId = value.startsWith(PROFILE_VALUE_PREFIX)
      ? value.slice(PROFILE_VALUE_PREFIX.length)
      : value

    featureProfileIds[feature] = profileId
    setAISetting("localAI", {
      ...latest,
      featureProfileIds,
      featureRouting: {
        ...latest.featureRouting,
        [feature]: "local",
      },
    })
  }

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="space-y-1">
        <Label className="text-sm font-medium text-text">{t("api_management.routing.title")}</Label>
        <p className="text-xs text-text-secondary">
          {hasProfiles
            ? t("api_management.routing.description")
            : t("api_management.routing.no_default_hint")}
        </p>
      </div>

      <div className="min-w-0 space-y-2">
        {FEATURES.map((feature) => {
          const isLocalRuntimeFeature = canRouteLocalAIFeature(feature)
          const resolvedMode = resolveLocalAIMode(localAI, feature)
          const resolvedProfileId = resolveLocalAIProfileId(localAI, feature)
          const selectedValue =
            resolvedMode === "local" && resolvedProfileId
              ? `${PROFILE_VALUE_PREFIX}${resolvedProfileId}`
              : CLOUD_VALUE

          return (
            <div
              key={feature}
              className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-fill-secondary p-3"
            >
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-text">
                  <span className="min-w-0 truncate">
                    {t(`api_management.features.${feature}`)}
                  </span>
                  <span
                    className={
                      isLocalRuntimeFeature
                        ? "rounded-full bg-green/10 px-2 py-0.5 text-[10px] font-medium text-green"
                        : "rounded-full bg-fill-secondary px-2 py-0.5 text-[10px] font-medium text-text-secondary"
                    }
                  >
                    {isLocalRuntimeFeature
                      ? t("api_management.routing.local_ready")
                      : t("api_management.routing.cloud_managed")}
                  </span>
                </div>
                <div className="text-xs text-text-secondary">
                  {t(`api_management.features.${feature}_description`)}
                </div>
              </div>
              <div className="ml-auto w-[180px] max-w-full shrink-0">
                <Select
                  value={selectedValue}
                  onValueChange={(value) => updateFeatureTarget(feature, value)}
                  disabled={!isLocalRuntimeFeature}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CLOUD_VALUE}>{t("api_management.routing.cloud")}</SelectItem>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={`${PROFILE_VALUE_PREFIX}${profile.id}`}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
