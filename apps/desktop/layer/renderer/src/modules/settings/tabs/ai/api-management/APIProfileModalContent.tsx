import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { Switch } from "@follow/components/ui/switch/index.jsx"
import type { FormEvent } from "react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { DesktopLocalAIProfile, DesktopLocalAIProfileInput } from "~/modules/local-ai/hooks"

interface APIProfileModalContentProps {
  onCancel: () => void
  onSave: (profile: DesktopLocalAIProfileInput) => void
  profile: DesktopLocalAIProfile | null
}

const parseModels = (value: string): string[] =>
  value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)

export const APIProfileModalContent = ({
  onCancel,
  onSave,
  profile,
}: APIProfileModalContentProps) => {
  const { t } = useTranslation("ai")
  const [name, setName] = useState(profile?.name ?? "")
  const [baseURL, setBaseURL] = useState(profile?.baseURL ?? "")
  const [apiKey, setApiKey] = useState("")
  const [modelsText, setModelsText] = useState(profile?.models.join(", ") ?? "")
  const [defaultChatModel, setDefaultChatModel] = useState(profile?.defaultChatModel ?? "")
  const [defaultSummaryModel, setDefaultSummaryModel] = useState(profile?.defaultSummaryModel ?? "")
  const [defaultTranslationModel, setDefaultTranslationModel] = useState(
    profile?.defaultTranslationModel ?? "",
  )
  const [defaultTimelineModel, setDefaultTimelineModel] = useState(
    profile?.defaultTimelineModel ?? "",
  )
  const [defaultTaskModel, setDefaultTaskModel] = useState(profile?.defaultTaskModel ?? "")
  const [defaultTtsModel, setDefaultTtsModel] = useState(profile?.defaultTtsModel ?? "")
  const [enabled, setEnabled] = useState(profile?.enabled ?? true)
  const [supportsStreaming, setSupportsStreaming] = useState(profile?.supportsStreaming ?? true)
  const [supportsJsonMode, setSupportsJsonMode] = useState(profile?.supportsJsonMode ?? true)
  const [supportsTools, setSupportsTools] = useState(profile?.supportsTools ?? false)
  const [supportsTts, setSupportsTts] = useState(profile?.supportsTts ?? false)

  const modelCount = useMemo(() => parseModels(modelsText).length, [modelsText])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()

    if (!name.trim()) {
      toast.error(t("api_management.profile.validation.name_required"))
      return
    }

    if (!baseURL.trim()) {
      toast.error(t("api_management.profile.validation.base_url_required"))
      return
    }

    try {
      new URL(baseURL.trim())
    } catch {
      toast.error(t("api_management.profile.validation.invalid_url"))
      return
    }

    onSave({
      apiKey: apiKey.trim() || null,
      baseURL: baseURL.trim(),
      defaultChatModel: defaultChatModel.trim() || null,
      defaultSummaryModel: defaultSummaryModel.trim() || null,
      defaultTaskModel: defaultTaskModel.trim() || null,
      defaultTimelineModel: defaultTimelineModel.trim() || null,
      defaultTranslationModel: defaultTranslationModel.trim() || null,
      defaultTtsModel: defaultTtsModel.trim() || null,
      enabled,
      headers: profile?.headers ?? {},
      id: profile?.id,
      models: parseModels(modelsText),
      name: name.trim(),
      providerType: "openai-compatible",
      supportsJsonMode,
      supportsStreaming,
      supportsTools,
      supportsTts,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="min-w-[560px] space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="local-ai-profile-name">{t("api_management.profile.form.name")}</Label>
          <Input
            id="local-ai-profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("api_management.profile.form.name_placeholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="local-ai-profile-base-url">
            {t("api_management.profile.form.base_url")}
          </Label>
          <Input
            id="local-ai-profile-base-url"
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="local-ai-profile-api-key">{t("api_management.profile.form.api_key")}</Label>
        <Input
          id="local-ai-profile-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            profile
              ? t("api_management.profile.form.api_key_edit_placeholder")
              : t("api_management.profile.form.api_key_placeholder")
          }
        />
        <p className="text-xs text-text-secondary">
          {t("api_management.profile.form.api_key_help")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="local-ai-profile-models">{t("api_management.profile.form.models")}</Label>
        <Input
          id="local-ai-profile-models"
          value={modelsText}
          onChange={(event) => setModelsText(event.target.value)}
          placeholder="gpt-4o-mini, qwen2.5, llama3.1"
        />
        <p className="text-xs text-text-secondary">
          {t("api_management.profile.form.models_help", { count: modelCount })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ModelInput
          label={t("api_management.profile.form.default_chat_model")}
          value={defaultChatModel}
          onChange={setDefaultChatModel}
        />
        <ModelInput
          label={t("api_management.profile.form.default_summary_model")}
          value={defaultSummaryModel}
          onChange={setDefaultSummaryModel}
        />
        <ModelInput
          label={t("api_management.profile.form.default_translation_model")}
          value={defaultTranslationModel}
          onChange={setDefaultTranslationModel}
        />
        <ModelInput
          label={t("api_management.profile.form.default_timeline_model")}
          value={defaultTimelineModel}
          onChange={setDefaultTimelineModel}
        />
        <ModelInput
          label={t("api_management.profile.form.default_task_model")}
          value={defaultTaskModel}
          onChange={setDefaultTaskModel}
        />
        <ModelInput
          label={t("api_management.profile.form.default_tts_model")}
          value={defaultTtsModel}
          onChange={setDefaultTtsModel}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-fill-secondary p-3">
        <CapabilitySwitch
          checked={enabled}
          label={t("api_management.profile.form.enabled")}
          onCheckedChange={setEnabled}
        />
        <CapabilitySwitch
          checked={supportsStreaming}
          label={t("api_management.profile.form.supports_streaming")}
          onCheckedChange={setSupportsStreaming}
        />
        <CapabilitySwitch
          checked={supportsJsonMode}
          label={t("api_management.profile.form.supports_json")}
          onCheckedChange={setSupportsJsonMode}
        />
        <CapabilitySwitch
          checked={supportsTools}
          label={t("api_management.profile.form.supports_tools")}
          onCheckedChange={setSupportsTools}
        />
        <CapabilitySwitch
          checked={supportsTts}
          label={t("api_management.profile.form.supports_tts")}
          onCheckedChange={setSupportsTts}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("words.cancel", { ns: "common" })}
        </Button>
        <Button type="submit">{t("words.save", { ns: "common" })}</Button>
      </div>
    </form>
  )
}

const ModelInput = ({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) => (
  <div className="space-y-2">
    <Label className="text-xs text-text">{label}</Label>
    <Input value={value} onChange={(event) => onChange(event.target.value)} />
  </div>
)

const CapabilitySwitch = ({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) => (
  <label className="flex items-center justify-between gap-3 text-sm text-text">
    <span>{label}</span>
    <Switch checked={checked} onCheckedChange={onCheckedChange} />
  </label>
)
