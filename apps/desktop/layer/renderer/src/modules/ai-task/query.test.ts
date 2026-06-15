import type { AISettings } from "@follow/shared/settings/interface"
import { defaultAISettings } from "@follow/shared/settings/defaults"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopLocalAIProfile } from "~/modules/local-ai/hooks"

import {
  createAITask,
  deleteAITask,
  getAITask,
  listAITasks,
  runDueLocalAITasks,
  testRunAITask,
  updateAITask,
} from "./query"

const mocks = vi.hoisted(() => ({
  createDesktopLocalAIBridge: vi.fn(),
  ensureSession: vi.fn(),
  followCreate: vi.fn(),
  followDelete: vi.fn(),
  followGet: vi.fn(),
  followList: vi.fn(),
  followTestRun: vi.fn(),
  followUpdate: vi.fn(),
  getAISettings: vi.fn(),
  getLocalAIProfileId: vi.fn(),
  runTask: vi.fn(),
  setAISetting: vi.fn(),
  upsertMessages: vi.fn(),
}))

vi.mock("~/lib/api-client", () => ({
  followApi: {
    aiTask: {
      create: mocks.followCreate,
      delete: mocks.followDelete,
      get: mocks.followGet,
      list: mocks.followList,
      testRun: mocks.followTestRun,
      update: mocks.followUpdate,
    },
  },
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: mocks.getAISettings,
  setAISetting: mocks.setAISetting,
}))

vi.mock("~/modules/local-ai/bridge", () => ({
  createDesktopLocalAIBridge: mocks.createDesktopLocalAIBridge,
}))

vi.mock("~/modules/local-ai/hooks", () => ({
  getLocalAIProfileId: mocks.getLocalAIProfileId,
}))

vi.mock("~/modules/ai-chat/services", () => ({
  AIPersistService: {
    ensureSession: mocks.ensureSession,
    upsertMessages: mocks.upsertMessages,
  },
}))

const createSettings = (overrides: Partial<AISettings> = {}): AISettings => ({
  ...defaultAISettings,
  localAI: {
    ...defaultAISettings.localAI,
    defaultProfileId: "profile-1",
    enabled: true,
    featureRouting: {
      ...defaultAISettings.localAI.featureRouting,
      tasks: "local",
    },
  },
  ...overrides,
})

const taskInput = {
  name: "Daily research",
  prompt: "Summarize important AI research.",
  schedule: {
    date: "2026-06-16T08:00:00.000Z",
    type: "once" as const,
  },
  options: { notifyChannels: ["email" as const] },
}

const localProfile: DesktopLocalAIProfile = {
  baseURL: "https://example.com/v1",
  createdAt: "2026-06-15T00:00:00.000Z",
  defaultChatModel: "chat-model",
  defaultSummaryModel: null,
  defaultTaskModel: "task-model",
  defaultTimelineModel: null,
  defaultTranslationModel: null,
  defaultTtsModel: null,
  enabled: true,
  headers: {},
  id: "profile-1",
  lastTestedAt: null,
  lastTestResult: null,
  maskedApiKey: "sk-...",
  models: ["task-model"],
  name: "Local",
  providerType: "openai-compatible",
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsTts: false,
  updatedAt: "2026-06-15T00:00:00.000Z",
}

describe("local AI task data layer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLocalAIProfileId.mockReturnValue("profile-1")
    mocks.getAISettings.mockReturnValue(createSettings({ aiTasks: [] }))
    mocks.createDesktopLocalAIBridge.mockReturnValue({
      listProfiles: vi.fn(async () => [localProfile]),
      runTask: mocks.runTask,
    })
    mocks.runTask.mockResolvedValue({ output: "Local task result." })
  })

  it("stores created tasks locally when tasks route to local AI", async () => {
    const response = await createAITask(taskInput)

    expect(mocks.followCreate).not.toHaveBeenCalled()
    expect(response.data).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^local-ai-task-/),
        name: taskInput.name,
        prompt: taskInput.prompt,
      }),
    )
    expect(mocks.setAISetting).toHaveBeenCalledWith("aiTasks", [response.data])
  })

  it("lists, reads, updates, and deletes local tasks from AI settings", async () => {
    const settings = createSettings({
      aiTasks: [
        {
          ...taskInput,
          id: "local-ai-task-1",
          createdAt: "2026-06-15T00:00:00.000Z",
          isEnabled: true,
          lastError: null,
          lastResult: null,
          lastRunAt: null,
          nextRunAt: "2026-06-16T08:00:00.000Z",
          runCount: 0,
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
    })
    mocks.getAISettings.mockReturnValue(settings)

    await expect(listAITasks()).resolves.toEqual(settings.aiTasks)
    await expect(getAITask("local-ai-task-1")).resolves.toEqual(settings.aiTasks[0])

    const updateResponse = await updateAITask({
      id: "local-ai-task-1",
      name: "Updated",
    })
    expect(updateResponse.data.name).toBe("Updated")
    expect(mocks.setAISetting).toHaveBeenLastCalledWith("aiTasks", [
      expect.objectContaining({ id: "local-ai-task-1", name: "Updated" }),
    ])

    await deleteAITask({ id: "local-ai-task-1" })
    expect(mocks.setAISetting).toHaveBeenLastCalledWith("aiTasks", [])
  })

  it("runs local task tests through the configured local AI profile", async () => {
    const settings = createSettings({
      aiTasks: [
        {
          ...taskInput,
          id: "local-ai-task-1",
          createdAt: "2026-06-15T00:00:00.000Z",
          isEnabled: true,
          lastError: null,
          lastResult: null,
          lastRunAt: null,
          nextRunAt: "2026-06-16T08:00:00.000Z",
          runCount: 0,
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
    })
    mocks.getAISettings.mockReturnValue(settings)

    const response = await testRunAITask({ id: "local-ai-task-1" })

    expect(mocks.followTestRun).not.toHaveBeenCalled()
    expect(mocks.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "tasks",
        prompt: taskInput.prompt,
        profileId: "profile-1",
      }),
    )
    expect(response.data).toEqual(
      expect.objectContaining({
        result: "Local task result.",
        sessionId: expect.stringMatching(/^ai-task-local-ai-task-1-/),
        taskId: "local-ai-task-1",
      }),
    )
    expect(mocks.ensureSession).toHaveBeenCalledWith(
      response.data.sessionId,
      expect.objectContaining({
        isLocal: true,
        title: taskInput.name,
      }),
    )
    expect(mocks.upsertMessages).toHaveBeenCalled()
    expect(mocks.setAISetting).toHaveBeenCalledWith("aiTasks", [
      expect.objectContaining({
        id: "local-ai-task-1",
        lastError: null,
        lastResult: "Local task result.",
        runCount: 1,
      }),
    ])
  })

  it("runs due local tasks and advances recurring schedules", async () => {
    const settings = createSettings({
      aiTasks: [
        {
          ...taskInput,
          id: "local-ai-task-1",
          createdAt: "2026-06-15T00:00:00.000Z",
          isEnabled: true,
          lastError: null,
          lastResult: null,
          lastRunAt: null,
          nextRunAt: "2026-06-15T08:00:00.000Z",
          options: { notifyChannels: ["email"] },
          runCount: 0,
          schedule: {
            timeOfDay: "2026-06-15T08:00:00.000Z",
            type: "daily",
          },
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
    })
    mocks.getAISettings.mockReturnValue(settings)

    await runDueLocalAITasks(new Date("2026-06-15T08:01:00.000Z"))

    expect(mocks.runTask).toHaveBeenCalledOnce()
    expect(mocks.setAISetting).toHaveBeenLastCalledWith("aiTasks", [
      expect.objectContaining({
        id: "local-ai-task-1",
        lastResult: "Local task result.",
        nextRunAt: "2026-06-16T08:00:00.000Z",
        runCount: 1,
      }),
    ])
  })
})
