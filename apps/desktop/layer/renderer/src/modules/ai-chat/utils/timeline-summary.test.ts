import { DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID } from "@follow/shared/settings/defaults"
import { describe, expect, it } from "vitest"

import {
  canBypassLoginForShortcut,
  getRequestOptionsForShortcut,
  isTimelineSummaryShortcutId,
  TIMELINE_SUMMARY_LOCAL_AI_FEATURE,
  TIMELINE_SUMMARY_SCENE,
} from "./timeline-summary"

describe("timeline summary request helpers", () => {
  it("recognizes the built-in timeline summary shortcut", () => {
    expect(isTimelineSummaryShortcutId(DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID)).toBe(true)
    expect(isTimelineSummaryShortcutId("custom-shortcut")).toBe(false)
  })

  it("routes timeline summary shortcuts through the timelineSummary local AI feature", () => {
    expect(getRequestOptionsForShortcut(DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID)).toEqual({
      body: {
        localAIFeature: TIMELINE_SUMMARY_LOCAL_AI_FEATURE,
        scene: TIMELINE_SUMMARY_SCENE,
      },
    })
  })

  it("allows login bypass only when timeline summary is routed locally", () => {
    expect(
      canBypassLoginForShortcut({
        localTimelineSummaryProfileId: "profile-1",
        shortcutId: DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
      }),
    ).toBe(true)

    expect(
      canBypassLoginForShortcut({
        localTimelineSummaryProfileId: null,
        shortcutId: DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
      }),
    ).toBe(false)

    expect(
      canBypassLoginForShortcut({
        localTimelineSummaryProfileId: "profile-1",
        shortcutId: "custom-shortcut",
      }),
    ).toBe(false)
  })
})
