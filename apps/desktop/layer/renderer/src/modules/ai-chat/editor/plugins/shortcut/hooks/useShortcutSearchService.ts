import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { getShortcutEffectivePrompt, useAISettingValue } from "~/atoms/settings/ai"
import { getAIShortcutDisplayName } from "~/modules/ai-chat/utils/shortcut-display"

import type { ShortcutData } from "../types"

export const useShortcutSearchService = () => {
  const aiSettings = useAISettingValue()
  const { t } = useTranslation("ai")

  const searchShortcuts = useMemo(() => {
    const shortcuts = (aiSettings.shortcuts ?? []).filter((shortcut) => shortcut.enabled)

    const normalizedShortcuts: ShortcutData[] = shortcuts.map((shortcut) => ({
      id: shortcut.id,
      name: getAIShortcutDisplayName(shortcut, t),
      prompt: getShortcutEffectivePrompt(shortcut),
      hotkey: shortcut.hotkey,
      displayTargets: shortcut.displayTargets,
    }))

    return async (query: string): Promise<ShortcutData[]> => {
      const trimmedQuery = query.trim().toLowerCase()

      if (!trimmedQuery) {
        return normalizedShortcuts
      }

      return normalizedShortcuts.filter((shortcut) => {
        const normalizedName = shortcut.name.toLowerCase()
        const originalName = shortcuts
          .find((source) => source.id === shortcut.id)
          ?.name.toLowerCase()
        return normalizedName.includes(trimmedQuery) || !!originalName?.includes(trimmedQuery)
      })
    }
  }, [aiSettings.shortcuts, t])

  return { searchShortcuts }
}
