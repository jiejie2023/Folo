import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopLocalAIProfile } from "~/modules/local-ai/hooks"

import { useAIConfiguration } from "./useAIConfiguration"

const mocks = vi.hoisted(() => ({
  followConfig: vi.fn(),
  getAISettings: vi.fn(),
  getLocalAIIPC: vi.fn(),
}))

vi.mock("~/lib/api-client", () => ({
  followApi: {
    ai: {
      config: mocks.followConfig,
    },
  },
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: mocks.getAISettings,
  useAISettingValue: mocks.getAISettings,
}))

vi.mock("~/modules/local-ai/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/modules/local-ai/hooks")>()
  return {
    ...actual,
    getLocalAIIPC: mocks.getLocalAIIPC,
  }
})

const profile: DesktopLocalAIProfile = {
  baseURL: "http://localhost:11434/v1",
  createdAt: "2026-06-14T00:00:00.000Z",
  defaultChatModel: "llama3",
  defaultSummaryModel: null,
  defaultTaskModel: null,
  defaultTimelineModel: null,
  defaultTranslationModel: null,
  defaultTtsModel: null,
  enabled: true,
  headers: {},
  id: "profile-1",
  lastTestResult: null,
  lastTestedAt: null,
  maskedApiKey: "sk-...safe",
  models: ["llama3", "qwen2.5"],
  name: "Local",
  providerType: "openai-compatible",
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsTts: false,
  updatedAt: "2026-06-14T00:00:00.000Z",
}

const alternateProfile: DesktopLocalAIProfile = {
  ...profile,
  defaultChatModel: "qwen-max",
  id: "profile-2",
  models: ["qwen-max", "qwen-plus"],
  name: "Alternate Local",
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const waitFor = async (assertion: () => void | Promise<void>) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  throw lastError
}

const renderUseAIConfiguration = () => {
  const container = document.createElement("div")
  document.body.append(container)
  let root: Root | null = null
  let current: ReturnType<typeof useAIConfiguration> | null = null
  const Wrapper = createWrapper()

  function TestComponent() {
    current = useAIConfiguration()
    return null
  }

  act(() => {
    root = createRoot(container)
    root.render(
      <Wrapper>
        <TestComponent />
      </Wrapper>,
    )
  })

  return {
    get current() {
      if (!current) {
        throw new Error("useAIConfiguration did not render")
      }
      return current
    },
    unmount() {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
  }
}

const localAISettings = {
  allowFallbackToCloud: false,
  defaultProfileId: "profile-1",
  enabled: true,
  featureProfileIds: {},
  featureRouting: {
    chat: "local",
    mcp: "cloud",
    onboardingRecommendations: "cloud",
    summary: "cloud",
    tasks: "cloud",
    timelineRanking: "cloud",
    timelineSummary: "cloud",
    translation: "cloud",
    tts: "cloud",
  },
}

describe("useAIConfiguration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.removeEventListener = vi.fn()
    mocks.getAISettings.mockReturnValue({ localAI: localAISettings })
    mocks.getLocalAIIPC.mockReturnValue({
      listProfiles: vi.fn().mockResolvedValue([profile, alternateProfile]),
    })
    mocks.followConfig.mockResolvedValue({
      attachmentLimits: {
        maxFiles: 3,
        remainingFiles: 3,
        windowDuration: 0,
        windowResetTime: 0,
      },
      availableModels: ["openai/gpt-4o"],
      availableModelsMenu: [{ label: "GPT-4o", value: "openai/gpt-4o" }],
      defaultModel: "openai/gpt-4o",
      freeQuota: {
        dailyLimit: 10,
        monthlyLimit: 100,
        remainingMonthlyRequests: 100,
        remainingRequests: 10,
        role: "free",
        shouldCheckDailyLimit: true,
      },
      rateLimit: {
        currentTokens: 10,
        maxTokens: 100,
        remainingTokens: 90,
        windowDuration: 0,
        windowResetTime: 0,
      },
      usage: { remaining: 90, resetAt: new Date(0), total: 100, used: 10 },
    })
  })

  it("returns local model configuration without calling cloud config when chat routes locally", async () => {
    const result = renderUseAIConfiguration()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toMatchObject({
      availableModels: ["llama3", "qwen2.5"],
      availableModelsMenu: [
        { label: "llama3", value: "llama3" },
        { label: "qwen2.5", value: "qwen2.5" },
      ],
      defaultModel: "llama3",
      rateLimit: { warningLevel: "safe" },
      usage: { remaining: 0, total: 0, used: 0 },
    })
    expect(mocks.followConfig).not.toHaveBeenCalled()
    result.unmount()
  })

  it("keeps cloud configuration when chat is not routed locally", async () => {
    mocks.getAISettings.mockReturnValue({
      localAI: {
        ...localAISettings,
        featureRouting: {
          ...localAISettings.featureRouting,
          chat: "cloud",
        },
      },
    })

    const result = renderUseAIConfiguration()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.defaultModel).toBe("openai/gpt-4o")
    expect(mocks.followConfig).toHaveBeenCalledTimes(1)
    result.unmount()
  })

  it("uses the feature-specific local profile when chat is bound to another provider", async () => {
    mocks.getAISettings.mockReturnValue({
      localAI: {
        ...localAISettings,
        featureProfileIds: {
          chat: "profile-2",
        },
      },
    })

    const result = renderUseAIConfiguration()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toMatchObject({
      availableModels: ["qwen-max", "qwen-plus"],
      availableModelsMenu: [
        { label: "qwen-max", value: "qwen-max" },
        { label: "qwen-plus", value: "qwen-plus" },
      ],
      defaultModel: "qwen-max",
    })
    expect(mocks.followConfig).not.toHaveBeenCalled()
    result.unmount()
  })

  it("falls back to cloud configuration when local chat config is unavailable and fallback is enabled", async () => {
    mocks.getAISettings.mockReturnValue({
      localAI: {
        ...localAISettings,
        allowFallbackToCloud: true,
      },
    })
    mocks.getLocalAIIPC.mockReturnValue(null)

    const result = renderUseAIConfiguration()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.defaultModel).toBe("openai/gpt-4o")
    expect(mocks.followConfig).toHaveBeenCalledTimes(1)
    result.unmount()
  })
})
