# Local-First Timeline Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure all top-level timelines render the full locally eligible subscription set even when the remote timeline response is partial.

**Architecture:** The local entry-store selectors remain the canonical rendered list because they are filtered by the local subscription source set and sorted by publication time. The remote query remains responsible for fetching and storing fresh entries, while shared pagination advances both sources.

**Tech Stack:** React, TypeScript, Zustand entry store, TanStack Query, Vitest.

---

### Task 1: Specify local-first timeline composition

**Files:**
- Modify: `apps/desktop/layer/renderer/src/modules/entry-column/hooks/timeline-source.ts`
- Test: `apps/desktop/layer/renderer/src/modules/entry-column/hooks/timeline-source.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(getTimelineDisplayEntryIds({
  localEntryIds: ["local-new", "local-old"],
  remoteEntryIds: ["remote-only"],
})).toEqual(["local-new", "local-old"])
```

- [ ] **Step 2: Run the focused test and verify it fails because the helper is missing**

Run: `pnpm exec vitest run src/modules/entry-column/hooks/timeline-source.test.ts --config vitest.config.ts`

- [ ] **Step 3: Implement the pure local-first helper**

```ts
export const getTimelineDisplayEntryIds = ({ localEntryIds }: TimelineEntryIds) => localEntryIds
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm exec vitest run src/modules/entry-column/hooks/timeline-source.test.ts --config vitest.config.ts`

### Task 2: Use local-first composition in the shared timeline hook

**Files:**
- Modify: `apps/desktop/layer/renderer/src/modules/entry-column/hooks/useEntriesByView.ts`
- Test: `apps/desktop/layer/renderer/src/modules/entry-column/hooks/timeline-source.test.ts`

- [ ] **Step 1: Add a failing pagination-state test**

```ts
expect(getTimelinePagination({ localHasNext: false, remoteHasNext: true })).toEqual({
  hasNext: true,
  hasNextPage: true,
})
```

- [ ] **Step 2: Replace remote-wins rendering with local-first rendering**

```ts
const entryIds = getTimelineDisplayEntryIds({
  localEntryIds: localQuery.entriesIds,
  remoteEntryIds: remoteQuery.entriesIds,
})
```

- [ ] **Step 3: Advance both local and remote pagination paths**

```ts
const fetchNextPage = useCallback(async () => {
  localQuery.fetchNextPage()
  await remoteQuery.fetchNextPage()
}, [localQuery, remoteQuery])
```

- [ ] **Step 4: Run focused tests, renderer typecheck, lint, and renderer tests**

Run: `pnpm exec vitest run src/modules/entry-column/hooks/timeline-source.test.ts --config vitest.config.ts`
Run: `pnpm run typecheck`
Run: `pnpm exec eslint src/modules/entry-column/hooks/timeline-source.ts src/modules/entry-column/hooks/useEntriesByView.ts`
Run: `pnpm test`
