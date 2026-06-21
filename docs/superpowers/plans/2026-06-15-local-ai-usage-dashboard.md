# Local AI Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long local AI usage list with a compact usage dashboard that shows summary totals, a recent trend chart, and collapsible recent records.

**Architecture:** Keep storage and IPC unchanged. Add a focused renderer utility for aggregating records into summary and chart data, then update `LocalUsageSection` to render cards, a lightweight SVG chart, and a small expandable record list.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, Tailwind UIKit color tokens, existing i18next locale files.

---

### Task 1: Usage Aggregation Utility

**Files:**

- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/local-usage-insights.ts`
- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/local-usage-insights.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"

import type { DesktopLocalAIUsageRecord } from "~/modules/local-ai/hooks"

import { buildLocalUsageInsights } from "./local-usage-insights"

const record = (
  input: Partial<DesktopLocalAIUsageRecord> & Pick<DesktopLocalAIUsageRecord, "createdAt" | "id">,
): DesktopLocalAIUsageRecord => ({
  errorMessage: null,
  feature: "chat",
  model: "deepseek-v4-flash",
  ok: true,
  profileId: "profile-1",
  totalTokens: 0,
  ...input,
})

describe("buildLocalUsageInsights", () => {
  it("summarizes local usage and buckets the last 24 hours", () => {
    const insights = buildLocalUsageInsights(
      [
        record({ createdAt: "2026-06-15T13:30:00.000Z", id: "1", totalTokens: 400 }),
        record({ createdAt: "2026-06-15T13:10:00.000Z", id: "2", totalTokens: 100 }),
        record({ createdAt: "2026-06-15T12:45:00.000Z", id: "3", ok: false }),
        record({ createdAt: "2026-06-13T10:00:00.000Z", id: "4", totalTokens: 900 }),
        record({ createdAt: "2026-06-01T10:00:00.000Z", id: "5", totalTokens: 700 }),
      ],
      new Date("2026-06-15T14:00:00.000Z"),
    )

    expect(insights.summary.todayTokens).toBe(500)
    expect(insights.summary.last7DaysTokens).toBe(1400)
    expect(insights.summary.last7DaysRequests).toBe(4)
    expect(insights.summary.last7DaysFailures).toBe(1)
    expect(insights.recentRecords).toHaveLength(5)
    expect(insights.buckets).toHaveLength(24)
    expect(insights.buckets.at(-2)).toMatchObject({
      failureCount: 1,
      requestCount: 1,
      totalTokens: 0,
    })
    expect(insights.buckets.at(-1)).toMatchObject({
      failureCount: 0,
      requestCount: 2,
      totalTokens: 500,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/settings/tabs/ai/api-management/local-usage-insights.test.ts`
Expected: FAIL because `local-usage-insights` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `buildLocalUsageInsights(records, now)` that returns `summary`, 24 hourly `buckets`, `chartPath`, and the first 5 `recentRecords`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/settings/tabs/ai/api-management/local-usage-insights.test.ts`
Expected: PASS.

### Task 2: Dashboard UI

**Files:**

- Modify: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/LocalUsageSection.tsx`
- Modify: `locales/ai/en.json`
- Modify: `locales/ai/zh-CN.json`
- Modify: `locales/ai/ja.json`

- [ ] **Step 1: Update query size**

Change `useLocalAIUsage(20)` to `useLocalAIUsage(200)` so charts have enough recent data without changing the 500-record storage limit.

- [ ] **Step 2: Render summary cards**

Add compact cards for today tokens, last 7 days tokens, requests, and failed requests.

- [ ] **Step 3: Render SVG trend chart**

Use `buildLocalUsageInsights` output. The chart should show a green line for token usage, subtle grid lines, and interactive points that update a detail panel on hover/focus.

- [ ] **Step 4: Render collapsible recent records**

Show 5 records by default. Add a button to expand/collapse all currently loaded records.

- [ ] **Step 5: Add translations**

Add labels for summary cards, chart title, hover details, recent records, expand/collapse, and no-token states in English, Chinese, and Japanese.

### Task 3: Verification

**Files:**

- Test: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/local-usage-insights.test.ts`

- [ ] **Step 1: Run focused tests**

Run: `pnpm vitest run src/modules/settings/tabs/ai/api-management/local-usage-insights.test.ts`
Expected: PASS.

- [ ] **Step 2: Run renderer typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run focused lint**

Run: `pnpm exec eslint src/modules/settings/tabs/ai/api-management/LocalUsageSection.tsx src/modules/settings/tabs/ai/api-management/local-usage-insights.ts src/modules/settings/tabs/ai/api-management/local-usage-insights.test.ts`
Expected: 0 errors.
