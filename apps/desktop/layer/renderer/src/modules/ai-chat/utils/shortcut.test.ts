import type { SerializedEditorState } from "lexical"
import { describe, expect, it, vi } from "vitest"

import type { SendingUIMessage } from "../store/types"
import { refreshShortcutTextInMessageParts } from "./shortcut"

const mocks = vi.hoisted(() => ({
  getShortcutTextValue: vi.fn(),
}))

vi.mock("../editor/plugins/shortcut/utils/shortcutTextValue", () => ({
  getShortcutTextValue: mocks.getShortcutTextValue,
}))

const createShortcutState = (): SerializedEditorState =>
  ({
    root: {
      children: [
        {
          children: [
            {
              shortcutData: {
                id: "default-summarize-timeline",
                name: "Summarize",
                prompt: "Old prompt",
              },
              type: "shortcut",
              version: 1,
            },
          ],
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  }) as unknown as SerializedEditorState

describe("shortcut message helpers", () => {
  it("refreshes shortcut rich-text content before resending stored messages", () => {
    mocks.getShortcutTextValue.mockReturnValue(
      "Summarize the current timeline.\n\nFolo AI output language instruction: Respond in Simplified Chinese (zh-CN).",
    )
    const parts: SendingUIMessage["parts"] = [
      {
        type: "data-rich-text",
        data: {
          state: JSON.stringify(createShortcutState()),
          text: "Summarize the current timeline.",
        },
      },
    ]

    const refreshedParts = refreshShortcutTextInMessageParts(parts)

    expect(refreshedParts[0]).toMatchObject({
      type: "data-rich-text",
      data: {
        text: expect.stringContaining("Respond in Simplified Chinese (zh-CN)."),
      },
    })
  })

  it("keeps message parts stable when shortcut text is already current", () => {
    mocks.getShortcutTextValue.mockReturnValue("Current prompt")
    const parts: SendingUIMessage["parts"] = [
      {
        type: "data-rich-text",
        data: {
          state: JSON.stringify(createShortcutState()),
          text: "Current prompt",
        },
      },
    ]

    expect(refreshShortcutTextInMessageParts(parts)).toBe(parts)
  })
})
