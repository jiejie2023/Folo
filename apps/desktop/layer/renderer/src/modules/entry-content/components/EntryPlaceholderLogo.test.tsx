import { DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID } from "@follow/shared/settings/defaults"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EntryPlaceholderLogo } from "./EntryPlaceholderLogo"

const reactActGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const presentSettings = vi.fn()
  const sendAIShortcut = vi.fn()
  const timelineBlocks = [
    { id: "mainView", type: "mainView", value: "0" },
    { id: "mainFeed", type: "mainFeed", value: "feed-1" },
  ]
  const sendAIShortcutHook = () => ({
    sendAIShortcut,
  })
  const settingModalHook = () => presentSettings
  const timelineSummaryContextBlocksHook = () => timelineBlocks

  return {
    presentSettings,
    sendAIShortcut,
    sendAIShortcutHook,
    settingModalHook,
    timelineBlocks,
    timelineSummaryContextBlocksHook,
  }
})

vi.mock("~/modules/ai-chat/hooks/useSendAIShortcut", () => ({
  useSendAIShortcut: mocks.sendAIShortcutHook,
}))

vi.mock("~/modules/ai-chat/hooks/timeline-summary-context", () => ({
  useTimelineSummaryContextBlocks: mocks.timelineSummaryContextBlocksHook,
}))

vi.mock("~/modules/settings/modal/use-setting-modal-hack", () => ({
  useSettingModal: mocks.settingModalHook,
}))

describe("EntryPlaceholderLogo", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.append(container)
  })

  afterEach(() => {
    container.remove()
  })

  it("passes current timeline context when summarizing the timeline", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(<EntryPlaceholderLogo />)
    })

    const summarizeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Summarize the current timeline"),
    )

    expect(summarizeButton).toBeTruthy()

    await act(async () => {
      summarizeButton?.click()
    })

    expect(mocks.sendAIShortcut).toHaveBeenCalledWith({
      contextBlocks: mocks.timelineBlocks,
      ensureNewChat: true,
      shortcutId: DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID,
    })
  })
})
