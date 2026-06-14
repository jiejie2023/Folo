import { Button } from "@follow/components/ui/button/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { DesktopLocalAIProfile } from "~/modules/local-ai/hooks"
import { getLocalAIIPC, localAIQueryKeys } from "~/modules/local-ai/hooks"

interface APIProfileItemProps {
  onDelete: (profile: DesktopLocalAIProfile) => void
  onEdit: (profile: DesktopLocalAIProfile) => void
  profile: DesktopLocalAIProfile
}

export const APIProfileItem = ({ onDelete, onEdit, profile }: APIProfileItemProps) => {
  const { t } = useTranslation("ai")
  const queryClient = useQueryClient()
  const [isTesting, setIsTesting] = useState(false)

  const handleListModels = async () => {
    setIsTesting(true)
    try {
      const localAIIPC = getLocalAIIPC()
      if (!localAIIPC) throw new Error(t("api_management.ipc_unavailable"))
      const models = await localAIIPC.listModels(profile.id)
      await queryClient.invalidateQueries({ queryKey: localAIQueryKeys.profiles })
      toast.success(t("api_management.profile.models_loaded", { count: models.length }))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("api_management.profile.models_failed"),
      )
    } finally {
      setIsTesting(false)
    }
  }

  const defaultModel = profile.defaultChatModel ?? profile.models[0] ?? null

  return (
    <div className="rounded-xl border border-fill-secondary bg-fill-quinary p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Label className="truncate text-sm font-medium text-text">{profile.name}</Label>
            <span
              className={
                profile.enabled
                  ? "rounded-full bg-green/10 px-2 py-0.5 text-xs text-green"
                  : "rounded-full bg-fill-secondary px-2 py-0.5 text-xs text-text-secondary"
              }
            >
              {profile.enabled
                ? t("api_management.profile.enabled")
                : t("api_management.profile.disabled")}
            </span>
          </div>
          <div className="truncate text-xs text-text-secondary">{profile.baseURL}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
            <span>
              <span>{t("api_management.profile.masked_key")}: </span>
              <span>{profile.maskedApiKey ?? t("api_management.profile.no_key")}</span>
            </span>
            <span>
              <span>{t("api_management.profile.default_model")}: </span>
              <span>{defaultModel ?? t("api_management.profile.no_model")}</span>
            </span>
            <span>
              {t("api_management.profile.models_count", { count: profile.models.length })}
            </span>
          </div>
          {profile.lastTestResult && (
            <div className={profile.lastTestResult.ok ? "text-xs text-green" : "text-xs text-red"}>
              {profile.lastTestResult.message}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={handleListModels} isLoading={isTesting}>
            {t("api_management.profile.test")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEdit(profile)}>
            <i className="i-mgc-edit-cute-re size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(profile)}>
            <i className="i-mgc-delete-2-cute-re size-4 text-red" />
          </Button>
        </div>
      </div>
    </div>
  )
}
