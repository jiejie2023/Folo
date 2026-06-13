import { describe, expect, test } from "vitest"

import type { SubscriptionSource } from "./source"
import {
  DEFAULT_SUBSCRIPTION_SOURCE,
  getSubscriptionSource,
  isCloudSubscription,
  isLocalSubscription,
} from "./source"

describe("subscription source helpers", () => {
  test("defaults missing source to cloud for backward compatibility", () => {
    expect(getSubscriptionSource({})).toBe("cloud")
    expect(getSubscriptionSource({ source: null })).toBe("cloud")
    expect(DEFAULT_SUBSCRIPTION_SOURCE).toBe("cloud")
  })

  test("recognizes local and cloud subscriptions", () => {
    expect(isLocalSubscription({ source: "local" })).toBe(true)
    expect(isLocalSubscription({ source: "cloud" })).toBe(false)
    expect(isCloudSubscription({ source: "cloud" })).toBe(true)
    expect(isCloudSubscription({})).toBe(true)
  })

  test("narrows subscription source literals", () => {
    const local: SubscriptionSource = "local"
    const cloud: SubscriptionSource = "cloud"

    expect(getSubscriptionSource({ source: local })).toBe("local")
    expect(getSubscriptionSource({ source: cloud })).toBe("cloud")
  })
})
