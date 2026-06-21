import { defaultAISettings } from "@follow/shared/settings/defaults"
import type { AISettings, MCPService } from "@follow/shared/settings/interface"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createMCPConnection,
  deleteMCPConnection,
  fetchMCPConnections,
  getMCPTools,
  refreshMCPTools,
  updateMCPConnection,
} from "./mcp"

const mocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  deleteConnection: vi.fn(),
  getAISettings: vi.fn(),
  getConnections: vi.fn(),
  getLocalAIProfileId: vi.fn(),
  getLocalAIIPC: vi.fn(),
  getTools: vi.fn(),
  refreshTools: vi.fn(),
  setAISetting: vi.fn(),
  updateConnection: vi.fn(),
}))

vi.mock("~/lib/api-client", () => ({
  followApi: {
    mcp: {
      createConnection: mocks.createConnection,
      deleteConnection: mocks.deleteConnection,
      getConnections: mocks.getConnections,
      getTools: mocks.getTools,
      refreshTools: mocks.refreshTools,
      updateConnection: mocks.updateConnection,
    },
  },
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: mocks.getAISettings,
  setAISetting: mocks.setAISetting,
}))

vi.mock("~/modules/local-ai/hooks", () => ({
  getLocalAIIPC: mocks.getLocalAIIPC,
  getLocalAIProfileId: mocks.getLocalAIProfileId,
}))

const existingService: MCPService = {
  createdAt: "2026-06-15T00:00:00.000Z",
  enabled: true,
  headers: { Authorization: "Bearer token" },
  id: "local-mcp-1",
  isConnected: false,
  lastUsed: null,
  name: "Local MCP",
  promptCount: 0,
  resourceCount: 0,
  toolCount: 0,
  transportType: "streamable-http",
  url: "https://example.com/mcp",
}

const createSettings = (overrides: Partial<AISettings> = {}): AISettings => ({
  ...defaultAISettings,
  localAI: {
    ...defaultAISettings.localAI,
    defaultProfileId: "profile-1",
    enabled: true,
    featureRouting: {
      ...defaultAISettings.localAI.featureRouting,
      mcp: "local",
    },
  },
  ...overrides,
})

describe("local MCP queries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLocalAIProfileId.mockReturnValue("profile-1")
    mocks.getLocalAIIPC.mockReturnValue({
      listMCPTools: vi
        .fn()
        .mockResolvedValue([
          { description: "Search docs", inputSchema: { type: "object" }, name: "search" },
        ]),
    })
    mocks.getAISettings.mockReturnValue(createSettings({ mcpServices: [existingService] }))
  })

  it("reads MCP connections from local AI settings in local mode", async () => {
    await expect(fetchMCPConnections()).resolves.toEqual([existingService])
    expect(mocks.getConnections).not.toHaveBeenCalled()
  })

  it("creates, updates, and deletes MCP connections in local AI settings", async () => {
    const created = await createMCPConnection({
      name: "Created MCP",
      transportType: "sse",
      url: "https://created.example.com/mcp",
    })

    expect(mocks.createConnection).not.toHaveBeenCalled()
    expect(created).toEqual(
      expect.objectContaining({
        connectionId: expect.stringMatching(/^local-mcp-/),
        isConnected: false,
        name: "Created MCP",
      }),
    )
    expect(mocks.setAISetting).toHaveBeenCalledWith("mcpServices", [
      expect.objectContaining({ id: created.connectionId, name: "Created MCP" }),
      existingService,
    ])

    const updated = await updateMCPConnection("local-mcp-1", { enabled: false, name: "Updated" })
    expect(updated).toEqual(expect.objectContaining({ enabled: false, name: "Updated" }))
    expect(mocks.setAISetting).toHaveBeenLastCalledWith("mcpServices", [
      expect.objectContaining({ enabled: false, id: "local-mcp-1", name: "Updated" }),
    ])

    await deleteMCPConnection("local-mcp-1")
    expect(mocks.deleteConnection).not.toHaveBeenCalled()
    expect(mocks.setAISetting).toHaveBeenLastCalledWith("mcpServices", [])
  })

  it("discovers local MCP tools and stores the connection status", async () => {
    await refreshMCPTools(["local-mcp-1"])
    await expect(getMCPTools("local-mcp-1")).resolves.toEqual([
      { description: "Search docs", inputSchema: { type: "object" }, name: "search" },
    ])

    expect(mocks.refreshTools).not.toHaveBeenCalled()
    expect(mocks.getTools).not.toHaveBeenCalled()
    expect(mocks.setAISetting).toHaveBeenCalledWith("mcpServices", [
      expect.objectContaining({
        id: "local-mcp-1",
        isConnected: true,
        lastError: undefined,
        toolCount: 1,
      }),
    ])
  })

  it("stores local MCP discovery failures and rejects the refresh", async () => {
    const localAIIPC = mocks.getLocalAIIPC()
    localAIIPC.listMCPTools.mockRejectedValue(new Error("connection refused"))

    await expect(refreshMCPTools(["local-mcp-1"])).rejects.toThrow("connection refused")
    expect(mocks.setAISetting).toHaveBeenCalledWith("mcpServices", [
      expect.objectContaining({
        id: "local-mcp-1",
        isConnected: false,
        lastError: "connection refused",
        toolCount: 0,
      }),
    ])
  })
})
