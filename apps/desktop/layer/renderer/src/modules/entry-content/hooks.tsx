import { useEntry, usePrefetchEntryDetail } from "@follow/store/entry/hooks"
import { usePrefetchEntryTranslation } from "@follow/store/translation/hooks"
import { useUserRole } from "@follow/store/user/hooks"
import { tracker } from "@follow/tracker"
import { createElement, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useShowAITranslation } from "~/atoms/ai-translation"
import { useEntryIsInReadability, useEntryIsInReadabilitySuccess } from "~/atoms/readability"
import { useActionLanguage, useGeneralSettingKey } from "~/atoms/settings/general"
import {
  shouldPrefetchAITranslation,
  useIsLocalAITranslationAccessEnabled,
} from "~/atoms/settings/local-ai-paid-access"
import { useModalStack } from "~/components/ui/modal/stacked/hooks"

import { ImageGalleryContent } from "./components/ImageGalleryContent"

export const useGalleryModal = () => {
  const { present } = useModalStack()
  const { t } = useTranslation()
  return useCallback(
    (entryId?: string) => {
      if (!entryId) {
        // this should not happen unless there is a bug in the code
        toast.error("Invalid feed id")
        return
      }
      tracker.entryContentHeaderImageGalleryClick({
        feedId: entryId,
      })
      present({
        title: t("entry_actions.image_gallery"),
        content: () => createElement(ImageGalleryContent, { entryId }),
        max: true,
        clickOutsideToDismiss: true,
      })
    },
    [present, t],
  )
}

export const useEntryContent = (entryId: string) => {
  const entry = useEntry(entryId, (state) => {
    const { inboxHandle, content, readabilityContent } = state
    return { inboxId: inboxHandle, content, readabilityContent }
  })
  const { error, data, isPending } = usePrefetchEntryDetail(entryId)

  const isInReadabilityMode = useEntryIsInReadability(entryId)
  const isReadabilitySuccess = useEntryIsInReadabilitySuccess(entryId)

  const enableTranslation = useShowAITranslation()
  const userRole = useUserRole()
  const isLocalAITranslationAccessEnabled = useIsLocalAITranslationAccessEnabled()
  const shouldPrefetchTranslation = shouldPrefetchAITranslation({
    enabled: enableTranslation,
    isLocalAITranslationAccessEnabled,
    userRole,
  })
  const actionLanguage = useActionLanguage()
  const translationMode = useGeneralSettingKey("translationMode")
  usePrefetchEntryTranslation({
    entryIds: [entryId],
    enabled: shouldPrefetchTranslation,
    language: actionLanguage,
    withContent: true,
    target: isReadabilitySuccess ? "readabilityContent" : "content",
    mode: translationMode,
  })

  return useMemo(() => {
    const entryContent = isInReadabilityMode
      ? entry?.readabilityContent
      : (entry?.content ?? data?.content)
    return {
      content: entryContent,
      error,
      isPending,
    }
  }, [
    data?.content,
    entry?.content,
    error,
    isInReadabilityMode,
    isPending,
    entry?.readabilityContent,
  ])
}

export const useEntryMediaInfo = (entryId: string) => {
  return useEntry(entryId, (entry) =>
    Object.fromEntries(
      entry?.media
        ?.filter((m) => m.type === "photo")
        .map((cur) => [
          cur.url,
          {
            width: cur.width,
            height: cur.height,
          },
        ]) ?? [],
    ),
  )
}
