import { UserRole } from "@follow/constants"
import type { TranslationSchema } from "@follow/database/schemas/types"
import { TranslationService } from "@follow/database/services/translation"
import type { SupportedActionLanguage } from "@follow/shared"
import { toApiSupportedActionLanguage } from "@follow/shared"
import { checkLanguage } from "@follow/utils/language"
import { create, indexedResolver, windowScheduler } from "@yornaath/batshit"

import { api, localAI } from "../../context"
import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"
import { readNdjsonStream } from "../../lib/stream"
import { getEntry } from "../entry/getter"
import type { LocalAIBridge, LocalAITranslationItem } from "../local-ai/types"
import { useUserStore } from "../user/store"
import type {
  EntryTranslation,
  TranslationField,
  TranslationFieldArray,
  TranslationMode,
} from "./types"
import { translationFields } from "./types"

type TranslationModel = Omit<TranslationSchema, "createdAt">
type TranslationBatchRequest = Parameters<ReturnType<typeof api>["ai"]["translationBatch"]>[0]
type ContentTranslationField = Extract<TranslationField, "content" | "readabilityContent">

const LOCAL_TRANSLATION_CONTENT_FIELDS = new Set<TranslationField>([
  "content",
  "readabilityContent",
])
const TRANSLATION_BATCH_WINDOW_MS = 120
const HTML_MEDIA_NODE_PATTERN =
  /<(?:img|embed)\b[^>]*>|<(audio|canvas|iframe|object|picture|svg|video)\b[\s\S]*?<\/\1>/gi
const HTML_MEDIA_ONLY_PATTERN =
  /^(?:<(?:img|embed)\b[^>]*>|<(audio|canvas|iframe|object|picture|svg|video)\b[\s\S]*?<\/\1>)$/i
const HTML_DOUBLE_BREAK_PATTERN = /(?:<br\b[^>]*>\s*){2,}/i
const HTML_NESTED_BLOCK_PATTERN =
  /<(?:address|article|aside|blockquote|div|dl|figure|footer|h[1-6]|header|li|main|ol|p|pre|section|table|ul)\b/i
const HTML_VISUAL_PARAGRAPH_CONTAINER_PATTERN =
  /^<(?:article|div|p|section)\b[^>]*>([\s\S]*)<\/(?:article|div|p|section)>$/i
const HTML_LAYOUT_CONTAINER_OPEN_PATTERN = /<(?:article|div|main|section)\b[^>]*>/gi
const HTML_LAYOUT_CONTAINER_CLOSE_PATTERN = /<\/(?:article|div|main|section)>/gi
const HTML_STRUCTURAL_TAG_PATTERN = /<\/?(blockquote|dl|figure|ol|pre|table|ul)\b[^>]*>/gi

interface TranslationState {
  data: Record<string, Partial<Record<SupportedActionLanguage, EntryTranslation>>>
}
interface TranslationBatchGroup {
  language: SupportedActionLanguage
  fields: string
  mode: TranslationMode
  ids: string[]
  keyById: Record<string, string>
}
const defaultState: TranslationState = {
  data: {},
}

export const useTranslationStore = createZustandStore<TranslationState>("translation")(
  () => defaultState,
)

const get = useTranslationStore.getState
const set = useTranslationStore.setState
const immerSet = createImmerSetter(useTranslationStore)

const splitTranslationFields = (fields: string) =>
  fields.split(",").filter(Boolean) as TranslationField[]

const selectTranslationItemFields = (items: LocalAITranslationItem[], fields: TranslationField[]) =>
  items.map((item) => {
    const selected: LocalAITranslationItem = { entryId: item.entryId }
    for (const field of fields) {
      selected[field] = item[field]
    }
    return selected
  })

const isContentTranslationField = (field: TranslationField): field is ContentTranslationField =>
  LOCAL_TRANSLATION_CONTENT_FIELDS.has(field)

const createEmptyTranslation = (
  entryId: string,
  language: SupportedActionLanguage,
): TranslationModel => ({
  content: null,
  description: null,
  entryId,
  language,
  readabilityContent: null,
  title: null,
})

const splitHtmlVisualParagraphs = (content: string) => {
  if (!HTML_DOUBLE_BREAK_PATTERN.test(content)) return null

  const containerMatch = content.match(HTML_VISUAL_PARAGRAPH_CONTAINER_PATTERN)
  const innerContent = containerMatch?.[1] ?? content
  if (HTML_NESTED_BLOCK_PATTERN.test(innerContent)) return null

  const paragraphs = innerContent
    .split(/(?:<br\b[^>]*>\s*){2,}/gi)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length < 2) return null
  return paragraphs.map((paragraph) => `<p>${paragraph}</p>`)
}

const findStructuralBlockRanges = (content: string) => {
  const ranges: Array<{ end: number; start: number }> = []
  const stack: string[] = []
  let outerStart = -1

  for (const match of content.matchAll(HTML_STRUCTURAL_TAG_PATTERN)) {
    const tagName = match[1]?.toLowerCase()
    if (!tagName) continue

    if (!match[0].startsWith("</")) {
      if (stack.length === 0) outerStart = match.index ?? 0
      stack.push(tagName)
      continue
    }

    const matchingIndex = stack.lastIndexOf(tagName)
    if (matchingIndex === -1) continue
    stack.splice(matchingIndex)
    if (stack.length === 0 && outerStart >= 0) {
      ranges.push({ end: (match.index ?? 0) + match[0].length, start: outerStart })
      outerStart = -1
    }
  }

  return ranges
}

const splitByNaturalBoundaries = (content: string) => {
  const visualParagraphs = splitHtmlVisualParagraphs(content)
  if (visualParagraphs) return visualParagraphs

  const normalizedContent = content
    .replaceAll(HTML_LAYOUT_CONTAINER_OPEN_PATTERN, "")
    .replaceAll(HTML_LAYOUT_CONTAINER_CLOSE_PATTERN, "\n\n")
  const blocks: string[] = []
  let lastStructuralBlockEnd = 0

  const splitRegularBlocks = (value: string) => {
    const regularBlocks =
      value.match(
        /[\s\S]*?(?:<\/(?:p|div|ul|ol|h[1-6]|blockquote|section|article|pre)>|\n{2,})/gi,
      ) ?? []
    const rest = regularBlocks.length > 0 ? value.slice(regularBlocks.join("").length) : value
    return [...regularBlocks, ...(rest.trim() ? [rest] : [])]
  }

  for (const range of findStructuralBlockRanges(normalizedContent)) {
    blocks.push(
      ...splitRegularBlocks(normalizedContent.slice(lastStructuralBlockEnd, range.start)),
      normalizedContent.slice(range.start, range.end),
    )
    lastStructuralBlockEnd = range.end
  }
  blocks.push(...splitRegularBlocks(normalizedContent.slice(lastStructuralBlockEnd)))

  return blocks.map((piece) => piece.trim()).filter(Boolean)
}

const stripMediaNodes = (content: string) => content.replaceAll(HTML_MEDIA_NODE_PATTERN, "")

const stripHtmlTags = (content: string) => content.replaceAll(/<[^>]+>/g, " ")

const shouldTranslateHtmlPiece = (piece: string) => {
  const trimmed = piece.trim()
  if (!trimmed) return false
  if (HTML_MEDIA_ONLY_PATTERN.test(trimmed)) return false
  return stripHtmlTags(trimmed).trim().length > 0
}

const splitLongText = (content: string) => {
  const pieces = splitByNaturalBoundaries(content)
  const sourcePieces = pieces.length > 0 ? pieces : [content]
  const chunks: string[] = []

  for (const sourcePiece of sourcePieces) {
    const mediaFreePiece = stripMediaNodes(sourcePiece).trim()
    if (!shouldTranslateHtmlPiece(mediaFreePiece)) continue
    chunks.push(mediaFreePiece)
  }

  return chunks.length > 0 ? chunks : [content]
}

const mergeTranslationChunk = ({
  accumulated,
  chunk,
  field,
}: {
  accumulated: TranslationModel
  chunk: string | null | undefined
  field: ContentTranslationField
}) => {
  if (!chunk) return
  accumulated[field] = `${accumulated[field] ?? ""}${chunk}`
}

const replaceLatestTranslationChunk = ({
  accumulated,
  base,
  chunk,
  field,
}: {
  accumulated: TranslationModel
  base: string
  chunk: string
  field: ContentTranslationField
}) => {
  accumulated[field] = `${base}${chunk}`
}

class TranslationActions implements Hydratable, Resetable {
  async hydrate() {
    const translations = await TranslationService.getTranslationToHydrate()
    translationActions.upsertManyInSession(translations)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => TranslationService.reset())

    await tx.run()
  }

  upsertManyInSession(translations: TranslationModel[]) {
    immerSet((state) => {
      translations.forEach((translation) => {
        if (!state.data[translation.entryId]) {
          state.data[translation.entryId] = {}
        }

        if (!state.data[translation.entryId]![translation.language]) {
          state.data[translation.entryId]![translation.language] = {
            title: null,
            description: null,
            content: null,
            readabilityContent: null,
          }
        }

        translationFields.forEach((field) => {
          if (translation[field]) {
            state.data[translation.entryId]![translation.language]![field] = translation[field]
          }
        })
      })
    })
  }

  async upsertMany(translations: TranslationModel[]) {
    this.upsertManyInSession(translations)

    await Promise.all(
      translations.map((translation) => TranslationService.insertTranslation(translation)),
    )
  }

  getTranslation(entryId: string, language: SupportedActionLanguage) {
    return get().data[entryId]?.[language]
  }
}

export const translationActions = new TranslationActions()

class TranslationSyncService {
  private currentMode?: TranslationMode

  private partialTranslationFields = new Set<string>()

  private partialFieldKey(
    entryId: string,
    language: SupportedActionLanguage,
    field: TranslationField,
  ) {
    return `${entryId}|${language}|${field}`
  }

  private async ensureMode(mode: TranslationMode) {
    if (!this.currentMode) {
      this.currentMode = mode
      return
    }

    if (this.currentMode === mode) return

    this.currentMode = mode
    await translationActions.reset()
  }

  private async translateLocalGroup({
    bridge,
    group,
    items,
  }: {
    bridge: LocalAIBridge
    group: TranslationBatchGroup
    items: LocalAITranslationItem[]
  }) {
    const fields = splitTranslationFields(group.fields)
    const hasContentField = fields.some(isContentTranslationField)

    if (!hasContentField) {
      return this.translateLocalGroupOnce({ bridge, group, items })
    }

    return this.translateLocalGroupProgressively({ bridge, fields, group, items })
  }

  private async translateLocalGroupOnce({
    bridge,
    group,
    items,
  }: {
    bridge: LocalAIBridge
    group: TranslationBatchGroup
    items: LocalAITranslationItem[]
  }) {
    const results: Record<string, TranslationModel | null> = {}
    const fields = splitTranslationFields(group.fields)
    const response = await bridge.translateEntries({
      fields: group.fields,
      items: selectTranslationItemFields(items, fields),
      language: group.language,
      mode: group.mode,
    })

    for (const id of group.ids) {
      const key = group.keyById[id]
      if (!key) continue

      const translated = response[id]
      if (!translated) {
        results[key] = null
        continue
      }

      if (this.currentMode && this.currentMode !== group.mode) continue

      const translation: TranslationModel = {
        content: translated.content ?? null,
        description: translated.description ?? null,
        entryId: id,
        language: group.language,
        readabilityContent: translated.readabilityContent ?? null,
        title: translated.title ?? null,
      }

      results[key] = translation
      await translationActions.upsertMany([translation])
    }

    return results
  }

  private async translateLocalMetadataFields({
    bridge,
    group,
    items,
    metadataFields,
    translations,
  }: {
    bridge: LocalAIBridge
    group: TranslationBatchGroup
    items: LocalAITranslationItem[]
    metadataFields: TranslationField[]
    translations: Record<string, TranslationModel>
  }) {
    if (metadataFields.length === 0) return

    const response = await bridge.translateEntries({
      fields: metadataFields.join(","),
      items: selectTranslationItemFields(items, metadataFields),
      language: group.language,
      mode: group.mode,
    })

    for (const id of group.ids) {
      if (this.currentMode && this.currentMode !== group.mode) return

      const translated = response[id]
      const translation = translations[id]
      if (!translated || !translation) continue

      translation.title = translated.title ?? null
      translation.description = translated.description ?? null
      translationActions.upsertManyInSession([translation])
    }
  }

  private async translateLocalGroupProgressively({
    bridge,
    fields,
    group,
    items,
  }: {
    bridge: LocalAIBridge
    fields: TranslationField[]
    group: TranslationBatchGroup
    items: LocalAITranslationItem[]
  }) {
    const results: Record<string, TranslationModel | null> = {}
    const translations = Object.fromEntries(
      group.ids.map((id) => [id, createEmptyTranslation(id, group.language)]),
    ) as Record<string, TranslationModel>
    const incompleteIds = new Set<string>()
    const streamState = { enabled: Boolean(bridge.streamTranslateText) }
    let contentError: unknown

    const metadataFields = fields.filter((field) => !isContentTranslationField(field))
    let metadataError: unknown
    const metadataPromise = this.translateLocalMetadataFields({
      bridge,
      group,
      items,
      metadataFields,
      translations,
    }).catch((error: unknown) => {
      metadataError = error
    })

    for (const field of fields.filter(isContentTranslationField)) {
      for (const item of items) {
        const sourceContent = item[field]
        const translation = translations[item.entryId]
        if (!sourceContent || !translation) continue

        const chunks = splitLongText(sourceContent)
        const partialKey = this.partialFieldKey(item.entryId, group.language, field)
        this.partialTranslationFields.add(partialKey)

        for (const chunk of chunks) {
          if (this.currentMode && this.currentMode !== group.mode) {
            const key = group.keyById[item.entryId]
            if (key) results[key] = null
            incompleteIds.add(item.entryId)
            break
          }

          const translated = await this.translateLocalContentChunk({
            bridge,
            chunk,
            field,
            group,
            item,
            streamState,
            translation,
          }).catch((error: unknown) => {
            console.error("Local translation chunk failed:", error)
            contentError ??= error
            return false
          })

          if (!translated) {
            incompleteIds.add(item.entryId)
            if (!translation[field] && contentError) throw contentError
            break
          }
          translationActions.upsertManyInSession([translation])
        }
      }
    }

    await metadataPromise
    if (metadataError) throw metadataError

    for (const id of group.ids) {
      const key = group.keyById[id]
      const translation = translations[id]
      if (!key || !translation) continue
      if (this.currentMode && this.currentMode !== group.mode) {
        results[key] = null
        for (const field of fields.filter(isContentTranslationField)) {
          this.partialTranslationFields.delete(this.partialFieldKey(id, group.language, field))
        }
        continue
      }
      if (incompleteIds.has(id)) {
        const hasPartialContent = fields
          .filter(isContentTranslationField)
          .some((field) => Boolean(translation[field]))
        results[key] = hasPartialContent ? translation : null
        if (hasPartialContent) {
          translationActions.upsertManyInSession([translation])
        }
        continue
      }

      results[key] = translation
      await translationActions.upsertMany([translation])
      for (const field of fields.filter(isContentTranslationField)) {
        this.partialTranslationFields.delete(this.partialFieldKey(id, group.language, field))
      }
    }

    return results
  }

  private async translateLocalContentChunk({
    bridge,
    chunk,
    field,
    group,
    item,
    streamState,
    translation,
  }: {
    bridge: LocalAIBridge
    chunk: string
    field: ContentTranslationField
    group: TranslationBatchGroup
    item: LocalAITranslationItem
    streamState: { enabled: boolean }
    translation: TranslationModel
  }) {
    if (bridge.streamTranslateText && streamState.enabled) {
      const base = translation[field] ?? ""
      let streamedChunk = ""
      let result
      try {
        result = await bridge.streamTranslateText({
          content: chunk,
          field,
          language: group.language,
          mode: group.mode,
          onDelta: (delta) => {
            if (!delta) return
            if (this.currentMode && this.currentMode !== group.mode) return

            streamedChunk += delta
            replaceLatestTranslationChunk({
              accumulated: translation,
              base,
              chunk: streamedChunk,
              field,
            })
            translationActions.upsertManyInSession([translation])
          },
        })
      } catch (error) {
        if (this.currentMode && this.currentMode !== group.mode) return false
        replaceLatestTranslationChunk({
          accumulated: translation,
          base,
          chunk: "",
          field,
        })
        const fallbackTranslated = await this.translateLocalContentChunkOnce({
          bridge,
          chunk,
          field,
          group,
          item,
          translation,
        })
        if (fallbackTranslated) {
          streamState.enabled = false
          return true
        }
        streamState.enabled = false
        if (streamedChunk) return false
        throw error
      }

      if (this.currentMode && this.currentMode !== group.mode) return false
      const translatedChunk = result.text || streamedChunk
      if (!translatedChunk) {
        const fallbackTranslated = await this.translateLocalContentChunkOnce({
          bridge,
          chunk,
          field,
          group,
          item,
          translation,
        })
        if (fallbackTranslated) {
          streamState.enabled = false
        }
        return fallbackTranslated
      }

      replaceLatestTranslationChunk({
        accumulated: translation,
        base,
        chunk: translatedChunk,
        field,
      })
      return true
    }

    return this.translateLocalContentChunkOnce({
      bridge,
      chunk,
      field,
      group,
      item,
      translation,
    })
  }

  private async translateLocalContentChunkOnce({
    bridge,
    chunk,
    field,
    group,
    item,
    translation,
  }: {
    bridge: LocalAIBridge
    chunk: string
    field: ContentTranslationField
    group: TranslationBatchGroup
    item: LocalAITranslationItem
    translation: TranslationModel
  }) {
    const chunkId = `${item.entryId}::${field}::${Date.now()}`
    const response = await bridge.translateEntries({
      fields: field,
      items: [
        {
          entryId: chunkId,
          [field]: chunk,
        },
      ],
      language: group.language,
      mode: group.mode,
    })
    if (this.currentMode && this.currentMode !== group.mode) return false
    mergeTranslationChunk({
      accumulated: translation,
      chunk: response[chunkId]?.[field],
      field,
    })
    return Boolean(response[chunkId]?.[field])
  }

  private translationBatcher = create({
    fetcher: async (keys: string[]) => {
      // key format: `${entryId}|${language}|${target}|${fields}|${mode}`
      type KeyParts = {
        entryId: string
        language: SupportedActionLanguage
        target: "content" | "readabilityContent"
        fields: string
        mode: TranslationMode
      }

      const parseKey = (key: string): KeyParts => {
        const [entryId, language, target, fields, mode] = key.split("|") as [
          string,
          SupportedActionLanguage,
          "content" | "readabilityContent",
          string,
          TranslationMode | undefined,
        ]
        return { entryId, language, target, fields, mode: mode ?? "bilingual" }
      }

      const requests = keys.map(parseKey)

      // Group by language + fields + mode to minimize stream calls
      const groupKey = (r: KeyParts) => `${r.language}#${r.fields}#${r.mode}`
      const grouped = new Map<string, TranslationBatchGroup>()

      for (const r of requests) {
        const gk = groupKey(r)
        if (!grouped.has(gk)) {
          grouped.set(gk, {
            language: r.language,
            fields: r.fields,
            mode: r.mode,
            ids: [],
            keyById: {},
          })
        }
        const g = grouped.get(gk)!
        g.ids.push(r.entryId)
        g.keyById[r.entryId] = `${r.entryId}|${r.language}|${r.target}|${r.fields}|${r.mode}`
      }

      const results: Record<string, TranslationModel | null> = {}

      // Execute each group sequentially to keep memory small; groups are already windowed by scheduler
      for (const [, group] of grouped) {
        if (this.currentMode && this.currentMode !== group.mode) {
          for (const id of group.ids) {
            if (!group.keyById[id]) continue
            results[group.keyById[id]] = null
          }
          continue
        }

        const localAIBridge = localAI()
        if (localAIBridge?.isFeatureEnabled("translation")) {
          try {
            const items = group.ids
              .map(createLocalTranslationItem)
              .filter((item): item is NonNullable<typeof item> => item !== null)

            if (items.length === 0) {
              for (const id of group.ids) {
                const key = group.keyById[id]
                if (key) results[key] = null
              }
              continue
            }

            Object.assign(
              results,
              await this.translateLocalGroup({
                bridge: localAIBridge,
                group,
                items,
              }),
            )
          } catch (e) {
            console.error("Local translation request failed:", e)
            throw e
          }
          continue
        }

        try {
          const request: TranslationBatchRequest & { mode?: TranslationMode } = {
            ids: group.ids,
            language: toApiSupportedActionLanguage(group.language),
            fields: group.fields,
            mode: group.mode,
          }
          const response = await api().ai.translationBatch(request)

          await readNdjsonStream<{
            id: string
            data: Partial<Record<keyof TranslationModel, string>>
          }>(response, async (json) => {
            const key = group.keyById[json.id]
            if (!key) return

            if (this.currentMode && this.currentMode !== group.mode) return

            const translation: TranslationModel = {
              entryId: json.id,
              language: group.language,
              title: null,
              description: null,
              content: null,
              readabilityContent: null,
            }

            const { title, description, content, readabilityContent } = json.data || {}
            if (typeof title === "string") translation.title = title
            if (typeof description === "string") translation.description = description
            if (typeof content === "string") translation.content = content
            if (typeof readabilityContent === "string")
              translation.readabilityContent = readabilityContent

            results[key] = translation
            await translationActions.upsertMany([translation])
          })
        } catch (e) {
          console.error("Translation stream request failed:", e)
        }
      }

      return results
    },
    resolver: indexedResolver(),
    scheduler: windowScheduler(TRANSLATION_BATCH_WINDOW_MS),
  })

  async generateTranslation({
    entryId,
    language,
    withContent,
    target,
    mode,
  }: {
    entryId: string
    language: SupportedActionLanguage
    withContent?: boolean
    target: "content" | "readabilityContent"
    mode?: TranslationMode
  }) {
    const userRole = useUserStore.getState().role
    const isLocalTranslationEnabled = localAI()?.isFeatureEnabled("translation") ?? false

    if (userRole === UserRole.Free && !isLocalTranslationEnabled) return null
    const translationMode = mode ?? "bilingual"
    await this.ensureMode(translationMode)

    const entry = getEntry(entryId)

    if (!entry) return
    const translationSession = translationActions.getTranslation(entryId, language)

    const fields = (
      ["title", "description", ...(withContent ? [target] : [])] as TranslationFieldArray
    ).filter((field) => {
      const content = entry[field]
      if (!content) return false

      if (
        translationSession?.[field] &&
        !this.partialTranslationFields.has(this.partialFieldKey(entryId, language, field))
      ) {
        return false
      }

      return !checkLanguage({
        content,
        language,
      })
    })

    if (fields.length === 0) return null

    const key = `${entryId}|${language}|${target}|${fields.join(",")}|${translationMode}`
    const result = await this.translationBatcher.fetch(key)
    return result || null
  }
}

export const translationSyncService = new TranslationSyncService()

const createLocalTranslationItem = (entryId: string) => {
  const entry = getEntry(entryId)
  if (!entry) return null

  return {
    content: entry.content ?? null,
    description: entry.description ?? null,
    entryId,
    readabilityContent: entry.readabilityContent ?? null,
    title: entry.title ?? null,
  }
}
