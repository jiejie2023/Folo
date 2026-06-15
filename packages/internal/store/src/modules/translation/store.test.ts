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
    const translateEntries = vi.fn().mockResolvedValue({
      [entryId]: {
        content: "本地正文",
        description: "本地描述",
        entryId,
        readabilityContent: null,
        title: "本地标题",
      },
    })
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
      content: "本地正文",
      description: "本地描述",
      entryId,
      language: "zh-CN",
      readabilityContent: null,
      title: "本地标题",
    })

    expect(translationBatchMock).not.toHaveBeenCalled()
    expect(translateEntries).toHaveBeenCalledWith({
      fields: "title,description,content",
      items: [
        {
          content: "Original content",
          description: "Original description",
          entryId,
          readabilityContent: "Readable content",
          title: "Original title",
        },
      ],
      language: "zh-CN",
      mode: "translation-only",
    })
    expect(insertTranslationMock).toHaveBeenCalledWith({
      content: "本地正文",
      description: "本地描述",
      entryId,
      language: "zh-CN",
      readabilityContent: null,
      title: "本地标题",
    })
  })
})
