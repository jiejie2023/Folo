import { Button } from "@follow/components/ui/button/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { getLocalAIIPC, localAIQueryKeys, useLocalAIUsage } from "~/modules/local-ai/hooks"

export const LocalUsageSection = () => {
  const { t } = useTranslation("ai")
  const queryClient = useQueryClient()
  const { data: usage = [], isLoading } = useLocalAIUsage(20)

  const clearUsageMutation = useMutation({
    mutationFn: () => {
      const localAIIPC = getLocalAIIPC()
      if (!localAIIPC) throw new Error(t("api_management.ipc_unavailable"))
      return localAIIPC.clearUsage()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: localAIQueryKeys.usage(20) })
      toast.success(t("api_management.usage.cleared"))
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("api_management.usage.clear_failed"))
    },
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium text-text">{t("api_management.usage.title")}</Label>
          <p className="text-xs text-text-secondary">{t("api_management.usage.description")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={usage.length === 0}
          isLoading={clearUsageMutation.isPending}
          onClick={() => clearUsageMutation.mutate()}
        >
          {t("api_management.usage.clear")}
        </Button>
      </div>

      {usage.length === 0 && !isLoading ? (
        <div className="rounded-xl border border-fill-secondary py-6 text-center text-xs text-text-secondary">
          {t("api_management.usage.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {usage.map((record) => (
            <div
              key={record.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-fill-secondary p-3 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-text">
                  {record.feature} - {record.model}
                </div>
                <div className="text-text-secondary">
                  {new Date(record.createdAt).toLocaleString()}
                </div>
                {record.errorMessage && (
                  <div className="truncate text-red">{record.errorMessage}</div>
                )}
              </div>
              <div className={record.ok ? "text-green" : "text-red"}>
                {record.ok
                  ? t("api_management.usage.ok", {
                      tokens: record.totalTokens ?? 0,
                    })
                  : t("api_management.usage.failed")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
