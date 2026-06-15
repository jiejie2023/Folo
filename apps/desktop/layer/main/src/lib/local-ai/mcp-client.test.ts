import { describe, expect, it, vi } from "vitest"

import { callLocalMCPTool, listLocalMCPTools } from "./mcp-client"

type FetchCall = {
  init?: RequestInit
  url: string
}

const readJsonBody = (call: FetchCall): Record<string, unknown> => {
  expect(typeof call.init?.body).toBe("string")
  return JSON.parse(call.init?.body as string) as Record<string, unknown>
}

const createSSEStream = (events: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
}

describe("local MCP client", () => {
  it("initializes Streamable HTTP, lists every tool page, and closes the session", async () => {
    const calls: FetchCall[] = []
    const responses = [
      new Response(
        JSON.stringify({
          id: "1",
          jsonrpc: "2.0",
          result: { capabilities: { tools: {} }, protocolVersion: "2025-06-18" },
        }),
        { headers: { "Mcp-Session-Id": "session-1" } },
      ),
      new Response(null, { status: 202 }),
      Response.json({
        id: "2",
        jsonrpc: "2.0",
        result: {
          nextCursor: "page-2",
          tools: [
            {
              description: "Search docs",
              inputSchema: { properties: { q: { type: "string" } }, type: "object" },
              name: "search",
            },
          ],
        },
      }),
      Response.json({
        id: "3",
        jsonrpc: "2.0",
        result: { tools: [{ inputSchema: { type: "object" }, name: "read" }] },
      }),
      new Response(null, { status: 204 }),
    ]
    const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init, url: String(url) })
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return Promise.resolve(response)
    })

    await expect(
      listLocalMCPTools({
        fetchFn,
        headers: { Authorization: "Bearer token" },
        transportType: "streamable-http",
        url: "https://mcp.example.com/api",
      }),
    ).resolves.toEqual([
      {
        description: "Search docs",
        inputSchema: { properties: { q: { type: "string" } }, type: "object" },
        name: "search",
      },
      { inputSchema: { type: "object" }, name: "read" },
    ])

    expect(calls).toHaveLength(5)
    expect(readJsonBody(calls[0]!)).toEqual({
      id: "1",
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "Folo Desktop", version: "1.0.0" },
        protocolVersion: "2025-06-18",
      },
    })
    expect(readJsonBody(calls[1]!)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })
    expect(readJsonBody(calls[2]!)).toEqual({
      id: "2",
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
    })
    expect(readJsonBody(calls[3]!)).toEqual({
      id: "3",
      jsonrpc: "2.0",
      method: "tools/list",
      params: { cursor: "page-2" },
    })
    expect(calls[2]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer token",
        "Mcp-Protocol-Version": "2025-06-18",
        "Mcp-Session-Id": "session-1",
      }),
    )
    expect(calls[4]?.init?.method).toBe("DELETE")
  })

  it("sends the negotiated protocol version for stateless Streamable HTTP servers", async () => {
    const calls: FetchCall[] = []
    const responses = [
      Response.json({
        id: "1",
        jsonrpc: "2.0",
        result: { capabilities: { tools: {} }, protocolVersion: "2024-11-05" },
      }),
      new Response(null, { status: 202 }),
      Response.json({ id: "2", jsonrpc: "2.0", result: { tools: [] } }),
    ]
    const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init, url: String(url) })
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return Promise.resolve(response)
    })

    await listLocalMCPTools({
      fetchFn,
      headers: {},
      transportType: "streamable-http",
      url: "https://mcp.example.com/api",
    })

    expect(calls[2]?.init?.headers).toEqual(
      expect.objectContaining({ "Mcp-Protocol-Version": "2024-11-05" }),
    )
    expect(calls).toHaveLength(3)
  })

  it("uses the legacy SSE endpoint and reads JSON-RPC responses from its event stream", async () => {
    const calls: FetchCall[] = []
    const stream = createSSEStream([
      [
        "event: endpoint\ndata: /messages?session=legacy\n\n",
        'event: message\ndata: {"jsonrpc":"2.0","id":"1","result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}}}}\n\n',
        'event: message\ndata: {"jsonrpc":"2.0","id":"2","result":{"tools":[{"name":"legacy-search","inputSchema":{"type":"object"}}]}}\n\n',
      ].join(""),
    ])
    const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init, url: String(url) })
      if ((init?.method ?? "GET") === "GET") {
        return Promise.resolve(
          new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
        )
      }
      return Promise.resolve(new Response(null, { status: 202 }))
    })

    await expect(
      listLocalMCPTools({
        fetchFn,
        headers: { "X-API-Key": "secret" },
        transportType: "sse",
        url: "https://mcp.example.com/sse",
      }),
    ).resolves.toEqual([{ inputSchema: { type: "object" }, name: "legacy-search" }])

    expect(calls[0]).toEqual(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        url: "https://mcp.example.com/sse",
      }),
    )
    expect(calls[1]?.url).toBe("https://mcp.example.com/messages?session=legacy")
    expect(readJsonBody(calls[3]!)).toEqual({
      id: "2",
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
    })
  })

  it("calls a tool and preserves text, structured JSON, and tool errors", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          id: "1",
          jsonrpc: "2.0",
          result: { capabilities: { tools: {} }, protocolVersion: "2025-06-18" },
        }),
        { headers: { "Mcp-Session-Id": "session-1" } },
      ),
      new Response(null, { status: 202 }),
      Response.json({
        id: "2",
        jsonrpc: "2.0",
        result: {
          content: [{ text: "tool result", type: "text" }],
          isError: true,
          structuredContent: { count: 1 },
        },
      }),
      new Response(null, { status: 204 }),
    ]
    const fetchFn = vi.fn((_url: string | URL | Request, _init?: RequestInit) => {
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return Promise.resolve(response)
    })

    await expect(
      callLocalMCPTool({
        arguments: { q: "folo" },
        fetchFn,
        headers: {},
        name: "search",
        transportType: "streamable-http",
        url: "https://mcp.example.com/api",
      }),
    ).resolves.toEqual({
      content: [
        { text: "tool result", type: "text" },
        { type: "json", value: { count: 1 } },
      ],
      isError: true,
    })

    const toolCall = fetchFn.mock.calls[2]
    expect(readJsonBody({ init: toolCall?.[1], url: String(toolCall?.[0]) })).toEqual({
      id: "2",
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: { q: "folo" }, name: "search" },
    })
  })

  it("rejects non-HTTP endpoints before sending credentials", async () => {
    const fetchFn = vi.fn()

    await expect(
      listLocalMCPTools({
        fetchFn,
        headers: { Authorization: "Bearer secret" },
        transportType: "streamable-http",
        url: "file:///tmp/mcp",
      }),
    ).rejects.toThrow("HTTP or HTTPS")
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
