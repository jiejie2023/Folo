export const SUBSCRIPTION_SOURCES = ["cloud", "local"] as const

export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number]

export const DEFAULT_SUBSCRIPTION_SOURCE: SubscriptionSource = "local"

export const getSubscriptionSource = (subscription: {
  source?: SubscriptionSource | null
}): SubscriptionSource => subscription.source ?? DEFAULT_SUBSCRIPTION_SOURCE

export const isLocalSubscription = (subscription: { source?: SubscriptionSource | null }) =>
  getSubscriptionSource(subscription) === "local"

export const isCloudSubscription = (subscription: { source?: SubscriptionSource | null }) =>
  getSubscriptionSource(subscription) === "cloud"
