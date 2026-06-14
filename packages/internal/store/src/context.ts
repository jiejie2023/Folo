import type { AuthClient } from "@follow/shared/auth"
import type { QueryClient } from "@tanstack/react-query"

import type { LocalAIBridge } from "./modules/local-ai/types"
import type { FollowAPI } from "./types"

const NO_VALUE_DEFAULT = Symbol("NO_VALUE_DEFAULT")
type ContextValue<T> = T | typeof NO_VALUE_DEFAULT

function createJSContext<T>() {
  let contextValue: ContextValue<T> = NO_VALUE_DEFAULT

  const provide = (value: T) => {
    contextValue = value
  }

  const consumer = (): T => {
    if (contextValue === NO_VALUE_DEFAULT) {
      throw new TypeError("You should only use this context value inside a provider.")
    }
    return contextValue
  }

  return {
    provide,
    consumer,
  }
}

function createOptionalJSContext<T>() {
  let contextValue: T | undefined

  const provide = (value?: T) => {
    contextValue = value
  }

  const consumer = (): T | undefined => contextValue

  return {
    provide,
    consumer,
  }
}

export const apiContext = createJSContext<FollowAPI>()
export const authClientContext = createJSContext<AuthClient>()
export const queryClientContext = createJSContext<QueryClient>()
export const localAIContext = createOptionalJSContext<LocalAIBridge>()

export const api = apiContext.consumer
export const authClient = authClientContext.consumer
export const queryClient = queryClientContext.consumer
export const localAI = localAIContext.consumer
