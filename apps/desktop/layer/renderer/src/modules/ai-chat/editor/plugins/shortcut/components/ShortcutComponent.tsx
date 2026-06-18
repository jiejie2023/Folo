import * as React from "react"
import { useTranslation } from "react-i18next"

import { useAISettingValue } from "~/atoms/settings/ai"
import { getAIShortcutDisplayName } from "~/modules/ai-chat/utils/shortcut-display"

import { ShortcutTooltip } from "../../../../components/ui/ShortcutTooltip"
import { MentionLikePill } from "../../shared/components/MentionLikePill"
import type { ShortcutData } from "../types"

interface ShortcutComponentProps {
  shortcutData: ShortcutData
  className?: string
  onSelect?: (shortcut: ShortcutData) => void
}

export const ShortcutComponent: React.FC<ShortcutComponentProps> = ({
  shortcutData,
  className,
  onSelect,
}) => {
  const { shortcuts } = useAISettingValue()
  const { t } = useTranslation("ai")
  const matched = React.useMemo(() => {
    return shortcuts.find((s) => s.id === shortcutData.id)
  }, [shortcuts, shortcutData.id])
  const displayName = matched ? getAIShortcutDisplayName(matched, t) : shortcutData.name
  const handleClick = React.useCallback(() => {
    onSelect?.(shortcutData)
  }, [onSelect, shortcutData])

  return (
    <ShortcutTooltip name={displayName} prompt={shortcutData.prompt || matched?.defaultPrompt}>
      <MentionLikePill
        className={className}
        variant="command"
        icon={
          matched?.icon ? <i className={matched.icon} /> : <i className="i-mgc-hotkey-cute-re" />
        }
        prefix="/"
        data-shortcut-id={shortcutData.id}
        onClick={handleClick}
      >
        {displayName}
      </MentionLikePill>
    </ShortcutTooltip>
  )
}

ShortcutComponent.displayName = "ShortcutComponent"
