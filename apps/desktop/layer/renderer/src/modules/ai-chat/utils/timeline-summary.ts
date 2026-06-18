import { DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID } from "@follow/shared/settings/defaults"
import type { LocalAIFeature } from "@follow/shared/settings/interface"
import type { ChatRequestOptions } from "ai"

export const TIMELINE_SUMMARY_SCENE = "timeline-summary"
export const TIMELINE_SUMMARY_LOCAL_AI_FEATURE = "timelineSummary" satisfies LocalAIFeature

export const isTimelineSummaryShortcutId = (shortcutId?: string | null): boolean =>
  shortcutId === DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID

export const canBypassLoginForShortcut = ({
  localTimelineSummaryProfileId,
  shortcutId,
}: {
  localTimelineSummaryProfileId: string | null
  shortcutId?: string | null
}): boolean => isTimelineSummaryShortcutId(shortcutId) && localTimelineSummaryProfileId !== null

export const getTimelineSummaryRequestOptions = (): ChatRequestOptions => ({
  body: {
    localAIFeature: TIMELINE_SUMMARY_LOCAL_AI_FEATURE,
    scene: TIMELINE_SUMMARY_SCENE,
  },
})

export const getRequestOptionsForShortcut = (
  shortcutId?: string | null,
): ChatRequestOptions | undefined =>
  isTimelineSummaryShortcutId(shortcutId) ? getTimelineSummaryRequestOptions() : undefined
