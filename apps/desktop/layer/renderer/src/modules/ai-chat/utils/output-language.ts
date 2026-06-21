const OUTPUT_LANGUAGE_INSTRUCTION_PREFIX = "Folo AI output language instruction:"

const OUTPUT_LANGUAGE_LABELS: Record<string, string> = {
  en: "English (en)",
  "fr-FR": "French (fr-FR)",
  ja: "Japanese (ja)",
  "zh-CN": "Simplified Chinese (zh-CN)",
  "zh-TW": "Traditional Chinese (zh-TW)",
}

export const getAIOutputLanguageLabel = (language: string): string =>
  OUTPUT_LANGUAGE_LABELS[language] ?? language

export const buildAIOutputLanguageInstruction = (language: string): string =>
  `${OUTPUT_LANGUAGE_INSTRUCTION_PREFIX} Respond in ${getAIOutputLanguageLabel(language)}. Do not switch to another language unless the user's request explicitly asks for a different language.`

export const appendAIOutputLanguageInstruction = (prompt: string, language: string): string => {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) {
    return normalizedPrompt
  }

  if (normalizedPrompt.includes(OUTPUT_LANGUAGE_INSTRUCTION_PREFIX)) {
    return normalizedPrompt
  }

  return `${normalizedPrompt}\n\n${buildAIOutputLanguageInstruction(language)}`
}
