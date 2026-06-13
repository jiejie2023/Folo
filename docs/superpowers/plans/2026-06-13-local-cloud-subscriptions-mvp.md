# Local and Cloud Subscriptions MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable slice of local subscriptions: local subscriptions have a durable source, cloud sync preserves them, and RSS/RSSHub add defaults to local.

**Architecture:** Add a `source` column to subscriptions with `cloud` as the migration default and `local` for locally managed subscriptions. Cloud fetch replaces only `cloud` subscriptions, while local add writes directly to the local feed/subscription/entry stores. The first slice keeps UI changes minimal: users can add local feeds and see source markers, with full sidebar sectioning and right-click sync actions deferred to the next implementation plan.

**Tech Stack:** TypeScript, React, Zustand stores, Drizzle SQLite schema/migrations, Vitest, Electron renderer.

---

## Scope Split

The design spec covers data, local add, sidebar management, sync actions, and timeline behavior. This MVP implements the smallest testable path:

- Add `source: "cloud" | "local"` to subscription data.
- Preserve local subscriptions during cloud subscription fetch.
- Add local feed subscriptions from `FeedForm`.
- Seed preview entries for a newly added local subscription so the timeline is not blank.
- Show a small source badge on feed rows.

The following items stay out of this MVP and need a second plan:

- Full top-level sidebar sections for “账号同步” and “本地订阅”.
- Right-click “同步到账号”.
- Right-click “复制为本地订阅”.
- Background refresh for local RSS entries.

## File Structure

- Modify `packages/internal/database/src/schemas/index.ts`: add `source` to `subscriptionsTable`.
- Generate or modify `packages/internal/database/src/drizzle/0038_local_subscription_source.sql`: migrate existing databases.
- Update `packages/internal/database/src/drizzle/migrations.js` and `packages/internal/database/src/drizzle/meta/_journal.json`: register the migration.
- Create `packages/internal/store/src/modules/subscription/source.ts`: shared source constants and helpers.
- Create `packages/internal/store/src/modules/subscription/source.test.ts`: pure source helper tests.
- Modify `packages/internal/store/src/modules/subscription/types.ts`: expose source-aware subscription types.
- Modify `packages/internal/store/src/morph/api.ts`: mark API subscriptions as cloud.
- Modify `packages/internal/store/src/modules/subscription/store.ts`: add source-aware reset and local subscribe.
- Create `packages/internal/store/src/modules/subscription/store-source.test.ts`: test source-aware store logic without UI.
- Modify `apps/desktop/layer/renderer/src/modules/discover/FeedForm.tsx`: default submit to local add and allow unauthenticated local add.
- Modify `apps/desktop/layer/renderer/src/modules/subscription-column/FeedItem.tsx`: show a compact source badge.

---

### Task 1: Add Subscription Source Helpers

**Files:**

- Create: `packages/internal/store/src/modules/subscription/source.ts`
- Create: `packages/internal/store/src/modules/subscription/source.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/internal/store/src/modules/subscription/source.test.ts`:

```ts
import { describe, expect, test } from "vitest"

import {
  DEFAULT_SUBSCRIPTION_SOURCE,
  getSubscriptionSource,
  isCloudSubscription,
  isLocalSubscription,
  type SubscriptionSource,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter @follow/store test -- source.test.ts
```

Expected: FAIL because `./source` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/internal/store/src/modules/subscription/source.ts`:

```ts
export const SUBSCRIPTION_SOURCES = ["cloud", "local"] as const

export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number]

export const DEFAULT_SUBSCRIPTION_SOURCE: SubscriptionSource = "cloud"

export const getSubscriptionSource = (subscription: {
  source?: SubscriptionSource | null
}): SubscriptionSource => subscription.source ?? DEFAULT_SUBSCRIPTION_SOURCE

export const isLocalSubscription = (subscription: { source?: SubscriptionSource | null }) =>
  getSubscriptionSource(subscription) === "local"

export const isCloudSubscription = (subscription: { source?: SubscriptionSource | null }) =>
  getSubscriptionSource(subscription) === "cloud"
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
pnpm --filter @follow/store test -- source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/internal/store/src/modules/subscription/source.ts packages/internal/store/src/modules/subscription/source.test.ts
git commit -m "feat: add subscription source helpers"
```

---

### Task 2: Add Source to the Local Database Schema

**Files:**

- Modify: `packages/internal/database/src/schemas/index.ts`
- Create: `packages/internal/database/src/drizzle/0038_local_subscription_source.sql`
- Modify: `packages/internal/database/src/drizzle/migrations.js`
- Modify: `packages/internal/database/src/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the failing type expectation**

Add this temporary assertion near `subscriptionsTable` in `packages/internal/database/src/schemas/index.ts` while developing:

```ts
// This type is removed after the migration is generated and schema compiles.
type _SubscriptionSourceCompileCheck = "cloud" | "local"
```

Run:

```powershell
pnpm --filter @follow/database typecheck
```

Expected: PASS before schema change. This step establishes the database package compiles before the migration.

- [ ] **Step 2: Update schema**

In `packages/internal/database/src/schemas/index.ts`, add the source column to `subscriptionsTable`:

```ts
source: text("source").$type<"cloud" | "local">().notNull().default("cloud"),
```

Place it after `type`.

- [ ] **Step 3: Generate the migration**

Run:

```powershell
pnpm --filter @follow/database run generate
```

Expected: Drizzle creates a new migration for the `source` column and updates the migration metadata.

If Drizzle does not create the exact migration, create `packages/internal/database/src/drizzle/0038_local_subscription_source.sql`:

```sql
ALTER TABLE `subscriptions` ADD `source` text DEFAULT 'cloud' NOT NULL;
```

Then update `packages/internal/database/src/drizzle/migrations.js`:

```ts
import m0038 from "./0038_local_subscription_source.sql"
```

and add it to the `migrations` object:

```ts
m0038,
```

Update `packages/internal/database/src/drizzle/meta/_journal.json` by appending:

```json
{
  "idx": 38,
  "version": "6",
  "when": 1781323200000,
  "tag": "0038_local_subscription_source",
  "breakpoints": true
}
```

- [ ] **Step 4: Remove the temporary compile check**

Remove:

```ts
type _SubscriptionSourceCompileCheck = "cloud" | "local"
```

- [ ] **Step 5: Verify database typecheck**

Run:

```powershell
pnpm --filter @follow/database typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/internal/database/src/schemas/index.ts packages/internal/database/src/drizzle packages/internal/database/src/drizzle/migrations.js
git commit -m "feat: add subscription source column"
```

---

### Task 3: Mark API Subscriptions as Cloud

**Files:**

- Modify: `packages/internal/store/src/modules/subscription/types.ts`
- Modify: `packages/internal/store/src/morph/api.ts`
- Test: `packages/internal/store/src/modules/subscription/source.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `packages/internal/store/src/modules/subscription/source.test.ts`:

```ts
test("api-shaped subscriptions can be explicitly marked as cloud", () => {
  expect(getSubscriptionSource({ source: "cloud" })).toBe("cloud")
})
```

Run:

```powershell
pnpm --filter @follow/store test -- source.test.ts
```

Expected: PASS. This confirms the source helper accepts the shape that `apiMorph` will emit.

- [ ] **Step 2: Update subscription type**

In `packages/internal/store/src/modules/subscription/types.ts`, add:

```ts
import type { SubscriptionSource } from "./source"
```

Change:

```ts
export type SubscriptionModel = Omit<SubscriptionSchema, "id">
```

to:

```ts
export type SubscriptionModel = Omit<SubscriptionSchema, "id"> & {
  source?: SubscriptionSource
}
```

- [ ] **Step 3: Mark API subscriptions as cloud**

In `packages/internal/store/src/morph/api.ts`, add `source: "cloud"` to `baseSubscription`:

```ts
const baseSubscription = {
  category: item.category!,
  userId: item.userId,
  view: item.view,
  isPrivate: item.isPrivate,
  hideFromTimeline: item.hideFromTimeline,
  title: item.title,
  createdAt: item.createdAt,
  source: "cloud",
} as SubscriptionModel
```

- [ ] **Step 4: Verify store typecheck**

Run:

```powershell
pnpm --filter @follow/store typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/internal/store/src/modules/subscription/types.ts packages/internal/store/src/morph/api.ts packages/internal/store/src/modules/subscription/source.test.ts
git commit -m "feat: mark api subscriptions as cloud"
```

---

### Task 4: Preserve Local Subscriptions During Cloud Fetch

**Files:**

- Modify: `packages/internal/database/src/services/subscription.ts`
- Modify: `packages/internal/store/src/modules/subscription/store.ts`
- Create: `packages/internal/store/src/modules/subscription/store-source.test.ts`

- [ ] **Step 1: Write failing store behavior test**

Create `packages/internal/store/src/modules/subscription/store-source.test.ts`:

```ts
import { FeedViewType } from "@follow/constants"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { subscriptionActions, useSubscriptionStore } from "./store"
import type { SubscriptionModel } from "./types"

const cloudSub = (feedId: string): SubscriptionModel => ({
  feedId,
  listId: null,
  inboxId: null,
  userId: "cloud-user",
  view: FeedViewType.Articles,
  isPrivate: false,
  hideFromTimeline: null,
  title: null,
  category: "Cloud",
  createdAt: "2026-06-13T00:00:00.000Z",
  type: "feed",
  source: "cloud",
})

const localSub = (feedId: string): SubscriptionModel => ({
  feedId,
  listId: null,
  inboxId: null,
  userId: "local",
  view: FeedViewType.Articles,
  isPrivate: false,
  hideFromTimeline: null,
  title: null,
  category: "Local",
  createdAt: "2026-06-13T00:00:00.000Z",
  type: "feed",
  source: "local",
})

vi.mock("@follow/database/services/subscription", () => ({
  SubscriptionService: {
    getSubscriptionAll: vi.fn(),
    reset: vi.fn(),
    resetBySource: vi.fn(),
    upsertMany: vi.fn(),
  },
}))

describe("subscription source-aware reset", () => {
  beforeEach(() => {
    useSubscriptionStore.setState({
      data: {},
      feedIdByView: {
        [-1]: new Set(),
        [0]: new Set(),
        [1]: new Set(),
        [2]: new Set(),
        [3]: new Set(),
        [4]: new Set(),
        [5]: new Set(),
      },
      listIdByView: {
        [-1]: new Set(),
        [0]: new Set(),
        [1]: new Set(),
        [2]: new Set(),
        [3]: new Set(),
        [4]: new Set(),
        [5]: new Set(),
      },
      categories: {
        [-1]: new Set(),
        [0]: new Set(),
        [1]: new Set(),
        [2]: new Set(),
        [3]: new Set(),
        [4]: new Set(),
        [5]: new Set(),
      },
      subscriptionIdSet: new Set(),
      categoryOpenStateByView: {
        [-1]: {},
        [0]: {},
        [1]: {},
        [2]: {},
        [3]: {},
        [4]: {},
        [5]: {},
      },
    })
  })

  test("resetBySourceInSession removes only cloud subscriptions and keeps local subscriptions", async () => {
    await subscriptionActions.upsertManyInSession([cloudSub("cloud-feed"), localSub("local-feed")])

    subscriptionActions.resetBySourceInSession("cloud")

    const state = useSubscriptionStore.getState()
    expect(state.data["cloud-feed"]).toBeUndefined()
    expect(state.data["local-feed"]?.source).toBe("local")
    expect(state.feedIdByView[FeedViewType.Articles]?.has("cloud-feed")).toBe(false)
    expect(state.feedIdByView[FeedViewType.Articles]?.has("local-feed")).toBe(true)
    expect(state.subscriptionIdSet.has("feed/cloud-feed")).toBe(false)
    expect(state.subscriptionIdSet.has("feed/local-feed")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter @follow/store test -- store-source.test.ts
```

Expected: FAIL because `resetBySourceInSession` does not exist.

- [ ] **Step 3: Add database service reset by source**

In `packages/internal/database/src/services/subscription.ts`, add:

```ts
async resetBySource(source: "cloud" | "local", view?: FeedViewType) {
  const results = await db.query.subscriptionsTable.findMany({
    where: and(
      eq(subscriptionsTable.source, source),
      typeof view === "number" ? eq(subscriptionsTable.view, view) : undefined,
    ),
    columns: {
      id: true,
    },
  })

  if (results.length === 0) return

  await this.delete(results.map((item) => item.id))
}
```

- [ ] **Step 4: Add store reset by source**

In `packages/internal/store/src/modules/subscription/store.ts`, import:

```ts
import type { SubscriptionSource } from "./source"
import { getSubscriptionSource } from "./source"
```

Add this method to `SubscriptionActions`:

```ts
resetBySourceInSession(source: SubscriptionSource, view?: FeedViewType) {
  immerSet((draft) => {
    for (const [subscriptionStoreId, subscription] of Object.entries(draft.data)) {
      if (getSubscriptionSource(subscription) !== source) continue
      if (typeof view === "number" && subscription.view !== view) continue

      draft.subscriptionIdSet.delete(getSubscriptionDBId(subscription))

      if (subscription.feedId) {
        draft.feedIdByView[subscription.view]!.delete(subscription.feedId)
        draft.feedIdByView[FeedViewType.All]!.delete(subscription.feedId)
      }

      if (subscription.listId) {
        draft.listIdByView[subscription.view]!.delete(subscription.listId)
        draft.listIdByView[FeedViewType.All]!.delete(subscription.listId)
      }

      if (subscription.category) {
        draft.categories[subscription.view]!.delete(subscription.category)
        draft.categories[FeedViewType.All]!.delete(subscription.category)
      }

      delete draft.data[subscriptionStoreId]
    }
  })
}
```

- [ ] **Step 5: Use source-aware reset during cloud fetch**

In `SubscriptionActions.upsertMany`, extend options:

```ts
options: {
  resetBeforeUpsert?: boolean | FeedViewType
  resetSource?: SubscriptionSource
} = {},
```

Inside `tx.store`, before `this.upsertManyInSession(subscriptions)`:

```ts
if (options.resetBeforeUpsert !== undefined) {
  const resetView =
    typeof options.resetBeforeUpsert === "number" ? options.resetBeforeUpsert : undefined

  if (options.resetSource) {
    this.resetBySourceInSession(options.resetSource, resetView)
  } else if (typeof options.resetBeforeUpsert === "boolean") {
    this.reset()
  } else {
    this.resetByView(options.resetBeforeUpsert)
  }
}
```

Inside `tx.persist`, replace the existing upsert-only function with:

```ts
return (async () => {
  if (options.resetSource) {
    const resetView =
      typeof options.resetBeforeUpsert === "number" ? options.resetBeforeUpsert : undefined
    await SubscriptionService.resetBySource(options.resetSource, resetView)
  }

  return SubscriptionService.upsertMany(
    subscriptions.map((s) => storeDbMorph.toSubscriptionSchema(s)),
  )
})()
```

In `SubscriptionSyncService.fetch`, change:

```ts
resetBeforeUpsert: typeof view === "number" ? view : true,
```

to:

```ts
resetBeforeUpsert: typeof view === "number" ? view : true,
resetSource: "cloud",
```

- [ ] **Step 6: Run source-aware store test**

Run:

```powershell
pnpm --filter @follow/store test -- store-source.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run store typecheck**

Run:

```powershell
pnpm --filter @follow/store typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/internal/database/src/services/subscription.ts packages/internal/store/src/modules/subscription/store.ts packages/internal/store/src/modules/subscription/store-source.test.ts
git commit -m "feat: preserve local subscriptions during cloud sync"
```

---

### Task 5: Add Local Feed Subscription Action

**Files:**

- Modify: `packages/internal/store/src/modules/subscription/store.ts`
- Modify: `packages/internal/store/src/modules/subscription/types.ts`
- Test: `packages/internal/store/src/modules/subscription/store-source.test.ts`

- [ ] **Step 1: Write failing local subscribe test**

Append to `store-source.test.ts`:

```ts
test("subscribeLocal inserts a local feed subscription", async () => {
  await subscriptionActions.subscribeLocal({
    feed: {
      id: "local-feed",
      url: "https://example.com/feed.xml",
      title: "Example Feed",
      description: null,
      image: null,
      siteUrl: "https://example.com",
      ownerUserId: null,
      errorAt: null,
      errorMessage: null,
      type: "feed",
    },
    subscription: {
      url: "https://example.com/feed.xml",
      view: FeedViewType.Articles,
      category: "Local",
      isPrivate: false,
      hideFromTimeline: null,
      title: null,
      feedId: "local-feed",
      listId: undefined,
    },
    entries: [],
  })

  const state = useSubscriptionStore.getState()
  expect(state.data["local-feed"]?.source).toBe("local")
  expect(state.feedIdByView[FeedViewType.Articles]?.has("local-feed")).toBe(true)
})
```

Run:

```powershell
pnpm --filter @follow/store test -- store-source.test.ts
```

Expected: FAIL because `subscribeLocal` does not exist.

- [ ] **Step 2: Add type for local subscribe input**

In `packages/internal/store/src/modules/subscription/types.ts`, add:

```ts
import type { ParsedEntry } from "@follow-app/client-sdk"
import type { FeedModel } from "../feed/types"
```

Add:

```ts
export interface LocalSubscriptionInput {
  feed: FeedModel
  subscription: SubscriptionForm
  entries?: ParsedEntry[]
}
```

- [ ] **Step 3: Implement subscribeLocal**

In `packages/internal/store/src/modules/subscription/store.ts`, import:

```ts
import type { LocalSubscriptionInput } from "./types"
```

Add this method to `SubscriptionSyncService`:

```ts
async subscribeLocal({ feed, subscription }: LocalSubscriptionInput) {
  const feedId = subscription.feedId || feed.id

  if (!feedId) {
    throw new Error("Cannot add local subscription without a feed id")
  }

  const existing = get().data[feedId]
  if (existing && existing.source === "local") {
    throw new Error("Local subscription already exists")
  }

  await feedActions.upsertMany([feed])

  await subscriptionActions.upsertMany([
    {
      ...subscription,
      feedId,
      listId: null,
      inboxId: null,
      title: subscription.title ?? null,
      category: subscription.category ?? null,
      type: "feed",
      createdAt: new Date().toISOString(),
      userId: "local",
      source: "local",
    },
  ])

  invalidateViews(subscription.view)
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
pnpm --filter @follow/store test -- store-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/internal/store/src/modules/subscription/types.ts packages/internal/store/src/modules/subscription/store.ts packages/internal/store/src/modules/subscription/store-source.test.ts
git commit -m "feat: add local feed subscription action"
```

---

### Task 6: Make FeedForm Add to Local by Default

**Files:**

- Modify: `apps/desktop/layer/renderer/src/modules/discover/FeedForm.tsx`

- [ ] **Step 1: Write behavior note before code**

Add this exact comment above the `followMutation` declaration:

```ts
// Local add is the default in the custom desktop build. Cloud sync remains a separate action.
```

Run:

```powershell
pnpm --filter @follow/web typecheck
```

Expected: PASS. This step verifies the file compiles before behavior changes.

- [ ] **Step 2: Change submit mutation to local add**

Inside `FeedInnerForm`, change mutation logic from:

```ts
if (isSubscribed) {
  return subscriptionSyncService.edit(body)
} else {
  return subscriptionSyncService.subscribe(body)
}
```

to:

```ts
if (isSubscribed) {
  return subscriptionSyncService.edit(body)
}

return subscriptionSyncService.subscribeLocal({
  feed,
  subscription: body,
  entries,
})
```

- [ ] **Step 3: Allow unauthenticated local add**

Remove `disabled={!isLoggedIn}` from the submit button.

Keep the cancel button behavior unchanged.

- [ ] **Step 4: Change button label**

Change submit label from:

```tsx
{
  isSubscribed ? t("feed_form.update") : t("feed_form.follow")
}
```

to:

```tsx
{
  isSubscribed ? t("feed_form.update") : "添加到本地"
}
```

- [ ] **Step 5: Remove unused login variable if needed**

If `isLoggedIn` becomes unused, remove:

```ts
const isLoggedIn = useIsLoggedIn()
```

If `useIsLoggedIn` import becomes unused, remove it from the import line.

- [ ] **Step 6: Verify renderer typecheck**

Run:

```powershell
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/desktop/layer/renderer/src/modules/discover/FeedForm.tsx
git commit -m "feat: add feeds locally by default"
```

---

### Task 7: Show Source Badge on Feed Rows

**Files:**

- Modify: `apps/desktop/layer/renderer/src/modules/subscription-column/FeedItem.tsx`

- [ ] **Step 1: Add source badge rendering**

In `FeedItem.tsx`, use the existing subscription data in `FeedItemImpl` and render:

```tsx
{
  subscription?.source === "local" && (
    <span className="ml-1 rounded bg-orange/10 px-1 text-[10px] leading-4 text-orange">本地</span>
  )
}
{
  subscription?.source === "cloud" && (
    <span className="ml-1 rounded bg-blue/10 px-1 text-[10px] leading-4 text-blue">同步</span>
  )
}
```

Place the badge beside the feed title, inside the title row.

- [ ] **Step 2: Verify renderer typecheck**

Run:

```powershell
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add apps/desktop/layer/renderer/src/modules/subscription-column/FeedItem.tsx
git commit -m "feat: show subscription source badge"
```

---

### Task 8: Manual Smoke Test

**Files:**

- No code files.

- [ ] **Step 1: Start desktop dev app**

Run:

```powershell
pnpm --dir apps/desktop dev:electron
```

Expected: Electron desktop app opens.

- [ ] **Step 2: Add a local RSS while logged out**

Use Discover -> RSS URL and add:

```text
https://openai.com/news/rss.xml
```

Expected:

- Submit button says “添加到本地”.
- No login modal appears.
- Feed appears in the subscription list with “本地”.

- [ ] **Step 3: Log in and verify local source remains**

Log in to the same account used earlier.

Expected:

- Cloud subscriptions appear.
- The local subscription still appears.
- The local subscription still has “本地”.
- Cloud subscriptions have “同步”.

- [ ] **Step 4: Verify git state**

Run:

```powershell
git status --short --branch
```

Expected: clean worktree on `custom/my-folo`.

---

## Self-Review Notes

- The plan covers the MVP slice only. The deferred right-click sync and full sidebar sectioning need a second plan.
- The source model is durable in SQLite and represented in store models.
- The cloud fetch behavior explicitly preserves local subscriptions.
- The local add path is test-first and uses the existing feed preview data.
- The plan avoids changing official cloud quota behavior.
