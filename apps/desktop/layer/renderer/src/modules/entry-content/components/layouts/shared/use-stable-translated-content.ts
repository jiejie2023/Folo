import { useCallback, useEffect, useRef, useState } from "react"

import type { BuildTranslatedContentOptions } from "./translated-content"
import { buildTranslatedContent } from "./translated-content"

const TRANSLATION_RENDER_INTERVAL_MS = 120

const renderTranslatedContent = (options: BuildTranslatedContentOptions) =>
  buildTranslatedContent(options)

export const useStableTranslatedContent = ({
  format,
  mode,
  source,
  target,
}: BuildTranslatedContentOptions) => {
  const latestOptionsRef = useRef<BuildTranslatedContentOptions>({ format, mode, source, target })
  latestOptionsRef.current = { format, mode, source, target }

  const [stableContent, setStableContent] = useState(() =>
    renderTranslatedContent(latestOptionsRef.current),
  )
  const previousIdentityRef = useRef({ format, mode, source: source ?? "" })
  const hadTargetRef = useRef(Boolean(target))
  const lastRenderAtRef = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRenderTimer = useCallback(() => {
    if (!timerRef.current) return
    globalThis.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const renderLatest = useCallback(() => {
    clearRenderTimer()
    lastRenderAtRef.current = Date.now()
    setStableContent(renderTranslatedContent(latestOptionsRef.current))
  }, [clearRenderTimer])

  const scheduleRender = useCallback(() => {
    if (timerRef.current) return

    const elapsed = Date.now() - lastRenderAtRef.current
    timerRef.current = globalThis.setTimeout(
      renderLatest,
      Math.max(0, TRANSLATION_RENDER_INTERVAL_MS - elapsed),
    )
  }, [renderLatest])

  useEffect(() => {
    const previousIdentity = previousIdentityRef.current
    const identityChanged =
      previousIdentity.format !== format ||
      previousIdentity.mode !== mode ||
      previousIdentity.source !== (source ?? "")
    previousIdentityRef.current = { format, mode, source: source ?? "" }

    if (identityChanged || !target || !hadTargetRef.current) {
      hadTargetRef.current = Boolean(target)
      renderLatest()
      return
    }

    hadTargetRef.current = true
    scheduleRender()
  }, [format, mode, renderLatest, scheduleRender, source, target])

  useEffect(
    () => () => {
      clearRenderTimer()
    },
    [clearRenderTimer],
  )

  return stableContent
}
