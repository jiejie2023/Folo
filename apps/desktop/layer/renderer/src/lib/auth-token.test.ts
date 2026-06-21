import { describe, expect, test } from "vitest"

import { getAuthTokenFromResult } from "./auth-token"

describe("getAuthTokenFromResult", () => {
  test("extracts top-level session tokens", () => {
    expect(getAuthTokenFromResult({ sessionToken: "session-token" })).toBe("session-token")
    expect(getAuthTokenFromResult({ token: "token" })).toBe("token")
  })

  test("extracts nested session tokens from auth responses", () => {
    expect(
      getAuthTokenFromResult({
        data: {
          session: {
            token: "nested-token",
          },
        },
      }),
    ).toBe("nested-token")
  })

  test("returns null when no session token exists", () => {
    expect(getAuthTokenFromResult(null)).toBeNull()
    expect(getAuthTokenFromResult({ data: {} })).toBeNull()
  })
})
