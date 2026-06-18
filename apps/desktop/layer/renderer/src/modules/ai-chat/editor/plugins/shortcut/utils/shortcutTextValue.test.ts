import type { AIShortcut } from "@follow/shared/settings/interface"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ShortcutData } from "../types"
import { getShortcutTextValue } from "./shortcutTextValue"

const mocks = vi.hoisted(() => ({
  getActionLanguage: vi.fn(),
  getAISettings: vi.fn(),
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: mocks.getAISettings,
  getShortcutEffectivePrompt: (shortcut: AIShortcut) =>
    shortcut.prompt || shortcut.defaultPrompt || "",
}))

vi.mock("~/atoms/settings/general", () => ({
  getActionLanguage: mocks.getActionLanguage,
}))

vi.mock("~/i18n", () => ({
  getI18n: () => ({
    getFixedT: () => (key: string) => key,
    language: "zh-CN",
    options: {},
    resolvedLanguage: "zh-CN",
  }),
}))

const shortcut: AIShortcut = {
  displayTargets: ["list"],
  enabled: true,
  id: "summary-shortcut",
  name: "Summarize",
  prompt: "Summarize the current timeline.",
}

const shortcutData: ShortcutData = {
  displayTargets: ["list"],
  id: shortcut.id,
  name: shortcut.name,
  prompt: shortcut.prompt,
}

describe("shortcut text value", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActionLanguage.mockReturnValue("zh-CN")
    mocks.getAISettings.mockReturnValue({
      shortcuts: [shortcut],
    })
  })

  it("adds the configured AI output language to shortcut prompt text", () => {
    expect(getShortcutTextValue(shortcutData)).toContain("Respond in Simplified Chinese (zh-CN).")
  })
})
