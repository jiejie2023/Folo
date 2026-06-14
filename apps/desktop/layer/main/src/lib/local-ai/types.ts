export type LocalAIProviderType = "openai-compatible"

export type LocalAITestResult = {
  message: string
  ok: boolean
  testedAt: string
}

export type LocalAIProfileUpsertInput = {
  apiKey?: string | null
  baseURL: string
  defaultChatModel: string | null
  defaultSummaryModel: string | null
  defaultTaskModel: string | null
  defaultTimelineModel: string | null
  defaultTranslationModel: string | null
  defaultTtsModel: string | null
  enabled: boolean
  headers: Record<string, string>
  id?: string
  models: string[]
  name: string
  providerType: LocalAIProviderType
  supportsJsonMode: boolean
  supportsStreaming: boolean
  supportsTools: boolean
  supportsTts: boolean
}

export type LocalAIStoredProfile = Omit<LocalAIProfileUpsertInput, "apiKey" | "id"> & {
  createdAt: string
  id: string
  lastTestedAt: string | null
  lastTestResult: LocalAITestResult | null
  updatedAt: string
}

export type LocalAIProfileView = LocalAIStoredProfile & {
  maskedApiKey: string | null
}
