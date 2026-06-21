# Local-First Timeline Aggregation Design

## Goal

Make every top-level timeline use the local subscription state as its source of truth while still fetching fresh entries from the remote service.

## Contract

- A top-level view contains entries from every visible local subscription assigned to that view.
- The All view contains entries from every visible local subscription.
- The Synced view contains entries only from locally marked synced subscriptions.
- Adding, moving, hiding, or syncing a subscription updates the eligible source set without a view-specific code path.
- Remote responses refresh the local entry store. A partial remote response must not hide cached entries from another eligible local subscription.
- Category, folder, list, inbox, and individual-feed routes retain their existing source filters.

## Design

The entry store already indexes entries by feed and sorts them by publication time. The local query is therefore the canonical rendered timeline: it applies the current route's local source filter and provides a stable, chronological entry list.

The remote query continues to request updates for the same source set and writes returned entries into the entry store. The display layer no longer replaces the local timeline with a successful remote page. Pagination advances both the local timeline window and the remote cursor so cached history remains reachable while newly fetched entries become visible after the store update.

## Regression Coverage

- A partial remote page cannot replace a complete local top-level timeline.
- Local entries retain chronological order when a remote page is present.
- Top-level, synced, category, and individual-feed source selection rules remain distinct.
- Pagination reports more data while either the local cache or remote cursor has another page.
