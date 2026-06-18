import { describe, expect, test } from "vitest"

import { COMMAND_ID } from "~/modules/command/commands/id"

import {
  HIDE_ACTIONS_IN_ENTRY_CONTEXT_MENU,
  HIDE_ACTIONS_IN_ENTRY_TOOLBAR_ACTIONS,
} from "./entry-action-visibility"

describe("entry action visibility", () => {
  test("keeps AI translation reachable from entry action surfaces", () => {
    expect(HIDE_ACTIONS_IN_ENTRY_CONTEXT_MENU).not.toContain(COMMAND_ID.entry.toggleAITranslation)
    expect(HIDE_ACTIONS_IN_ENTRY_TOOLBAR_ACTIONS).not.toContain(
      COMMAND_ID.entry.toggleAITranslation,
    )
  })
})
