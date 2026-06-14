import { Button } from "@follow/components/ui/button/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@follow/components/ui/select/index.js"
import { Switch } from "@follow/components/ui/switch/index.jsx"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { getAISettings, setAISetting, useAISettingValue } from "~/atoms/settings/ai"
import { useDialog, useModalStack } from "~/components/ui/modal/stacked/hooks"
import type { DesktopLocalAIProfile, DesktopLocalAIProfileInput } from "~/modules/local-ai/hooks"
import { getLocalAIIPC, localAIQueryKeys, useLocalAIProfiles } from "~/modules/local-ai/hooks"

import { APIProfileItem } from "./APIProfileItem"
import { APIProfileModalContent } from "./APIProfileModalContent"

const NO_PROFILE_VALUE = "__none__"

export const APIManagementSection = () => {
  const { t } = useTranslation("ai")
  const { localAI } = useAISettingValue()
  const { data: profiles = [], isLoading } = useLocalAIProfiles()
  const queryClient = useQueryClient()
  const { ask } = useDialog()
  const { present } = useModalStack()

  const upsertProfileMutation = useMutation({
    mutationFn: (profile: DesktopLocalAIProfileInput) => {
      const localAIIPC = getLocalAIIPC()
      if (!localAIIPC) throw new Error(t("api_management.ipc_unavailable"))
      return localAIIPC.upsertProfile(profile)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: localAIQueryKeys.profiles })
      toast.success(t("api_management.profile.saved"))
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("api_management.profile.save_failed"))
    },
  })

  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: string) => {
      const localAIIPC = getLocalAIIPC()
      if (!localAIIPC) throw new Error(t("api_management.ipc_unavailable"))
      return localAIIPC.deleteProfile(profileId)
    },
    onSuccess: async (_result, profileId) => {
      const latestSettings = getAISettings().localAI
      if (latestSettings.defaultProfileId === profileId) {
        setAISetting("localAI", {
          ...latestSettings,
          defaultProfileId: null,
        })
      }
      await queryClient.invalidateQueries({ queryKey: localAIQueryKeys.profiles })
      toast.success(t("api_management.profile.deleted"))
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("api_management.profile.delete_failed"),
      )
    },
  })

  const updateLocalAI = (updates: Partial<typeof localAI>) => {
    setAISetting("localAI", {
      ...getAISettings().localAI,
      ...updates,
    })
  }

  const openProfileModal = (profile: DesktopLocalAIProfile | null) => {
    present({
      title: profile
        ? t("api_management.profile.edit_title")
        : t("api_management.profile.add_title"),
      content: ({ dismiss }: { dismiss: () => void }) => (
        <APIProfileModalContent
          profile={profile}
          onCancel={dismiss}
          onSave={(input) => {
            upsertProfileMutation.mutate(input)
            dismiss()
          }}
        />
      ),
    })
  }

  const handleDeleteProfile = async (profile: DesktopLocalAIProfile) => {
    const confirmed = await ask({
      title: t("api_management.profile.delete_title"),
      message: t("api_management.profile.delete_message", { name: profile.name }),
      confirmText: t("words.delete", { ns: "common" }),
      cancelText: t("words.cancel", { ns: "common" }),
      variant: "danger",
    })

    if (confirmed) {
      deleteProfileMutation.mutate(profile.id)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium text-text">{t("api_management.enabled")}</Label>
          <p className="text-xs text-text-secondary">{t("api_management.description")}</p>
        </div>
        <Switch
          checked={localAI.enabled}
          onCheckedChange={(enabled) => updateLocalAI({ enabled })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium text-text">{t("api_management.fallback")}</Label>
          <p className="text-xs text-text-secondary">{t("api_management.fallback_description")}</p>
        </div>
        <Switch
          checked={localAI.allowFallbackToCloud}
          onCheckedChange={(allowFallbackToCloud) => updateLocalAI({ allowFallbackToCloud })}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-text">
          {t("api_management.default_profile")}
        </Label>
        <Select
          value={localAI.defaultProfileId ?? NO_PROFILE_VALUE}
          onValueChange={(value) =>
            updateLocalAI({ defaultProfileId: value === NO_PROFILE_VALUE ? null : value })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={t("api_management.no_default_profile")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROFILE_VALUE}>
              {t("api_management.no_default_profile")}
            </SelectItem>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-text">{t("api_management.profiles")}</Label>
        <Button variant="outline" size="sm" onClick={() => openProfileModal(null)}>
          <i className="i-mgc-add-cute-re mr-2 size-4" />
          {t("api_management.add_profile")}
        </Button>
      </div>

      {profiles.length === 0 && !isLoading ? (
        <div className="py-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-fill-secondary">
            <i className="i-mgc-key-2-cute-re size-6 text-text" />
          </div>
          <h4 className="mb-1 text-sm font-medium text-text">{t("api_management.empty.title")}</h4>
          <p className="text-xs text-text-secondary">{t("api_management.empty.description")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => (
            <APIProfileItem
              key={profile.id}
              profile={profile}
              onEdit={openProfileModal}
              onDelete={handleDeleteProfile}
            />
          ))}
        </div>
      )}
    </div>
  )
}
