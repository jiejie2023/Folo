import { beforeEach, describe, expect, it, vi } from "vitest"

import { createChatTransport } from "./transport"

const mocks = vi.hoisted(() => ({
  cloudReconnectToStream: vi.fn(),
  cloudSendMessages: vi.fn(),
  createLocalAIChatTransport: vi.fn(),
  getLocalAIProfileId: vi.fn(),
  localReconnectToStream: vi.fn(),
  localSendMessages: vi.fn(),
}))

vi.mock("@follow/shared/env.desktop", () => ({
  env: {
    VITE_API_URL: "https://api.example.com",
  },
}))

vi.mock("ai", () => ({
  HttpChatTransport: class {
    sendMessages(options: unknown) {
      return mocks.cloudSendMessages(options)
    }

    reconnectToStream(options: unknown) {
      return mocks.cloudReconnectToStream(options)
    }
  },
  parseJsonEventStream: vi.fn(),
  uiMessageChunkSchema: {},
}))

vi.mock("~/modules/local-ai/chat-transport", () => ({
  createLocalAIChatTransport: mocks.createLocalAIChatTransport,
}))

vi.mock("~/modules/local-ai/hooks", () => ({
  getLocalAIProfileId: mocks.getLocalAIProfileId,
}))

vi.mock("../atoms/session", () => ({
  getAIModelState: () => ({ selectedModel: null }),
}))

vi.mock("../services", () => ({
  AIPersistService: {
    updateSessionTitle: vi.fn(),
  },
}))

const createSendOptions = () => ({
  abortSignal: undefined,
  chatId: "chat-1",
  messageId: undefined,
  messages: [],
  trigger: "submit-message" as const,
})

describe("createChatTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createLocalAIChatTransport.mockReturnValue({
      reconnectToStream: mocks.localReconnectToStream,
      sendMessages: mocks.localSendMessages,
    })
  })

  it("routes each send using the current local AI chat setting", async () => {
    const cloudStreamA = new ReadableStream()
    const cloudStreamB = new ReadableStream()
    const localStream = new ReadableStream()
    mocks.cloudSendMessages.mockResolvedValueOnce(cloudStreamA).mockResolvedValueOnce(cloudStreamB)
    mocks.localSendMessages.mockResolvedValue(localStream)

    const transport = createChatTransport()
    const options = createSendOptions()

    mocks.getLocalAIProfileId.mockReturnValue(null)
    await expect(transport.sendMessages(options)).resolves.toBe(cloudStreamA)

    mocks.getLocalAIProfileId.mockReturnValue("profile-1")
    await expect(transport.sendMessages(options)).resolves.toBe(localStream)

    mocks.getLocalAIProfileId.mockReturnValue(null)
    await expect(transport.sendMessages(options)).resolves.toBe(cloudStreamB)

    expect(mocks.cloudSendMessages).toHaveBeenCalledTimes(2)
    expect(mocks.localSendMessages).toHaveBeenCalledTimes(1)
  })

  it("routes timeline summary sends using the timelineSummary local AI setting", async () => {
    const cloudStream = new ReadableStream()
    const localStream = new ReadableStream()
    mocks.cloudSendMessages.mockResolvedValue(cloudStream)
    mocks.localSendMessages.mockResolvedValue(localStream)
    mocks.getLocalAIProfileId.mockImplementation((feature) =>
      feature === "timelineSummary" ? "profile-1" : null,
    )

    const transport = createChatTransport()
    const options = {
      ...createSendOptions(),
      body: {
        localAIFeature: "timelineSummary",
      },
    }

    await expect(transport.sendMessages(options)).resolves.toBe(localStream)

    expect(mocks.getLocalAIProfileId).toHaveBeenCalledWith("timelineSummary")
    expect(mocks.cloudSendMessages).not.toHaveBeenCalled()
  })
})
