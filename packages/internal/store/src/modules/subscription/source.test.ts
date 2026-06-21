import { describe, expect, test } from "vitest"

import type { SubscriptionSource } from "./source"
import {
  DEFAULT_SUBSCRIPTION_SOURCE,
  getSubscriptionSource,
  isCloudSubscription,
  isLocalSubscription,
} from "./source"

describe("subscription source helpers", () => {
  test("defaults missing source to local for the desktop local-first model", () => {
    expect(getSubscriptionSource({})).toBe("local")
    expect(getSubscriptionSource({ source: null })).toBe("local")
    expect(DEFAULT_SUBSCRIPTION_SOURCE).toBe("local")
  })

  test("recognizes local and cloud subscriptions", () => {
    expect(isLocalSubscription({ source: "local" })).toBe(true)
    expect(isLocalSubscription({ source: "cloud" })).toBe(false)
    expect(isCloudSubscription({ source: "cloud" })).toBe(true)
    expect(isCloudSubscription({})).toBe(false)
  })

  test("narrows subscription source literals", () => {
    const local: SubscriptionSource = "local"
    const cloud: SubscriptionSource = "cloud"

    expect(getSubscriptionSource({ source: local })).toBe("local")
    expect(getSubscriptionSource({ source: cloud })).toBe("cloud")
  })

  test("api-shaped subscriptions can be explicitly marked as cloud", () => {
    expect(getSubscriptionSource({ source: "cloud" })).toBe("cloud")
  })
})
