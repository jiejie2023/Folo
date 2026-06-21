import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  clearAuthSessionToken: vi.fn(),
  clearLocalPersistStoreData: vi.fn(),
  clearStorage: vi.fn(),
  getAuthSessionToken: vi.fn(() => "session-token"),
  ipcSignOut: vi.fn(),
  ipcSignOutRemote: vi.fn(),
  trackerClear: vi.fn(),
}))

vi.mock("@follow/shared/constants", () => ({
  IN_ELECTRON: true,
}))

vi.mock("@follow/store/user/hooks", () => ({
  whoamiQueryKey: ["whoami"],
}))

vi.mock("@follow/store/user/store", () => ({
  userSyncService: {
    whoami: vi.fn(),
  },
}))

vi.mock("@follow/tracker", () => ({
  tracker: {
    manager: {
      clear: mocks.trackerClear,
    },
  },
}))

vi.mock("@follow/utils/ns", () => ({
  clearStorage: mocks.clearStorage,
}))

vi.mock("~/atoms/user", () => ({
  setLoginModalShow: vi.fn(),
}))

vi.mock("~/constants", () => ({
  QUERY_PERSIST_KEY: "query-cache",
}))

vi.mock("~/hooks/common", () => ({
  useAuthQuery: vi.fn(),
}))

vi.mock("~/lib/auth", () => ({
  deleteUserCustom: vi.fn(),
  getAccountInfo: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock("~/lib/client", () => ({
  ipcServices: {
    auth: {
      signOut: mocks.ipcSignOut,
      signOutRemote: mocks.ipcSignOutRemote,
    },
  },
}))

vi.mock("~/lib/client-session", () => ({
  clearAuthSessionToken: mocks.clearAuthSessionToken,
  getAuthSessionToken: mocks.getAuthSessionToken,
}))

vi.mock("~/lib/defineQuery", () => ({
  defineQuery: vi.fn((queryKey, queryFn) => ({ queryKey, queryFn })),
}))

vi.mock("~/store/utils/clear", () => ({
  clearLocalPersistStoreData: mocks.clearLocalPersistStoreData,
}))

describe("auth session changes", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  test("signs out without deleting the local database", async () => {
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: vi.fn(),
    })
    const { signOut } = await import("./auth")

    await signOut()

    expect(mocks.clearAuthSessionToken).toHaveBeenCalled()
    expect(mocks.clearLocalPersistStoreData).not.toHaveBeenCalled()
    expect(mocks.clearStorage).toHaveBeenCalled()
    expect(mocks.trackerClear).toHaveBeenCalled()
  })
})
