import { UserRole } from "@follow/constants"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { apiContext, localAIContext } from "../../context"
import type { FollowAPI } from "../../types"
import { useEntryStore } from "../entry/store"
import type { EntryModel } from "../entry/types"
import type { LocalAIBridge } from "../local-ai/types"
import { useUserStore } from "../user/store"
import { translationSyncService, useTranslationStore } from "./store"

const { insertTranslationMock } = vi.hoisted(() => ({
  insertTranslationMock: vi.fn(),
}))

vi.mock("@follow/database/services/translation", () => ({
  TranslationService: {
    getTranslationToHydrate: vi.fn(),
    insertTranslation: insertTranslationMock,
    reset: vi.fn(),
  },
}))

const createEntry = (id: string): EntryModel => ({
  content: "Original content",
  description: "Original description",
  guid: `${id}-guid`,
  id,
  insertedAt: new Date("2026-01-01T00:00:00.000Z"),
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  readabilityContent: "Readable content",
  title: "Original title",
})

const createLocalAIBridge = (overrides: Partial<LocalAIBridge>): LocalAIBridge =>
  ({
    isFeatureEnabled: vi.fn(() => false),
    translateEntries: vi.fn(async () => ({})),
    ...overrides,
  }) as LocalAIBridge

describe("translationSyncService", () => {
  const entryId = "entry-1"
  const translationBatchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    useEntryStore.setState({
      data: {
        [entryId]: createEntry(entryId),
      },
    })
    useTranslationStore.setState({
      data: {},
    })
    useUserStore.setState({
      role: UserRole.Free,
    })
    apiContext.provide({
      ai: {
        translationBatch: translationBatchMock,
      },
    } as unknown as FollowAPI)
    localAIContext.provide()
  })

  test("uses local AI translation even when the current account is free", async () => {
    const translateEntries = vi.fn(
      async (input: Parameters<LocalAIBridge["translateEntries"]>[0]) => {
        const item = input.items[0]!
        if (input.fields === "content") {
          return {
            [item.entryId]: {
              content: "Local content",
              description: null,
              entryId: item.entryId,
              readabilityContent: null,
              title: null,
            },
          }
        }

        return {
          [entryId]: {
            content: null,
            description: "Local description",
            entryId,
            readabilityContent: null,
            title: "Local title",
          },
        }
      },
    )
    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        translateEntries,
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "translation-only",
        target: "content",
        withContent: true,
      }),
    ).resolves.toEqual({
      content: "Local content",
      description: "Local description",
      entryId,
      language: "zh-CN",
      readabilityContent: null,
      title: "Local title",
    })

    expect(translationBatchMock).not.toHaveBeenCalled()
    expect(translateEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: "title,description",
      }),
    )
    expect(translateEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: "content",
        items: [expect.objectContaining({ content: "Original content" })],
      }),
    )
    expect(insertTranslationMock).toHaveBeenCalledWith({
      content: "Local content",
      description: "Local description",
      entryId,
      language: "zh-CN",
      readabilityContent: null,
      title: "Local title",
    })
  })

  test("updates local AI content translations progressively while later paragraphs are still translating", async () => {
    const longFirstParagraph = `<p>${"Original first sentence. ".repeat(20)}</p>`
    const longSecondParagraph = `<p>${"Original second sentence. ".repeat(180)}</p>`
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: `${longFirstParagraph}${longSecondParagraph}`,
          description: "描述",
          title: "标题",
        },
      },
    })

    let resolveSecondChunk!: () => void
    const secondChunkReady = new Promise<void>((resolve) => {
      resolveSecondChunk = resolve
    })
    const firstTranslation = "<p>Translated first paragraph.</p>"
    const secondTranslation = "<p>Translated second paragraph.</p>"

    const translateEntries = vi.fn(async (input) => {
      const item = input.items[0]!
      const content = item.content ?? ""

      if (input.fields !== "content") {
        return {
          [item.entryId]: {
            content: null,
            description: null,
            entryId: item.entryId,
            readabilityContent: null,
            title: null,
          },
        }
      }

      if (content.includes("Original second sentence.")) {
        await secondChunkReady
        return {
          [item.entryId]: {
            content: secondTranslation,
            description: null,
            entryId: item.entryId,
            readabilityContent: null,
            title: null,
          },
        }
      }

      return {
        [item.entryId]: {
          content: firstTranslation,
          description: null,
          entryId: item.entryId,
          readabilityContent: null,
          title: null,
        },
      }
    })
    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        translateEntries,
      }),
    )

    const translationPromise = translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    await vi.waitFor(
      () => {
        expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe(
          firstTranslation,
        )
      },
      { timeout: 3000 },
    )

    expect(insertTranslationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: firstTranslation,
      }),
    )

    resolveSecondChunk()

    const result = await translationPromise
    expect(result).toMatchObject({
      entryId,
      language: "zh-CN",
    })
    expect(result?.content?.startsWith(firstTranslation)).toBe(true)
    expect(result?.content).toContain(secondTranslation)
    expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toContain(
      secondTranslation,
    )
    expect(insertTranslationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(secondTranslation),
      }),
    )
  })

  test("streams local AI content translation deltas before the request finishes", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "Original streaming content. ".repeat(20),
        },
      },
    })

    let finishStream!: () => void
    const streamFinished = new Promise<void>((resolve) => {
      finishStream = resolve
    })
    const streamTranslateText = vi.fn(async (input) => {
      input.onDelta?.("stream-")
      await streamFinished
      input.onDelta?.("complete")
      return { text: "stream-complete" }
    })
    const translateEntries = vi.fn(async (input) => {
      const item = input.items[0]!
      return {
        [item.entryId]: {
          content: input.fields === "content" ? "non-streamed" : null,
          description: null,
          entryId: item.entryId,
          readabilityContent: null,
          title: null,
        },
      }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        translateEntries,
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    const translationPromise = translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "translation-only",
      target: "content",
      withContent: true,
    })

    await vi.waitFor(
      () => {
        expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe("stream-")
      },
      { timeout: 1800 },
    )

    expect(insertTranslationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: "stream-",
      }),
    )

    finishStream()

    await expect(translationPromise).resolves.toMatchObject({
      content: "stream-complete",
      entryId,
      language: "zh-CN",
    })
    expect(streamTranslateText).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Original streaming content."),
        field: "content",
        language: "zh-CN",
        mode: "translation-only",
        onDelta: expect.any(Function),
      }),
    )
    expect(insertTranslationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "stream-complete",
      }),
    )
  })

  test("streams local AI content translation for regular length entries", async () => {
    let finishStream!: () => void
    const streamFinished = new Promise<void>((resolve) => {
      finishStream = resolve
    })
    const streamTranslateText = vi.fn(async (input) => {
      input.onDelta?.("短文")
      await streamFinished
      input.onDelta?.("译文")
      return { text: "短文译文" }
    })
    const translateEntries = vi.fn(async (input) => {
      const item = input.items[0]!
      return {
        [item.entryId]: {
          content: input.fields.includes("content") ? "non-streamed content" : null,
          description: input.fields.includes("description") ? "本地描述" : null,
          entryId: item.entryId,
          readabilityContent: null,
          title: input.fields.includes("title") ? "本地标题" : null,
        },
      }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        translateEntries,
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    const translationPromise = translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "translation-only",
      target: "content",
      withContent: true,
    })

    await vi.waitFor(
      () => {
        expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe("短文")
      },
      { timeout: 1800 },
    )

    expect(translateEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: "title,description",
      }),
    )
    expect(translateEntries).not.toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.stringContaining("content"),
      }),
    )

    finishStream()

    await expect(translationPromise).resolves.toMatchObject({
      content: "短文译文",
      description: "本地描述",
      entryId,
      language: "zh-CN",
      title: "本地标题",
    })
  })

  test("starts local AI content streaming before metadata translation finishes", async () => {
    let finishMetadata!: () => void
    const metadataFinished = new Promise<void>((resolve) => {
      finishMetadata = resolve
    })
    const translateEntries = vi.fn(async (input) => {
      await metadataFinished
      const item = input.items[0]!
      return {
        [item.entryId]: {
          content: null,
          description: input.fields.includes("description") ? "Translated description" : null,
          entryId: item.entryId,
          readabilityContent: null,
          title: input.fields.includes("title") ? "Translated title" : null,
        },
      }
    })
    const streamTranslateText = vi.fn(async (input) => {
      input.onDelta?.("streamed content")
      return { text: "streamed content" }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        translateEntries,
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    const translationPromise = translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "translation-only",
      target: "content",
      withContent: true,
    })

    await vi.waitFor(
      () => {
        expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe(
          "streamed content",
        )
      },
      { timeout: 1800 },
    )
    expect(translateEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: "title,description",
        items: [
          {
            description: "Original description",
            entryId,
            title: "Original title",
          },
        ],
      }),
    )
    expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.title).toBeNull()

    finishMetadata()

    await expect(translationPromise).resolves.toMatchObject({
      content: "streamed content",
      description: "Translated description",
      entryId,
      language: "zh-CN",
      title: "Translated title",
    })
  })

  test("streams local AI content one paragraph at a time", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<p>First paragraph.</p><p>Second paragraph.</p>",
        },
      },
    })

    let releaseSecondParagraph!: () => void
    const secondParagraphReady = new Promise<void>((resolve) => {
      releaseSecondParagraph = resolve
    })
    const streamTranslateText = vi.fn(async (input) => {
      if (input.content.includes("Second paragraph.")) {
        await secondParagraphReady
        input.onDelta?.("<p>Translated second.</p>")
        return { text: "<p>Translated second.</p>" }
      }

      input.onDelta?.("<p>Translated first.</p>")
      return { text: "<p>Translated first.</p>" }
    })
    const translateEntries = vi.fn(async (input) => {
      const item = input.items[0]!
      return {
        [item.entryId]: {
          content: null,
          description: input.fields.includes("description") ? "Translated description" : null,
          entryId: item.entryId,
          readabilityContent: null,
          title: input.fields.includes("title") ? "Translated title" : null,
        },
      }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        translateEntries,
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    const translationPromise = translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    await vi.waitFor(
      () => {
        expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe(
          "<p>Translated first.</p>",
        )
      },
      { timeout: 1800 },
    )

    expect(streamTranslateText).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<p>First paragraph.</p>",
      }),
    )
    expect(streamTranslateText).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("First paragraph.</p><p>Second paragraph."),
      }),
    )

    releaseSecondParagraph()

    await expect(translationPromise).resolves.toMatchObject({
      content: "<p>Translated first.</p><p>Translated second.</p>",
      entryId,
      language: "zh-CN",
    })
  })

  test("treats blank-line separated plain text as paragraph translation units", async () => {
    const firstParagraph =
      "A lot has happened last month. Apple announced on-device LLMs, Nvidia shared Nemotron, and FlashAttention-3 was announced."
    const secondParagraph =
      "You have probably already read about it all in various news outlets, so this article focuses on recent research."

    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: `${firstParagraph}\n\n${secondParagraph}`,
        },
      },
    })

    const streamTranslateText = vi.fn(async (input) => {
      if (input.content === firstParagraph) {
        input.onDelta?.("Translated first paragraph.")
        return { text: "Translated first paragraph." }
      }

      input.onDelta?.("Translated second paragraph.")
      return { text: "Translated second paragraph." }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "bilingual",
        target: "content",
        withContent: true,
      }),
    ).resolves.toMatchObject({
      content: "Translated first paragraph.Translated second paragraph.",
      entryId,
      language: "zh-CN",
    })

    const streamedContents = streamTranslateText.mock.calls.map(([input]) => input.content)
    expect(streamedContents).toEqual([firstParagraph, secondParagraph])
  })

  test("treats double-break html as paragraph translation units", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<div>First visual paragraph.<br><br>Second visual paragraph.</div>",
        },
      },
    })

    const streamTranslateText = vi.fn(async (input) => {
      const text = input.content.includes("First") ? "Translated first." : "Translated second."
      const translated = `<p>${text}</p>`
      input.onDelta?.(translated)
      return { text: translated }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    await translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    const streamedContents = streamTranslateText.mock.calls.map(([input]) => input.content)
    expect(streamedContents).toEqual([
      "<p>First visual paragraph.</p>",
      "<p>Second visual paragraph.</p>",
    ])
  })

  test("unwraps nested layout containers without sending malformed html chunks", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content:
            "<article><div><p>First nested paragraph.</p><p>Second nested paragraph.</p></div></article>",
        },
      },
    })

    const streamTranslateText = vi.fn(async (input) => ({
      text: input.content.includes("First")
        ? "<p>Translated first.</p>"
        : "<p>Translated second.</p>",
    }))

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    await translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    expect(streamTranslateText.mock.calls.map(([input]) => input.content)).toEqual([
      "<p>First nested paragraph.</p>",
      "<p>Second nested paragraph.</p>",
    ])
  })

  test("keeps structural list blocks intact as one translation unit", async () => {
    const list = "<ul><li>First point.</li><li>Second point.</li></ul>"
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: `<div>${list}</div>`,
        },
      },
    })

    const streamTranslateText = vi.fn(async () => ({
      text: "<ul><li>Translated first.</li><li>Translated second.</li></ul>",
    }))

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    await translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    expect(streamTranslateText).toHaveBeenCalledTimes(1)
    expect(streamTranslateText).toHaveBeenCalledWith(expect.objectContaining({ content: list }))
  })

  test("keeps nested structural blocks balanced", async () => {
    const nestedList =
      "<ul><li>Parent point.<ul><li>Nested point.</li></ul></li><li>Sibling point.</li></ul>"
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: nestedList,
        },
      },
    })

    const streamTranslateText = vi.fn(async () => ({
      text: "<ul><li>Translated parent.</li><li>Translated sibling.</li></ul>",
    }))
    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    await translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    expect(streamTranslateText).toHaveBeenCalledTimes(1)
    expect(streamTranslateText).toHaveBeenCalledWith(
      expect.objectContaining({ content: nestedList }),
    )
  })

  test("keeps a long paragraph as one local AI translation unit", async () => {
    const longParagraph = `<p>First sentence. ${"Second sentence keeps going. ".repeat(600)}</p>`
    expect(longParagraph.length).toBeGreaterThan(12_000)
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: `${longParagraph}<p>Next paragraph.</p>`,
        },
      },
    })

    let releaseNextParagraph!: () => void
    const nextParagraphReady = new Promise<void>((resolve) => {
      releaseNextParagraph = resolve
    })
    const streamTranslateText = vi.fn(async (input) => {
      if (input.content === longParagraph) {
        input.onDelta?.("<p>长段落译文。</p>")
        return { text: "<p>长段落译文。</p>" }
      }

      await nextParagraphReady
      input.onDelta?.("<p>下一段。</p>")
      return { text: "<p>下一段。</p>" }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    const translationPromise = translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    await vi.waitFor(
      () => {
        expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe(
          "<p>长段落译文。</p>",
        )
      },
      { timeout: 1800 },
    )

    const streamedContents = streamTranslateText.mock.calls.map(([input]) => input.content)
    expect(streamedContents).toContain(longParagraph)
    expect(streamedContents).not.toContain("<p>First sentence.</p>")

    releaseNextParagraph()

    await expect(translationPromise).resolves.toMatchObject({
      content: "<p>长段落译文。</p><p>下一段。</p>",
      entryId,
      language: "zh-CN",
    })
  })

  test("does not send media-only html nodes to local AI content translation", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content:
            '<p>Before media.</p><img src="cover.jpg" alt="Cover"><video controls src="clip.mp4"></video><p>After media.</p>',
        },
      },
    })

    const streamTranslateText = vi.fn(async (input) => {
      if (input.content.includes("Before media.")) {
        input.onDelta?.("<p>媒体前。</p>")
        return { text: "<p>媒体前。</p>" }
      }
      if (input.content.includes("After media.")) {
        input.onDelta?.("<p>媒体后。</p>")
        return { text: "<p>媒体后。</p>" }
      }
      return { text: "" }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "bilingual",
        target: "content",
        withContent: true,
      }),
    ).resolves.toMatchObject({
      content: "<p>媒体前。</p><p>媒体后。</p>",
      entryId,
      language: "zh-CN",
    })

    const streamedContents = streamTranslateText.mock.calls.map(([input]) => input.content)
    expect(streamedContents).toContain("<p>Before media.</p>")
    expect(streamedContents).toContain("<p>After media.</p>")
    expect(streamedContents.join("\n")).not.toContain("<img")
    expect(streamedContents.join("\n")).not.toContain("<video")
  })

  test("keeps completed local AI chunks when a later long translation chunk fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: `<p>First paragraph.</p><p>${"Second paragraph is too slow. ".repeat(80)}</p>`,
        },
      },
    })

    const streamTranslateText = vi.fn(async (input) => {
      if (input.content === "<p>First paragraph.</p>") {
        input.onDelta?.("<p>Translated first.</p>")
        return { text: "<p>Translated first.</p>" }
      }

      throw new Error("provider timeout")
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    const result = await translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })

    expect(result).toMatchObject({
      content: "<p>Translated first.</p>",
      entryId,
      language: "zh-CN",
    })
    expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe(
      "<p>Translated first.</p>",
    )
    expect(insertTranslationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<p>Translated first.</p>",
      }),
    )
    expect(consoleError).toHaveBeenCalledWith("Local translation chunk failed:", expect.any(Error))
    consoleError.mockRestore()
  })

  test("falls back to non-streaming local translation when content streaming fails before output", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<p>Hello world.</p>",
          description: "Description",
          title: "Title",
        },
      },
    })

    const streamTranslateText = vi.fn(async () => {
      throw new Error("stream did not produce tokens")
    })
    const translateEntries = vi.fn(async (input) => {
      const chunkId = input.items[0]?.entryId
      return chunkId
        ? {
            [chunkId]: {
              content: "<p>你好，世界。</p>",
              description: null,
              entryId: chunkId,
              readabilityContent: null,
              title: null,
            },
          }
        : {}
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
        translateEntries,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
        translateEntries: typeof translateEntries
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "bilingual",
        target: "content",
        withContent: true,
      }),
    ).resolves.toMatchObject({
      content: "<p>你好，世界。</p>",
      entryId,
      language: "zh-CN",
    })

    expect(streamTranslateText).toHaveBeenCalled()
    expect(translateEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: "content",
        language: "zh-CN",
        mode: "bilingual",
      }),
    )
    expect(insertTranslationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<p>你好，世界。</p>",
        entryId,
        language: "zh-CN",
      }),
    )
  })

  test("replaces partial stream output when the complete fallback succeeds", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<p>Hello world.</p>",
          description: "描述",
          title: "标题",
        },
      },
    })

    const streamTranslateText = vi.fn(async (input) => {
      input.onDelta?.("<p>Partial")
      throw new Error("stream disconnected")
    })
    const translateEntries = vi.fn(async (input) => {
      const chunkId = input.items[0]?.entryId
      return chunkId
        ? {
            [chunkId]: {
              content: "<p>Complete translation.</p>",
              description: null,
              entryId: chunkId,
              readabilityContent: null,
              title: null,
            },
          }
        : {}
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
        translateEntries,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
        translateEntries: typeof translateEntries
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "bilingual",
        target: "content",
        withContent: true,
      }),
    ).resolves.toMatchObject({
      content: "<p>Complete translation.</p>",
      entryId,
      language: "zh-CN",
    })
  })

  test("rejects a total local translation failure so the query layer can retry", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<p>Hello world.</p>",
          description: "描述",
          title: "标题",
        },
      },
    })

    const streamTranslateText = vi.fn(async () => {
      throw new Error("stream unavailable")
    })
    const translateEntries = vi.fn(async () => {
      throw new Error("fallback unavailable")
    })
    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
        translateEntries,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
        translateEntries: typeof translateEntries
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "bilingual",
        target: "content",
        withContent: true,
      }),
    ).rejects.toThrow("fallback unavailable")
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test("does not let an obsolete translation mode overwrite the latest result", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<p>Hello world.</p>",
          description: "描述",
          title: "标题",
        },
      },
    })

    let releaseObsoleteStream!: () => void
    const obsoleteStreamPending = new Promise<void>((resolve) => {
      releaseObsoleteStream = resolve
    })
    const streamTranslateText = vi.fn(async (input) => {
      if (input.mode === "bilingual") {
        await obsoleteStreamPending
        return { text: "<p>Obsolete translation.</p>" }
      }
      return { text: "<p>Latest translation.</p>" }
    })
    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
      }),
    )

    const obsoleteRequest = translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "bilingual",
      target: "content",
      withContent: true,
    })
    await vi.waitFor(() => expect(streamTranslateText).toHaveBeenCalledTimes(1))

    await translationSyncService.generateTranslation({
      entryId,
      language: "zh-CN",
      mode: "translation-only",
      target: "content",
      withContent: true,
    })
    releaseObsoleteStream()
    await obsoleteRequest

    expect(useTranslationStore.getState().data[entryId]?.["zh-CN"]?.content).toBe(
      "<p>Latest translation.</p>",
    )
  })

  test("falls back to non-streaming local translation when content streaming returns empty text", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<p>Hello again.</p>",
          description: "Description",
          title: "Title",
        },
      },
    })

    const streamTranslateText = vi.fn(async () => ({ text: "" }))
    const translateEntries = vi.fn(async (input) => {
      const chunkId = input.items[0]?.entryId
      return chunkId
        ? {
            [chunkId]: {
              content: "<p>再次你好。</p>",
              description: null,
              entryId: chunkId,
              readabilityContent: null,
              title: null,
            },
          }
        : {}
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
        translateEntries,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
        translateEntries: typeof translateEntries
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "bilingual",
        target: "content",
        withContent: true,
      }),
    ).resolves.toMatchObject({
      content: "<p>再次你好。</p>",
      entryId,
      language: "zh-CN",
    })

    expect(streamTranslateText).toHaveBeenCalled()
    expect(translateEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: "content",
        language: "zh-CN",
        mode: "bilingual",
      }),
    )
  })

  test("uses non-streaming local translation for remaining chunks after a stream failure", async () => {
    useEntryStore.setState({
      data: {
        [entryId]: {
          ...createEntry(entryId),
          content: "<p>First paragraph.</p><p>Second paragraph.</p>",
          description: "Description",
          title: "Title",
        },
      },
    })

    const streamTranslateText = vi.fn(async () => {
      throw new Error("stream unavailable")
    })
    const translateEntries = vi.fn(async (input) => {
      const chunkId = input.items[0]?.entryId
      const chunk = input.items[0]?.content
      if (!chunkId || typeof chunk !== "string") return {}

      return {
        [chunkId]: {
          content: chunk.includes("First") ? "<p>第一段。</p>" : "<p>第二段。</p>",
          description: null,
          entryId: chunkId,
          readabilityContent: null,
          title: null,
        },
      }
    })

    localAIContext.provide(
      createLocalAIBridge({
        isFeatureEnabled: vi.fn((feature) => feature === "translation"),
        streamTranslateText,
        translateEntries,
      } as Partial<LocalAIBridge> & {
        streamTranslateText: typeof streamTranslateText
        translateEntries: typeof translateEntries
      }),
    )

    await expect(
      translationSyncService.generateTranslation({
        entryId,
        language: "zh-CN",
        mode: "bilingual",
        target: "content",
        withContent: true,
      }),
    ).resolves.toMatchObject({
      content: "<p>第一段。</p><p>第二段。</p>",
      entryId,
      language: "zh-CN",
    })

    expect(streamTranslateText).toHaveBeenCalledTimes(1)
    expect(
      translateEntries.mock.calls.filter(([input]) => input.fields === "content"),
    ).toHaveLength(2)
  })
})
