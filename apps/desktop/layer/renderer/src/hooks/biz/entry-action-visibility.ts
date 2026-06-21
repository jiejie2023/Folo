import { COMMAND_ID } from "~/modules/command/commands/id"
import type { FollowCommandId } from "~/modules/command/types"

export const HIDE_ACTIONS_IN_ENTRY_CONTEXT_MENU: FollowCommandId[] = [
  COMMAND_ID.entry.viewSourceContent,
  COMMAND_ID.entry.copyTitle,
  COMMAND_ID.entry.copyLink,
  COMMAND_ID.entry.exportAsPDF,
  COMMAND_ID.entry.imageGallery,
  COMMAND_ID.entry.share,

  COMMAND_ID.settings.customizeToolbar,
  COMMAND_ID.entry.readability,
  COMMAND_ID.entry.exportAsPDF,
]

export const HIDE_ACTIONS_IN_ENTRY_TOOLBAR_ACTIONS: FollowCommandId[] = [
  ...HIDE_ACTIONS_IN_ENTRY_CONTEXT_MENU,
]
