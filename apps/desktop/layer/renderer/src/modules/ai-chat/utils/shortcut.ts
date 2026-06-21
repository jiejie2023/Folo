import type { SerializedEditorState, SerializedLexicalNode } from "lexical"

import type { SerializedShortcutNode } from "../editor/plugins/shortcut/ShortcutNode"
import { getShortcutTextValue } from "../editor/plugins/shortcut/utils/shortcutTextValue"
import type { SendingUIMessage } from "../store/types"

type SerializedNodeWithChildren = SerializedLexicalNode & {
  children?: SerializedLexicalNode[]
}

const isSerializedShortcutNode = (node: SerializedLexicalNode): node is SerializedShortcutNode =>
  node.type === "shortcut"

const hasChildren = (node: SerializedLexicalNode): node is SerializedNodeWithChildren =>
  Array.isArray((node as SerializedNodeWithChildren).children)

const findShortcutIdInNodes = (nodes: SerializedLexicalNode[]): string | undefined => {
  for (const node of nodes) {
    if (isSerializedShortcutNode(node) && node.shortcutData?.id?.trim()) {
      return node.shortcutData.id.trim()
    }

    if (hasChildren(node)) {
      const match = findShortcutIdInNodes(node.children ?? [])
      if (match) {
        return match
      }
    }
  }

  return undefined
}

const findShortcutDataInNodes = (
  nodes: SerializedLexicalNode[],
): SerializedShortcutNode["shortcutData"] | undefined => {
  for (const node of nodes) {
    if (isSerializedShortcutNode(node) && node.shortcutData?.id?.trim()) {
      return node.shortcutData
    }

    if (hasChildren(node)) {
      const match = findShortcutDataInNodes(node.children ?? [])
      if (match) {
        return match
      }
    }
  }

  return undefined
}

export const extractShortcutIdFromSerializedState = (
  state?: SerializedEditorState,
): string | undefined => {
  if (!state?.root || !Array.isArray(state.root.children)) {
    return undefined
  }

  return findShortcutIdInNodes(state.root.children as SerializedLexicalNode[])
}

const extractShortcutDataFromSerializedState = (
  state?: SerializedEditorState,
): SerializedShortcutNode["shortcutData"] | undefined => {
  if (!state?.root || !Array.isArray(state.root.children)) {
    return undefined
  }

  return findShortcutDataInNodes(state.root.children as SerializedLexicalNode[])
}

const parseSerializedState = (
  rawState: string | SerializedEditorState,
): SerializedEditorState | null => {
  if (typeof rawState !== "string") {
    return rawState
  }

  try {
    return JSON.parse(rawState) as SerializedEditorState
  } catch (error) {
    console.error("Failed to parse serialized editor state", error)
    return null
  }
}

export const extractShortcutIdFromMessageParts = (
  parts: SendingUIMessage["parts"],
): string | undefined => {
  for (const part of parts) {
    if (part.type !== "data-rich-text") {
      continue
    }

    const serializedState = parseSerializedState(part.data.state)
    if (!serializedState) {
      continue
    }

    const match = extractShortcutIdFromSerializedState(serializedState)
    if (match) {
      return match
    }
  }

  return undefined
}

export const refreshShortcutTextInMessageParts = (
  parts: SendingUIMessage["parts"],
): SendingUIMessage["parts"] => {
  let didChange = false
  const refreshedParts = parts.map((part) => {
    if (part.type !== "data-rich-text") {
      return part
    }

    const serializedState = parseSerializedState(part.data.state)
    const shortcutData = extractShortcutDataFromSerializedState(serializedState ?? undefined)
    if (!shortcutData) {
      return part
    }

    const text = getShortcutTextValue(shortcutData)
    if (!text || text === part.data.text) {
      return part
    }

    didChange = true
    return {
      ...part,
      data: {
        ...part.data,
        text,
      },
    }
  })

  return didChange ? refreshedParts : parts
}

export const prefixMessageIdWithShortcut = (baseId: string, shortcutId?: string): string => {
  const normalized = shortcutId?.trim()
  if (!normalized) {
    return baseId
  }

  return `${normalized}-${baseId}`
}
