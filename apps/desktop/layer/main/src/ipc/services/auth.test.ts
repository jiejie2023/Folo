import type { IpcContext } from "electron-ipc-decorator"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookiesGet: vi.fn(),
  cookiesRemove: vi.fn(),
  cookiesSet: vi.fn(),
  getCliSessionToken: vi.fn(),
  getMainWindow: vi.fn(),
  syncSessionToCliConfig: vi.fn(),
  updateNotificationsToken: vi.fn(),
}))

vi.mock("@follow/shared/env.desktop", () => ({
  env: {
    VITE_API_URL: "https://api.folo.is",
    VITE_WEB_URL: "https://app.folo.is",
  },
}))

vi.mock("@pkg", () => ({
  default: { version: "1.9.0" },
}))

vi.mock("@follow/utils/headers", () => ({
  createAuthRequestOriginHeaders: () => ({}),
  createDesktopAPIHeaders: () => ({}),
}))

vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))

vi.mock("~/manager/window", () => ({
  WindowManager: {
    getMainWindow: mocks.getMainWindow,
  },
}))

vi.mock("~/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("~/constants/app", () => ({
  BETTER_AUTH_COOKIE_NAME_SESSION_TOKEN: "better-auth.session_token",
}))

vi.mock("../../lib/cli-session-sync", () => ({
  getCliSessionToken: mocks.getCliSessionToken,
  syncSessionToCliConfig: mocks.syncSessionToCliConfig,
}))

vi.mock("../../lib/user", () => ({
  deleteNotificationsToken: vi.fn(),
  updateNotificationsToken: mocks.updateNotificationsToken,
}))

describe("AuthService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookiesGet.mockResolvedValue([])
    mocks.cookiesRemove.mockImplementation(async () => {})
    mocks.cookiesSet.mockImplementation(async () => {})
    mocks.getMainWindow.mockReturnValue({
      webContents: {
        session: {
          cookies: {
            get: mocks.cookiesGet,
            remove: mocks.cookiesRemove,
            set: mocks.cookiesSet,
          },
        },
      },
    })
    mocks.getCliSessionToken.mockResolvedValue("session-token")
    mocks.syncSessionToCliConfig.mockImplementation(async () => {})
  })

  it("persists the preferred token before session side effects need cookies", async () => {
    mocks.updateNotificationsToken.mockImplementation(async () => {
      expect(mocks.cookiesSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "__Secure-better-auth.session_token",
          value: "session-token",
        }),
      )
    })

    const { AuthService } = await import("./auth")
    const service = new AuthService()

    await service.sessionChanged({} as IpcContext, "session-token")

    expect(mocks.getCliSessionToken).toHaveBeenCalledWith({
      preferredToken: "session-token",
    })
    expect(mocks.syncSessionToCliConfig).toHaveBeenCalledWith("session-token")
  })
})
