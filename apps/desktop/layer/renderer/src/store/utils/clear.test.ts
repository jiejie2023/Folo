import { beforeEach, describe, expect, test, vi } from "vitest"

import { clearDataIfLoginOtherAccount } from "./clear"

const mocks = vi.hoisted(() => ({
  clearImageDimensionsDb: vi.fn(),
  deleteDB: vi.fn(),
}))

vi.mock("@follow/database/db", () => ({
  deleteDB: mocks.deleteDB,
}))

vi.mock("../image/db", () => ({
  clearImageDimensionsDb: mocks.clearImageDimensionsDb,
}))

const storedUserId = "follow:user_id"

describe("local data clearing", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  test("keeps the local database when the signed-in account changes", () => {
    localStorage.setItem(storedUserId, "old-user")

    clearDataIfLoginOtherAccount("new-user")

    expect(localStorage.getItem(storedUserId)).toBe("new-user")
    expect(mocks.deleteDB).not.toHaveBeenCalled()
    expect(mocks.clearImageDimensionsDb).not.toHaveBeenCalled()
  })
})
