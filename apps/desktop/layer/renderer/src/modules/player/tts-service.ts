import { localAI } from "@follow/store/context"
import type { EntryModel } from "@follow/store/entry/types"
import { parseHtml } from "@follow/utils/html"

export const TTS_SERVICE_URL = "https://tts.folo.is"
export const DEFAULT_TTS_VOICE = "en-US-AvaMultilingualNeural"

export interface TtsVoice {
  FriendlyName: string
  Gender: string
  Locale: string
  ShortName: string
}

interface TtsVoiceResponse {
  voices: TtsVoice[]
}

interface TtsErrorResponse {
  error?: {
    message?: string
  }
}

const normalizeTtsText = (value: string) =>
  value
    .replaceAll("\r\n", "\n")
    .replaceAll(/[^\S\n]+/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim()

const toPlainText = (value: string) => normalizeTtsText(parseHtml(value).toText())

export const getEntryTtsText = (
  entry: Pick<EntryModel, "content" | "description" | "readabilityContent" | "title">,
  options?: {
    preferReadability?: boolean
  },
) => {
  const { preferReadability = false } = options ?? {}

  const title = normalizeTtsText(entry.title || "")
  const bodySource = preferReadability
    ? entry.readabilityContent || entry.content || entry.description || ""
    : entry.content || entry.description || entry.readabilityContent || ""
  const body = bodySource ? toPlainText(bodySource) : ""

  return [title, body].filter(Boolean).join("\n\n")
}

const readTtsErrorMessage = async (response: Response) => {
  try {
    const data = (await response.clone().json()) as TtsErrorResponse
    return data?.error?.message || "TTS request failed"
  } catch {
    return "TTS request failed"
  }
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError")
  }
}

export const fetchTtsVoices = async (signal?: AbortSignal) => {
  const response = await fetch(`${TTS_SERVICE_URL}/voices`, { signal })

  if (!response.ok) {
    throw new Error(await readTtsErrorMessage(response))
  }

  const data = (await response.json()) as TtsVoiceResponse
  return data.voices ?? []
}

export const requestTts = async ({
  signal,
  text,
  voice,
}: {
  text: string
  voice?: string
  signal?: AbortSignal
}) => {
  const normalizedText = normalizeTtsText(text)
  if (!normalizedText) {
    throw new Error("Text is required")
  }

  const normalizedVoice = voice?.trim()
  const localAIBridge = localAI()
  if (localAIBridge?.isFeatureEnabled("tts")) {
    throwIfAborted(signal)
    const result = await localAIBridge.synthesizeSpeech({
      format: "mp3",
      text: normalizedText,
      voice: normalizedVoice,
    })
    throwIfAborted(signal)

    const audioBytes = base64ToBytes(result.audioBase64)
    const audioBody = audioBytes.buffer.slice(0) as ArrayBuffer
    return new Response(audioBody, {
      headers: {
        "content-type": result.mimeType,
      },
    })
  }

  const response = await fetch(`${TTS_SERVICE_URL}/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: normalizedText,
      ...(normalizedVoice ? { voice: normalizedVoice } : {}),
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(await readTtsErrorMessage(response))
  }

  return response
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0
  }
  return bytes
}
