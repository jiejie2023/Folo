import { describe, expect, it } from "vitest"

import {
  closeSubscriptionSearch,
  openSubscriptionSearch,
  resetSubscriptionSearchForScope,
} from "./subscription-search-state"

describe("subscription search state", () => {
  it("opens without discarding the current query", () => {
    expect(openSubscriptionSearch({ isOpen: false, query: "OpenAI" })).toEqual({
      isOpen: true,
      query: "OpenAI",
    })
  })

  it("closes and clears the current query", () => {
    expect(closeSubscriptionSearch({ isOpen: true, query: "OpenAI" })).toEqual({
      isOpen: false,
      query: "",
    })
  })

  it("closes when the active view changes", () => {
    expect(
      resetSubscriptionSearchForScope({
        previousScope: "all:0",
        nextScope: "social:3",
        state: { isOpen: true, query: "OpenAI" },
      }),
    ).toEqual({ isOpen: false, query: "" })
  })
})
