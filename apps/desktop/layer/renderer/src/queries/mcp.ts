import type { MCPService } from "@follow/shared/settings/interface"
import type { UpdateConnectionRequest } from "@follow-app/client-sdk"
import { nanoid } from "nanoid"

import { getAISettings, setAISetting } from "~/atoms/settings/ai"
import { followApi } from "~/lib/api-client"
import { getLocalAIProfileId } from "~/modules/local-ai/hooks"

type MCPConnectionInput = {
  name: string
  transportType: "streamable-http" | "sse"
  url: string
  headers?: Record<string, string>
}

const isLocalMCPMode = () => getLocalAIProfileId("mcp") !== null

const getLocalMCPServices = (): MCPService[] => getAISettings().mcpServices ?? []

const setLocalMCPServices = (services: MCPService[]) => {
  setAISetting("mcpServices", services)
}

const createLocalMCPService = (connectionData: MCPConnectionInput): MCPService => ({
  createdAt: new Date().toISOString(),
  enabled: true,
  headers: connectionData.headers,
  id: `local-mcp-${nanoid(10)}`,
  isConnected: false,
  lastUsed: null,
  name: connectionData.name,
  promptCount: 0,
  resourceCount: 0,
  toolCount: 0,
  transportType: connectionData.transportType,
  url: connectionData.url,
})

export const createMCPConnection = async (connectionData: MCPConnectionInput) => {
  if (isLocalMCPMode()) {
    const service = createLocalMCPService(connectionData)
    setLocalMCPServices([service, ...getLocalMCPServices()])
    return {
      ...service,
      connectionId: service.id,
    }
  }

  return followApi.mcp.createConnection(connectionData)
}

export const fetchMCPConnections = async (): Promise<MCPService[]> => {
  if (isLocalMCPMode()) {
    return getLocalMCPServices()
  }

  const response = await followApi.mcp.getConnections()
  return response.data
}

export const updateMCPConnection = async (
  connectionId: string,
  updateData: Partial<UpdateConnectionRequest>,
) => {
  if (isLocalMCPMode()) {
    const services = getLocalMCPServices()
    const updatedServices = services.map((service) =>
      service.id === connectionId
        ? {
            ...service,
            ...updateData,
          }
        : service,
    )
    setLocalMCPServices(updatedServices)
    const updatedService = updatedServices.find((service) => service.id === connectionId)
    if (!updatedService) {
      throw new Error("Local MCP connection not found")
    }
    return updatedService
  }

  return followApi.mcp.updateConnection({ connectionId, ...updateData })
}

export const deleteMCPConnection = async (connectionId: string): Promise<void> => {
  if (isLocalMCPMode()) {
    setLocalMCPServices(getLocalMCPServices().filter((service) => service.id !== connectionId))
    return
  }

  await followApi.mcp.deleteConnection({ connectionId })
}

export const refreshMCPTools = async (connectionIds?: string[]): Promise<void> => {
  if (isLocalMCPMode()) {
    const localServices = getLocalMCPServices()
    const connectionIdSet = connectionIds ? new Set(connectionIds) : null
    setLocalMCPServices(
      localServices.map((service) =>
        connectionIdSet && !connectionIdSet.has(service.id)
          ? service
          : {
              ...service,
              isConnected: false,
              lastError: "Local MCP tool discovery is not implemented yet.",
              toolCount: 0,
            },
      ),
    )
    return
  }

  await followApi.mcp.refreshTools({ connectionIds })
}

export const getMCPTools = async (connectionId: string) => {
  if (isLocalMCPMode()) {
    return []
  }

  const response = await followApi.mcp.getTools({ connectionId })
  return response.data
}

// Query key factory for MCP queries
export const mcpQueryKeys = {
  all: ["mcp"] as const,
  connections: () => [...mcpQueryKeys.all, "connections"] as const,
  tools: (connectionId: string) => [...mcpQueryKeys.all, "tools", connectionId] as const,
}
