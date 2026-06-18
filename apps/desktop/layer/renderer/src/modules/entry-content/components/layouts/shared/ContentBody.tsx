import { useEntry } from "@follow/store/entry/hooks"
import { cn } from "@follow/utils/utils"

import { useGeneralSettingKey } from "~/atoms/settings/general"
import { useSpotlightSettingKey } from "~/atoms/settings/spotlight"
import { HTML } from "~/components/ui/markdown/HTML"
import { readableContentMaxWidthClassName } from "~/constants/ui"
import { useRenderStyle } from "~/hooks/biz/useRenderStyle"

import { useStableTranslatedContent } from "./use-stable-translated-content"

interface ContentBodyProps {
  entryId: string
  className?: string
  compact?: boolean
  noMedia?: boolean
  translation?: {
    content?: string
    title?: string
  }
}

export const ContentBody: React.FC<ContentBodyProps> = ({
  entryId,
  className,
  compact = false,
  noMedia = false,
  translation,
}) => {
  const entry = useEntry(entryId, (state) => ({
    content: state.content,
    description: state.description,
  }))

  const renderStyle = useRenderStyle({
    baseFontSize: compact ? 14 : 16,
    baseLineHeight: compact ? 1.625 : 1.7,
  })
  const translationMode = useGeneralSettingKey("translationMode")
  const spotlightRules = useSpotlightSettingKey("spotlights")

  const content = useStableTranslatedContent({
    format: "html",
    mode: translationMode,
    source: entry?.content || entry?.description,
    target: translation?.content,
  })

  if (!entry) return null

  if (!content) return null

  return (
    <HTML
      as="div"
      className={cn(
        "prose dark:prose-invert",
        "prose-blockquote:mt-0",
        "cursor-auto select-text",
        readableContentMaxWidthClassName,
        compact ? "text-sm leading-relaxed" : "text-base leading-relaxed",
        className,
      )}
      noMedia={noMedia}
      spotlightRules={spotlightRules}
      style={renderStyle}
    >
      {content}
    </HTML>
  )
}
