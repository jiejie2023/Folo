import { getAISettings, getShortcutEffectivePrompt } from "~/atoms/settings/ai"
import { getActionLanguage } from "~/atoms/settings/general"
import { getI18n } from "~/i18n"
import { appendAIOutputLanguageInstruction } from "~/modules/ai-chat/utils/output-language"
import { getAIShortcutDisplayName } from "~/modules/ai-chat/utils/shortcut-display"

import type { ShortcutData } from "../types"

export function getShortcutTextValue(shortcutData: ShortcutData): string {
  const allShortcuts = getAISettings().shortcuts ?? []
  const matchedShortcut = allShortcuts.find((shortcut) => shortcut.id === shortcutData.id)
  if (matchedShortcut) {
    return appendAIOutputLanguageInstruction(
      getShortcutEffectivePrompt(matchedShortcut),
      getActionLanguage(),
    )
  }
  return appendAIOutputLanguageInstruction(shortcutData.prompt, getActionLanguage())
}

export function getShortcutDisplayTextValue(shortcutData: ShortcutData): string {
  const allShortcuts = getAISettings().shortcuts ?? []
  const matchedShortcut = allShortcuts.find((shortcut) => shortcut.id === shortcutData.id)
  if (!matchedShortcut) {
    return shortcutData.name
  }
  const i18n = getI18n()
  const language = i18n.language || i18n.resolvedLanguage || i18n.options?.lng || "en"
  return getAIShortcutDisplayName(matchedShortcut, i18n.getFixedT(language, "ai"))
}

export function getShortcutMarkdownValue(shortcutId: string): string {
  const allShortcuts = getAISettings().shortcuts ?? []
  const matchedShortcut = allShortcuts.find((shortcut) => shortcut.id === shortcutId)
  return matchedShortcut ? `/${getShortcutDisplayTextValue(matchedShortcut)}` : `/${shortcutId}`
}
