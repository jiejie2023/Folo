type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type LocalMCPTransportType = "sse" | "streamable-http"

export type LocalMCPConnectionInput = {
  fetchFn?: FetchFn
  headers: Record<string, string>
  transportType: LocalMCPTransportType
  url: string
}

export type LocalMCPTool = {
  description?: string
  inputSchema: Record<string, unknown>
  name: string
}

export type LocalMCPToolCallResult = {
  content: Array<
    | { text: string; type: "text" }
    | {
        type: "json"
        value: unknown
      }
  >
  isError?: boolean
}

type LocalMCPToolCallInput = LocalMCPConnectionInput & {
  arguments: Record<string, unknown>
  name: string
}

type JSONRPCResponse = {
  error?: {
    code?: unknown
    data?: unknown
    message?: unknown
  }
  id?: unknown
  jsonrpc?: unknown
  result?: unknown
}

type SSEEvent = {
  data: string
  event: string | null
}

const MCP_PROTOCOL_VERSION = "2025-06-18"
const CLIENT_INFO = { name: "Folo Desktop", version: "1.0.0" }

export const listLocalMCPTools = async (input: LocalMCPConnectionInput): Promise<LocalMCPTool[]> =>
  withSanitizedErrors(input.headers, async () => {
    const client = await createLocalMCPClient(input)
    try {
      const tools: LocalMCPTool[] = []
      let cursor: string | undefined

      do {
        const result = await client.request("tools/list", cursor ? { cursor } : {})
        if (!isRecord(result) || !Array.isArray(result.tools)) {
          throw new Error("MCP tools/list response was malformed")
        }

        tools.push(
          ...result.tools.map(parseTool).filter((tool): tool is LocalMCPTool => tool !== null),
        )
        cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined
      } while (cursor)

      return tools
    } finally {
      await client.close()
    }
  })

export const callLocalMCPTool = async (
  input: LocalMCPToolCallInput,
): Promise<LocalMCPToolCallResult> =>
  withSanitizedErrors(input.headers, async () => {
    const client = await createLocalMCPClient(input)
    try {
      const result = await client.request("tools/call", {
        arguments: input.arguments,
        name: input.name,
      })
      if (!isRecord(result)) {
        throw new Error("MCP tools/call response was malformed")
      }

      const content = Array.isArray(result.content) ? result.content.map(normalizeToolContent) : []
      if ("structuredContent" in result) {
        content.push({ type: "json", value: result.structuredContent })
      }

      return {
        content,
        ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
      }
    } finally {
      await client.close()
    }
  })

const createLocalMCPClient = async (input: LocalMCPConnectionInput) => {
  const url = parseMCPURL(input.url)
  const client =
    input.transportType === "sse"
      ? await createLegacySSEClient(url, input.headers, input.fetchFn ?? fetch)
      : createStreamableHTTPClient(url, input.headers, input.fetchFn ?? fetch)

  try {
    await client.initialize()
    return client
  } catch (error) {
    await client.close()
    throw error
  }
}

const createStreamableHTTPClient = (
  url: URL,
  customHeaders: Record<string, string>,
  fetchFn: FetchFn,
) => {
  let requestId = 0
  let initialized = false
  let protocolVersion = MCP_PROTOCOL_VERSION
  let sessionId: string | null = null

  const headers = (includeContentType = false): Record<string, string> => ({
    ...customHeaders,
    Accept: "application/json, text/event-stream",
    ...(includeContentType ? { "Content-Type": "application/json" } : {}),
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(initialized ? { "Mcp-Protocol-Version": protocolVersion } : {}),
  })

  const post = async (message: Record<string, unknown>, expectResponse: boolean) => {
    const response = await fetchFn(url, {
      body: JSON.stringify(message),
      headers: headers(true),
      method: "POST",
    })
    sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId

    if (!expectResponse && response.status === 202) return
    await assertMCPResponseOK(response)

    if (response.status === 202) {
      const eventResponse = await fetchFn(url, { headers: headers(), method: "GET" })
      await assertMCPResponseOK(eventResponse)
      return readJSONRPCFromResponse(eventResponse, message.id)
    }

    return readJSONRPCFromResponse(response, message.id)
  }

  return {
    async close() {
      if (!sessionId) return
      const response = await fetchFn(url, { headers: headers(), method: "DELETE" })
      if (!response.ok && response.status !== 404 && response.status !== 405) {
        await assertMCPResponseOK(response)
      }
      sessionId = null
    },
    async initialize() {
      const response = await post(
        {
          id: String(++requestId),
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            capabilities: {},
            clientInfo: CLIENT_INFO,
            protocolVersion: MCP_PROTOCOL_VERSION,
          },
        },
        true,
      )
      if (isRecord(response) && typeof response.protocolVersion === "string") {
        protocolVersion = response.protocolVersion
      }
      initialized = true
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, false)
    },
    async request(method: string, params: Record<string, unknown>) {
      return post({ id: String(++requestId), jsonrpc: "2.0", method, params }, true)
    },
  }
}

const createLegacySSEClient = async (
  url: URL,
  customHeaders: Record<string, string>,
  fetchFn: FetchFn,
) => {
  const response = await fetchFn(url, {
    headers: { ...customHeaders, Accept: "text/event-stream" },
    method: "GET",
  })
  await assertMCPResponseOK(response)
  const eventReader = new SSEEventReader(response)
  const endpointEvent = await eventReader.next()
  if (endpointEvent.event !== "endpoint" || !endpointEvent.data) {
    await eventReader.close()
    throw new Error("Legacy MCP SSE response did not provide a message endpoint")
  }

  const messageURL = new URL(endpointEvent.data, url)
  if (!isHTTPURL(messageURL)) {
    await eventReader.close()
    throw new Error("Legacy MCP message endpoint must use HTTP or HTTPS")
  }

  let requestId = 0

  const post = async (message: Record<string, unknown>) => {
    const postResponse = await fetchFn(messageURL, {
      body: JSON.stringify(message),
      headers: { ...customHeaders, "Content-Type": "application/json" },
      method: "POST",
    })
    await assertMCPResponseOK(postResponse)
  }

  const request = async (method: string, params: Record<string, unknown>) => {
    const id = String(++requestId)
    await post({ id, jsonrpc: "2.0", method, params })
    return readJSONRPCFromEvents(eventReader, id)
  }

  return {
    close: () => eventReader.close(),
    async initialize() {
      const result = await request("initialize", {
        capabilities: {},
        clientInfo: CLIENT_INFO,
        protocolVersion: MCP_PROTOCOL_VERSION,
      })
      if (!isRecord(result)) {
        throw new Error("MCP initialize response was malformed")
      }
      await post({ jsonrpc: "2.0", method: "notifications/initialized" })
    },
    request,
  }
}

class SSEEventReader {
  private buffer = ""
  private readonly decoder = new TextDecoder()
  private readonly events: SSEEvent[] = []
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>

  constructor(response: Response) {
    if (!response.body) throw new Error("MCP SSE response did not include a body")
    this.reader = response.body.getReader()
  }

  async close(): Promise<void> {
    await this.reader.cancel()
  }

  async next(): Promise<SSEEvent> {
    while (true) {
      const queuedEvent = this.events.shift()
      if (queuedEvent) return queuedEvent

      const parsed = drainSSEEvents(this.buffer)
      if (parsed.events.length > 0) {
        this.buffer = parsed.remaining
        this.events.push(...parsed.events)
        continue
      }

      const chunk = await this.reader.read()
      this.buffer += this.decoder.decode(chunk.value, { stream: !chunk.done })
      if (chunk.done) {
        const final = drainSSEEvents(`${this.buffer}\n\n`)
        this.buffer = final.remaining
        if (final.events.length > 0) {
          this.events.push(...final.events)
          continue
        }
        throw new Error("MCP SSE stream closed before the expected response")
      }
    }
  }
}

const readJSONRPCFromResponse = async (
  response: Response,
  expectedId: unknown,
): Promise<unknown> => {
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? ""
  if (contentType.includes("text/event-stream")) {
    const reader = new SSEEventReader(response)
    try {
      return await readJSONRPCFromEvents(reader, expectedId)
    } finally {
      await reader.close()
    }
  }

  return readJSONRPCResult((await response.json()) as unknown, expectedId)
}

const readJSONRPCFromEvents = async (
  reader: SSEEventReader,
  expectedId: unknown,
): Promise<unknown> => {
  while (true) {
    const event = await reader.next()
    if (!event.data) continue
    const payload = JSON.parse(event.data) as unknown
    if (isRecord(payload) && payload.id === expectedId) {
      return readJSONRPCResult(payload, expectedId)
    }
  }
}

const readJSONRPCResult = (payload: unknown, expectedId: unknown): unknown => {
  if (!isRecord(payload) || payload.id !== expectedId) {
    throw new Error("MCP JSON-RPC response was malformed")
  }

  const response = payload as JSONRPCResponse
  if (isRecord(response.error)) {
    const message =
      typeof response.error.message === "string" ? response.error.message : "Unknown MCP error"
    const code = typeof response.error.code === "number" ? ` (${response.error.code})` : ""
    throw new Error(`MCP request failed${code}: ${message}`)
  }
  return response.result
}

const assertMCPResponseOK = async (response: Response): Promise<void> => {
  if (response.ok) return
  const detail = (await response.text()).trim()
  throw new Error(
    detail
      ? `MCP request failed (${response.status} ${response.statusText}): ${detail}`
      : `MCP request failed (${response.status} ${response.statusText})`,
  )
}

const parseMCPURL = (value: string): URL => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("MCP endpoint must be a valid URL")
  }
  if (!isHTTPURL(url)) throw new Error("MCP endpoint must use HTTP or HTTPS")
  return url
}

const isHTTPURL = (url: URL): boolean => url.protocol === "http:" || url.protocol === "https:"

const parseTool = (value: unknown): LocalMCPTool | null => {
  if (!isRecord(value) || typeof value.name !== "string") return null
  return {
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    inputSchema: isRecord(value.inputSchema) ? value.inputSchema : { type: "object" },
    name: value.name,
  }
}

const normalizeToolContent = (value: unknown): LocalMCPToolCallResult["content"][number] => {
  if (isRecord(value) && value.type === "text" && typeof value.text === "string") {
    return { text: value.text, type: "text" }
  }
  return { type: "json", value }
}

const drainSSEEvents = (buffer: string): { events: SSEEvent[]; remaining: string } => {
  const normalized = buffer.replaceAll("\r\n", "\n")
  const blocks = normalized.split("\n\n")
  const remaining = blocks.pop() ?? ""

  return {
    events: blocks.map(parseSSEEvent).filter((event): event is SSEEvent => event !== null),
    remaining,
  }
}

const parseSSEEvent = (block: string): SSEEvent | null => {
  let event: string | null = null
  const data: string[] = []
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim()
    if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart())
  }
  return data.length > 0 ? { data: data.join("\n"), event } : null
}

const withSanitizedErrors = async <T>(
  headers: Record<string, string>,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    for (const secret of Object.values(headers)) {
      if (secret) message = message.replaceAll(secret, "[redacted]")
    }
    throw new Error(message)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
