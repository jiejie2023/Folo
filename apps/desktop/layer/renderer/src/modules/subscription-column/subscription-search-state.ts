export interface SubscriptionSearchState {
  isOpen: boolean
  query: string
}

export const openSubscriptionSearch = (
  state: SubscriptionSearchState,
): SubscriptionSearchState => ({
  ...state,
  isOpen: true,
})

export const closeSubscriptionSearch = (
  _state: SubscriptionSearchState,
): SubscriptionSearchState => ({
  isOpen: false,
  query: "",
})

export const resetSubscriptionSearchForScope = ({
  previousScope,
  nextScope,
  state,
}: {
  previousScope: string
  nextScope: string
  state: SubscriptionSearchState
}): SubscriptionSearchState => {
  return previousScope === nextScope ? state : closeSubscriptionSearch(state)
}
