import {
  DEFAULT_RECOMMEND_FEEDS_SHORTCUT_ID,
  DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
} from "@follow/shared/settings/defaults"
import type { AIShortcut } from "@follow/shared/settings/interface"
import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import { getAIShortcutDisplayName } from "./shortcut-display"

const t = ((key: string) => {
  const translations: Record<string, string> = {
    "shortcuts.builtin.analyze.name": "分析",
    "shortcuts.builtin.recommend_feeds.name": "推荐订阅源",
    "shortcuts.builtin.summarize_timeline.name": "总结时间线",
  }
  return translations[key] ?? key
}) as TFunction<"ai">

const createShortcut = (shortcut: Partial<AIShortcut>): AIShortcut => ({
  displayTargets: ["list"],
  enabled: true,
  id: "shortcut-1",
  name: "Custom",
  prompt: "Prompt",
  ...shortcut,
})

describe("getAIShortcutDisplayName", () => {
  it("localizes built-in timeline shortcut names by id", () => {
    expect(
      getAIShortcutDisplayName(
        createShortcut({
          id: DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
          name: "Summarize",
        }),
        t,
      ),
    ).toBe("总结时间线")

    expect(
      getAIShortcutDisplayName(
        createShortcut({
          id: DEFAULT_RECOMMEND_FEEDS_SHORTCUT_ID,
          name: "Recommend Feeds",
        }),
        t,
      ),
    ).toBe("推荐订阅源")
  })

  it("localizes server-provided built-in names without changing custom shortcuts", () => {
    expect(
      getAIShortcutDisplayName(
        createShortcut({
          defaultPrompt: "Analyze the current entry.",
          name: "Analyze",
        }),
        t,
      ),
    ).toBe("分析")

    expect(
      getAIShortcutDisplayName(
        createShortcut({
          name: "Analyze",
        }),
        t,
      ),
    ).toBe("Analyze")
  })
})
