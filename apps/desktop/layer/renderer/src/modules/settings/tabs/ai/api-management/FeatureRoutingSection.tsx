import { Label } from "@follow/components/ui/label/index.jsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@follow/components/ui/select/index.js"
import type { LocalAIFeature, LocalAIMode } from "@follow/shared/settings/interface"
import { useTranslation } from "react-i18next"

import { getAISettings, setAISetting, useAISettingValue } from "~/atoms/settings/ai"

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

export const FeatureRoutingSection = () => {
  const { t } = useTranslation("ai")
  const { localAI } = useAISettingValue()
  const hasDefaultProfile = localAI.defaultProfileId !== null

  const updateFeatureMode = (feature: LocalAIFeature, mode: LocalAIMode) => {
    const latest = getAISettings().localAI
    setAISetting("localAI", {
      ...latest,
      featureRouting: {
        ...latest.featureRouting,
        [feature]: mode,
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-sm font-medium text-text">{t("api_management.routing.title")}</Label>
        <p className="text-xs text-text-secondary">
          {hasDefaultProfile
            ? t("api_management.routing.description")
            : t("api_management.routing.no_default_hint")}
        </p>
      </div>

      <div className="space-y-2">
        {FEATURES.map((feature) => (
          <div
            key={feature}
            className="flex items-center justify-between gap-4 rounded-lg border border-fill-secondary p-3"
          >
            <div>
              <div className="text-sm font-medium text-text">
                {t(`api_management.features.${feature}`)}
              </div>
              <div className="text-xs text-text-secondary">
                {t(`api_management.features.${feature}_description`)}
              </div>
            </div>
            <Select
              value={localAI.featureRouting[feature]}
              onValueChange={(value) => updateFeatureMode(feature, value as LocalAIMode)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cloud">{t("api_management.routing.cloud")}</SelectItem>
                <SelectItem value="local" disabled={!hasDefaultProfile}>
                  {t("api_management.routing.local")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  )
}
