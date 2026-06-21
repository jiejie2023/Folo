import { convertLexicalToMarkdown } from "@follow/components/ui/lexical-rich-editor/utils.js"
import { DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID } from "@follow/shared/settings/defaults"
import type { LexicalEditor } from "lexical"
import { $createParagraphNode, $getRoot, createEditor } from "lexical"
import { nanoid } from "nanoid"
import { useEffect, useMemo, useRef } from "react"

import { getShortcutEffectivePrompt, useAISettingValue } from "~/atoms/settings/ai"
import { useActionLanguage, useGeneralSettingKey } from "~/atoms/settings/general"
import { ROUTE_FEED_PENDING } from "~/constants"
import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"
import { resolveLocalAIProfileId } from "~/modules/local-ai/hooks"

import { AI_CHAT_SPECIAL_ID_PREFIX } from "../constants"
import { LexicalAIEditorNodes, ShortcutNode } from "../editor"
import { AIPersistService } from "../services"
import { useAIChatStore } from "../store/AIChatContext"
import { useBlockActions, useChatActions, useCurrentChatId } from "../store/hooks"
import type { AIChatContextBlock, SendingUIMessage } from "../store/types"
import { appendAIOutputLanguageInstruction } from "../utils/output-language"
import { getTimelineSummaryRequestOptions } from "../utils/timeline-summary"
import { useTimelineSummaryContextBlocks } from "./timeline-summary-context"
import { isTimelineSummaryAutoContext } from "./useTimelineSummaryAutoContext"

const ONE_HOUR = 60 * 60 * 1000

const buildSummaryMessage = (
  editor: LexicalEditor,
  contextBlocks: AIChatContextBlock[],
  messageId: string,
): SendingUIMessage => {
  const parts: SendingUIMessage["parts"] = []

  if (contextBlocks.length > 0) {
    parts.push({
      type: "data-block",
      data: contextBlocks,
    })
  }

  parts.push({
    type: "data-rich-text",
    data: {
      state: JSON.stringify(editor.getEditorState().toJSON()),
      text: convertLexicalToMarkdown(editor),
    },
  })

  return {
    id: messageId,
    role: "user",
    parts,
  }
}

const buildTimelineSummaryChatId = ({
  view,
  feedId,
  timelineId,
  unreadOnly,
  seed,
}: {
  view: number
  feedId: string
  timelineId?: string | null
  unreadOnly: boolean
  seed: string
}) => {
  const normalizedTimelineId = timelineId ?? "all"
  const unreadSegment = unreadOnly ? "unread" : "all"
  const prefix = AI_CHAT_SPECIAL_ID_PREFIX.TIMELINE_SUMMARY
  return `${prefix}${view}:${feedId}:${normalizedTimelineId}:${unreadSegment}:${seed}`
}

export const useAutoTimelineSummaryShortcut = () => {
  const aiSettings = useAISettingValue()
  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const actionLanguage = useActionLanguage()

  const { view, feedId, entryId, timelineId } = useRouteParamsSelector((params) => ({
    view: params.view,
    feedId: params.feedId,
    entryId: params.entryId,
    timelineId: params.timelineId,
  }))

  const chatActions = useChatActions()
  const blockActions = useBlockActions()
  const currentChatId = useCurrentChatId()
  const timelineSummaryContextBlocks = useTimelineSummaryContextBlocks()
  const timelineSummaryManualOverride = useAIChatStore()(
    (state) => state.timelineSummaryManualOverride,
  )

  const automationStateRef = useRef<{
    contextKey: string | null
    promise: Promise<void> | null
    failed: boolean
  }>({
    contextKey: null,
    promise: null,
    failed: false,
  })
  const previousContextKeyRef = useRef<string | null>(null)

  const isAllTimeline = isTimelineSummaryAutoContext({ entryId })

  const defaultShortcut = useMemo(() => {
    const shortcuts = aiSettings.shortcuts ?? []
    return shortcuts.find(
      (shortcut) => shortcut.id === DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID && shortcut.enabled,
    )
  }, [aiSettings.shortcuts])

  const normalizedFeedId = feedId ?? ROUTE_FEED_PENDING

  const contextKey = useMemo(() => {
    if (!isAllTimeline) return null
    const keyParts = [
      `timeline:${timelineId ?? "all"}`,
      `feed:${normalizedFeedId}`,
      `unread:${unreadOnly ? "1" : "0"}`,
    ]
    return keyParts.join("|")
  }, [isAllTimeline, timelineId, normalizedFeedId, unreadOnly])

  useEffect(() => {
    if (previousContextKeyRef.current !== contextKey) {
      chatActions.setTimelineSummaryManualOverride(false)
      previousContextKeyRef.current = contextKey
    }
  }, [chatActions, contextKey])

  const previousIsAllTimelineRef = useRef(isAllTimeline)

  useEffect(() => {
    const wasAllTimeline = previousIsAllTimelineRef.current
    if (
      wasAllTimeline &&
      !isAllTimeline &&
      currentChatId &&
      currentChatId.startsWith(AI_CHAT_SPECIAL_ID_PREFIX.TIMELINE_SUMMARY)
    ) {
      blockActions.clearBlocks({ keepSpecialTypes: true })
      chatActions.newChat()
    }
    previousIsAllTimelineRef.current = isAllTimeline
  }, [blockActions, chatActions, currentChatId, isAllTimeline])

  const contextBlocks = useMemo<AIChatContextBlock[]>(
    () => (isAllTimeline ? timelineSummaryContextBlocks : []),
    [isAllTimeline, timelineSummaryContextBlocks],
  )
  const localTimelineSummaryProfileId = resolveLocalAIProfileId(
    aiSettings.localAI,
    "timelineSummary",
  )
  const hasTimelineEntryContext = contextBlocks.some(
    (block) => block.type === "timelineEntries" && block.value.trim(),
  )

  useEffect(() => {
    if (!contextKey || !defaultShortcut) {
      if (!contextKey) {
        automationStateRef.current = { contextKey: null, promise: null, failed: false }
      }
      return
    }

    if (localTimelineSummaryProfileId && !hasTimelineEntryContext) {
      return
    }

    if (automationStateRef.current.contextKey !== contextKey) {
      automationStateRef.current = {
        contextKey,
        promise: null,
        failed: false,
      }
    } else {
      if (automationStateRef.current.promise) {
        return
      }
      if (automationStateRef.current.failed) {
        return
      }
    }

    if (timelineSummaryManualOverride) {
      return
    }

    const run = async () => {
      try {
        const prompt = appendAIOutputLanguageInstruction(
          getShortcutEffectivePrompt(defaultShortcut),
          actionLanguage,
        )
        const { id, name } = defaultShortcut

        if (!localTimelineSummaryProfileId) {
          const existingSession = await AIPersistService.findTimelineSummarySession({
            view,
            feedId: normalizedFeedId,
            timelineId: timelineId ?? null,
            unreadOnly,
          })
          const now = Date.now()

          if (existingSession) {
            const lastUpdatedAt =
              existingSession.updatedAt?.getTime?.() ?? existingSession.updatedAt
            if (typeof lastUpdatedAt === "number" && now - lastUpdatedAt < ONE_HOUR) {
              if (currentChatId !== existingSession.chatId) {
                await chatActions.switchToChat(existingSession.chatId)
              }
              automationStateRef.current.failed = false
              return
            }
          }
        }

        const timelineSummaryChatId = buildTimelineSummaryChatId({
          view,
          feedId: normalizedFeedId,
          timelineId: timelineId ?? null,
          unreadOnly,
          seed: nanoid(6),
        })

        await AIPersistService.ensureSession(timelineSummaryChatId, {
          title: "Timeline Summary",
        })

        await chatActions.switchToChat(timelineSummaryChatId)
        blockActions.clearBlocks({ keepSpecialTypes: true })

        const tempEditor = createEditor({
          nodes: LexicalAIEditorNodes,
        })

        tempEditor.update(
          () => {
            const root = $getRoot()
            root.clear()
            const paragraph = $createParagraphNode()
            const shortcutNode = new ShortcutNode({ id, name, prompt })
            paragraph.append(shortcutNode)
            root.append(paragraph)
          },
          {
            discrete: true,
          },
        )

        const message = buildSummaryMessage(tempEditor, contextBlocks, nanoid())

        await chatActions.sendMessage(message, getTimelineSummaryRequestOptions())

        automationStateRef.current.failed = false
      } catch (error) {
        automationStateRef.current.failed = true
        console.error("[AI Chat] Failed to auto-run timeline summary shortcut:", error)
      } finally {
        if (automationStateRef.current.contextKey === contextKey) {
          automationStateRef.current.promise = null
        }
      }
    }

    const promise = run()
    automationStateRef.current.promise = promise
  }, [
    blockActions,
    chatActions,
    contextBlocks,
    contextKey,
    currentChatId,
    defaultShortcut,
    hasTimelineEntryContext,
    localTimelineSummaryProfileId,
    normalizedFeedId,
    timelineId,
    unreadOnly,
    view,
    actionLanguage,
    timelineSummaryManualOverride,
  ])
}
