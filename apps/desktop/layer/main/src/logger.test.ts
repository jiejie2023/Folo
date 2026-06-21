import { beforeEach, describe, expect, it, vi } from "vitest"

const appOn = vi.fn()
const initialize = vi.fn()
const scope = vi.fn(() => ({ info: vi.fn() }))
const consoleTransport = { level: "silly" as false | string }

vi.mock("electron", () => ({
  app: {
    on: appOn,
  },
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock("electron-log", () => ({
  default: {
    initialize,
    scope,
    transports: {
      console: consoleTransport,
      file: {
        getFile: vi.fn(() => ({ path: "C:/logs/main.log" })),
      },
    },
  },
}))

describe("main process logger", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    consoleTransport.level = "silly"
  })

  it("disables the console transport during startup", async () => {
    await import("./logger")

    expect(initialize).toHaveBeenCalledOnce()
    expect(consoleTransport.level).toBe(false)
  })
})
