import type { MCPService } from "@follow/shared/settings/interface"
import type { UpdateConnectionRequest } from "@follow-app/client-sdk"
import { nanoid } from "nanoid"

import { getAISettings, setAISetting } from "~/atoms/settings/ai"
import { followApi } from "~/lib/api-client"
import { getLocalAIIPC, getLocalAIProfileId } from "~/modules/local-ai/hooks"

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
    const targets = localServices.filter(
      (service) => !connectionIdSet || connectionIdSet.has(service.id),
    )
    const localAIIPC = requireLocalAIIPC()
    const results = await Promise.allSettled(
      targets.map(async (service) => ({
        service,
        tools: await localAIIPC.listMCPTools(toLocalMCPConnection(service)),
      })),
    )
    const updates = new Map<string, Partial<MCPService>>()
    const errors: string[] = []

    results.forEach((result, index) => {
      const service = targets[index]!
      if (result.status === "fulfilled") {
        updates.set(service.id, {
          isConnected: true,
          lastError: undefined,
          toolCount: result.value.tools.length,
        })
      } else {
        const message = getErrorMessage(result.reason)
        updates.set(service.id, { isConnected: false, lastError: message, toolCount: 0 })
        errors.push(`${service.name}: ${message}`)
      }
    })

    setLocalMCPServices(
      localServices.map((service) =>
        updates.has(service.id) ? { ...service, ...updates.get(service.id) } : service,
      ),
    )
    if (errors.length > 0) throw new Error(errors.join("; "))
    return
  }

  await followApi.mcp.refreshTools({ connectionIds })
}

export const getMCPTools = async (connectionId: string) => {
  if (isLocalMCPMode()) {
    const service = getLocalMCPServices().find((item) => item.id === connectionId)
    if (!service) throw new Error("Local MCP connection not found")
    return requireLocalAIIPC().listMCPTools(toLocalMCPConnection(service))
  }

  const response = await followApi.mcp.getTools({ connectionId })
  return response.data
}

const requireLocalAIIPC = () => {
  const ipc = getLocalAIIPC()
  if (!ipc) throw new Error("Local AI IPC is unavailable")
  return ipc
}

const toLocalMCPConnection = (service: MCPService) => {
  if (!service.url) throw new Error(`MCP service ${service.name} has no endpoint URL`)
  return {
    headers: service.headers ?? {},
    transportType: service.transportType,
    url: service.url,
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Query key factory for MCP queries
export const mcpQueryKeys = {
  all: ["mcp"] as const,
  connections: () => [...mcpQueryKeys.all, "connections"] as const,
  tools: (connectionId: string) => [...mcpQueryKeys.all, "tools", connectionId] as const,
}
