import {
  DEFAULT_RECOMMEND_FEEDS_SHORTCUT_ID,
  DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
} from "@follow/shared/settings/defaults"
import type { AIShortcut } from "@follow/shared/settings/interface"
import type { TFunction } from "i18next"

const BUILT_IN_SHORTCUT_NAME_KEYS_BY_ID = {
  [DEFAULT_RECOMMEND_FEEDS_SHORTCUT_ID]: "shortcuts.builtin.recommend_feeds.name",
  [DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID]: "shortcuts.builtin.summarize_timeline.name",
} as const

const SERVER_SHORTCUT_NAME_KEYS_BY_ENGLISH_NAME = {
  Analyze: "shortcuts.builtin.analyze.name",
  "Recommend Feeds": "shortcuts.builtin.recommend_feeds.name",
  Summarize: "shortcuts.builtin.summarize_timeline.name",
} as const

type AIShortcutDisplayNameKey =
  | (typeof BUILT_IN_SHORTCUT_NAME_KEYS_BY_ID)[keyof typeof BUILT_IN_SHORTCUT_NAME_KEYS_BY_ID]
  | (typeof SERVER_SHORTCUT_NAME_KEYS_BY_ENGLISH_NAME)[keyof typeof SERVER_SHORTCUT_NAME_KEYS_BY_ENGLISH_NAME]

export const getAIShortcutDisplayName = (shortcut: AIShortcut, t: TFunction<"ai">): string => {
  const key =
    BUILT_IN_SHORTCUT_NAME_KEYS_BY_ID[
      shortcut.id as keyof typeof BUILT_IN_SHORTCUT_NAME_KEYS_BY_ID
    ] ??
    (shortcut.defaultPrompt
      ? SERVER_SHORTCUT_NAME_KEYS_BY_ENGLISH_NAME[
          shortcut.name as keyof typeof SERVER_SHORTCUT_NAME_KEYS_BY_ENGLISH_NAME
        ]
      : undefined)

  const translate = t as unknown as (key: AIShortcutDisplayNameKey) => string
  return key ? translate(key) : shortcut.name
}
