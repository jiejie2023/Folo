import type { LocalAIFeature } from "@follow/shared/settings/interface"

export interface LocalAISummaryInput {
  entryId: string
  title: string
  content: string
  target: "content" | "readabilityContent"
  language: string
}

export interface LocalAITranslationItem {
  entryId: string
  title?: string | null
  description?: string | null
  content?: string | null
  readabilityContent?: string | null
}

export interface LocalAITranslateEntriesInput {
  items: LocalAITranslationItem[]
  language: string
  fields: string
  mode: "bilingual" | "translation"
}

export interface LocalAITranslationResult {
  entryId: string
  title: string | null
  description: string | null
  content: string | null
  readabilityContent: string | null
}

export interface LocalAIBridge {
  isFeatureEnabled: (feature: LocalAIFeature) => boolean
  summarizeEntry: (input: LocalAISummaryInput) => Promise<string | null>
  translateEntries: (
    input: LocalAITranslateEntriesInput,
  ) => Promise<Record<string, LocalAITranslationResult | null>>
}
