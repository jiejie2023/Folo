import { Button } from "@follow/components/ui/button/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { cn } from "@follow/utils/utils"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { CSSProperties } from "react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { getLocalAIIPC, localAIQueryKeys, useLocalAIUsage } from "~/modules/local-ai/hooks"

import { formatTokenCountString } from "../usage/utils"
import type {
  LocalUsageActivityDay,
  LocalUsageActivityMode,
  LocalUsageMonthLabel,
} from "./local-usage-insights"
import {
  buildLocalUsageInsights,
  getActivityLevel,
  getActivityTokenValue,
} from "./local-usage-insights"

const USAGE_QUERY_LIMIT = 500
const ACTIVITY_WEEK_COUNT = 53
const ACTIVITY_MODES: LocalUsageActivityMode[] = ["daily", "weekly", "cumulative"]

export const LocalUsageSection = () => {
  const { t } = useTranslation("ai")
  const queryClient = useQueryClient()
  const { data: usage = [], isLoading } = useLocalAIUsage(USAGE_QUERY_LIMIT)
  const [showAllRecords, setShowAllRecords] = useState(false)
  const [activityMode, setActivityMode] = useState<LocalUsageActivityMode>("daily")
  const insights = useMemo(() => buildLocalUsageInsights(usage), [usage])
  const visibleRecords = showAllRecords ? usage : insights.recentRecords
  const activityDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
      }),
    [],
  )
  const activityValues = useMemo(() => {
    const values = insights.activityDays.map((day) => ({
      day,
      value: getActivityTokenValue(day, insights.activityDays, activityMode),
    }))

    return {
      maxValue: Math.max(...values.map(({ value }) => value), 0),
      valueByDayId: new Map(values.map(({ day, value }) => [day.id, value])),
    }
  }, [activityMode, insights.activityDays])
  const summaryMetrics = useMemo(
    () => [
      {
        label: t("api_management.usage.stats.total_tokens"),
        value: formatTokenCountString(insights.summary.totalTokens),
      },
      {
        label: t("api_management.usage.stats.peak_tokens"),
        value: formatTokenCountString(insights.summary.peakDailyTokens),
      },
      {
        label: t("api_management.usage.stats.requests"),
        value: String(insights.summary.totalRequests),
      },
      {
        label: t("api_management.usage.stats.current_streak"),
        value: t("api_management.usage.days_count", {
          count: insights.summary.currentStreakDays,
        }),
      },
      {
        label: t("api_management.usage.stats.longest_streak"),
        value: t("api_management.usage.days_count", {
          count: insights.summary.longestStreakDays,
        }),
      },
    ],
    [
      insights.summary.currentStreakDays,
      insights.summary.longestStreakDays,
      insights.summary.peakDailyTokens,
      insights.summary.totalRequests,
      insights.summary.totalTokens,
      t,
    ],
  )

  const clearUsageMutation = useMutation({
    mutationFn: () => {
      const localAIIPC = getLocalAIIPC()
      if (!localAIIPC) throw new Error(t("api_management.ipc_unavailable"))
      return localAIIPC.clearUsage()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: localAIQueryKeys.usage(USAGE_QUERY_LIMIT) })
      toast.success(t("api_management.usage.cleared"))
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("api_management.usage.clear_failed"))
    },
  })

  return (
    <div className="min-w-0 max-w-full space-y-3">
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
        <div className="min-w-0 space-y-3">
          <div className="grid min-w-0 max-w-full grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] overflow-hidden rounded-2xl border border-fill-secondary bg-fill-quinary">
            {summaryMetrics.map((metric) => (
              <UsageSummaryMetric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>

          <div className="min-w-0 max-w-full rounded-xl border border-fill-secondary bg-fill-quinary p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text">
                  {t("api_management.usage.activity_title")}
                </div>
                <div className="text-xs text-text-secondary">
                  {t("api_management.usage.activity_description")}
                </div>
              </div>
              <div className="flex rounded-full bg-fill-secondary/70 p-1 text-xs">
                {ACTIVITY_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1 transition-colors",
                      activityMode === mode
                        ? "bg-fill text-text shadow-sm"
                        : "text-text-secondary hover:text-text",
                    )}
                    onClick={() => setActivityMode(mode)}
                  >
                    {t(`api_management.usage.mode.${mode}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 max-w-full overflow-x-auto pb-1">
              <ActivityHeatmap
                ariaLabel={t("api_management.usage.activity_title")}
                activityDays={insights.activityDays}
                formatActivityTitle={(day, value) =>
                  t("api_management.usage.activity_detail", {
                    date: activityDateFormatter.format(day.date),
                    failed: day.failureCount,
                    mode: t(`api_management.usage.mode.${activityMode}`),
                    requests: day.requestCount,
                    tokens: formatTokenCountString(value),
                  })
                }
                formatMonthLabel={(month) =>
                  t("api_management.usage.month_label", {
                    month,
                  })
                }
                maxValue={activityValues.maxValue}
                monthLabels={insights.monthLabels}
                valueByDayId={activityValues.valueByDayId}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-tertiary">
              <div>
                {t("api_management.usage.loaded_hint", {
                  count: usage.length,
                })}
              </div>
              <div className="flex items-center gap-1">
                <span>{t("api_management.usage.activity_less")}</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <span
                    key={level}
                    className={cn("size-3 rounded-[3px]", getActivityCellClassName(level, false))}
                  />
                ))}
                <span>{t("api_management.usage.activity_more")}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-fill-secondary">
            <div className="flex items-center justify-between gap-3 border-b border-fill-secondary p-3">
              <div>
                <div className="text-sm font-medium text-text">
                  {t("api_management.usage.recent_records")}
                </div>
                <div className="text-xs text-text-secondary">
                  {t("api_management.usage.recent_records_description")}
                </div>
              </div>
              {usage.length > insights.recentRecords.length && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAllRecords((value) => !value)}
                >
                  {showAllRecords
                    ? t("api_management.usage.show_less")
                    : t("api_management.usage.show_all", { count: usage.length })}
                </Button>
              )}
            </div>

            <div
              className={cn(
                "divide-y divide-fill-secondary",
                showAllRecords && "max-h-72 overflow-y-auto",
              )}
            >
              {visibleRecords.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between gap-4 p-3 text-xs"
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
          </div>
        </div>
      )}
    </div>
  )
}

const UsageSummaryMetric = ({ label, value }: { label: string; value: string }) => (
  <div className="border-b border-r border-fill-secondary px-3 py-3 text-center last:border-r-0">
    <div className="text-lg font-semibold leading-none text-text">{value}</div>
    <div className="mt-1 text-xs text-text-secondary">{label}</div>
  </div>
)

const ActivityHeatmap = ({
  ariaLabel,
  activityDays,
  formatActivityTitle,
  formatMonthLabel,
  maxValue,
  monthLabels,
  valueByDayId,
}: {
  ariaLabel: string
  activityDays: LocalUsageActivityDay[]
  formatActivityTitle: (day: LocalUsageActivityDay, value: number) => string
  formatMonthLabel: (month: number) => string
  maxValue: number
  monthLabels: LocalUsageMonthLabel[]
  valueByDayId: Map<string, number>
}) => (
  <div className="min-w-max">
    <div className="grid gap-1 pb-2 text-[11px] text-text-tertiary [grid-template-columns:repeat(53,0.75rem)]">
      {monthLabels.map((label) => (
        <span
          key={`${label.month}-${label.weekIndex}`}
          className="whitespace-nowrap"
          style={getMonthLabelStyle(label)}
        >
          {formatMonthLabel(label.month)}
        </span>
      ))}
    </div>
    <div
      aria-label={ariaLabel}
      className="grid grid-flow-col grid-rows-7 gap-1 [grid-auto-columns:0.75rem]"
      role="img"
    >
      {activityDays.map((day) => {
        const value = valueByDayId.get(day.id) ?? day.totalTokens
        const level = getActivityLevel(value, maxValue)

        return (
          <div
            key={day.id}
            className={cn(
              "size-3 rounded-[3px] transition-colors",
              getActivityCellClassName(level, day.failureCount > 0),
            )}
            title={formatActivityTitle(day, value)}
          />
        )
      })}
    </div>
  </div>
)

const activityCellClassNames = [
  "bg-fill-secondary/70",
  "bg-blue/20",
  "bg-blue/30",
  "bg-blue/50",
  "bg-blue/80",
] as const

const getActivityCellClassName = (level: number, hasFailure: boolean): string =>
  cn(
    activityCellClassNames[Math.min(Math.max(level, 0), activityCellClassNames.length - 1)]!,
    level === 0 && hasFailure && "bg-red/10",
    hasFailure && "ring-1 ring-red/40",
  )

const getMonthLabelStyle = (label: LocalUsageMonthLabel): CSSProperties => ({
  gridColumnStart: Math.min(label.weekIndex + 1, ACTIVITY_WEEK_COUNT),
})
