# OpenAI-Compatible AI API Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-first OpenAI-compatible AI API management system and route Folo desktop AI features through local user-managed providers.

**Architecture:** Keep secrets and provider calls in Electron main process, expose a typed `localAI` IPC service to renderer, and let shared stores use an optional local AI bridge so desktop behavior does not leak into mobile/web. Roll out feature routing in phases: API profiles, chat, summary/translation, timeline, tasks, TTS, and MCP.

**Tech Stack:** TypeScript, Electron IPC via `electron-ipc-decorator`, Electron `safeStorage`, `electron-store`, React, Jotai settings, TanStack Query, Zustand, AI SDK UI streams, Vitest.

---

## Scope Check

This is a master implementation plan for a broad feature set. Execute it in order. Each task is shippable and testable on its own, and the app must continue to work with existing Folo AI fallback after every task.

The full spec covers multiple subsystems: profile management, chat, summary, translation, timeline sorting, tasks, TTS, and MCP. This plan keeps them in one document because the user requested full coverage, but each task has a narrow file set and a commit boundary.

## File Structure

Create or modify these files:

- `packages/internal/shared/src/settings/interface.ts`  
  Add local AI setting types and feature routing fields.
- `packages/internal/shared/src/settings/defaults.ts`  
  Add default local AI settings.
- `packages/internal/store/src/modules/local-ai/types.ts`  
  Define the optional local AI bridge contract used by shared stores.
- `packages/internal/store/src/context.ts`  
  Add an optional local AI context.
- `packages/internal/store/src/modules/summary/store.ts`  
  Route summaries to local AI when enabled.
- `packages/internal/store/src/modules/translation/store.ts`  
  Route translations to local AI when enabled and remove free-role blocking for local AI.
- `apps/desktop/layer/main/src/lib/local-ai/types.ts`  
  Main-process local AI profile, request, response, and usage types.
- `apps/desktop/layer/main/src/lib/local-ai/profile-store.ts`  
  Store profile metadata and encrypted API keys.
- `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts`  
  Call OpenAI-compatible chat, text, model listing, and speech APIs.
- `apps/desktop/layer/main/src/lib/local-ai/usage-store.ts`  
  Record local usage and last errors.
- `apps/desktop/layer/main/src/lib/local-ai/tasks-store.ts`  
  Store and run local AI tasks.
- `apps/desktop/layer/main/src/lib/local-ai/mcp-client.ts`  
  Manage local MCP HTTP/SSE service discovery and tool calls.
- `apps/desktop/layer/main/src/ipc/services/local-ai.ts`  
  Expose local AI operations to renderer.
- `apps/desktop/layer/main/src/ipc/index.ts`  
  Register the new `LocalAIService`.
- `apps/desktop/layer/main/src/lib/store.ts`  
  Add local AI store keys.
- `apps/desktop/layer/renderer/src/modules/local-ai/bridge.ts`  
  Provide desktop local AI bridge to shared stores.
- `apps/desktop/layer/renderer/src/modules/local-ai/hooks.ts`  
  Query helpers for local AI profiles and routing.
- `apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.ts`  
  AI SDK chat transport that reads streamed IPC events.
- `apps/desktop/layer/renderer/src/modules/local-ai/timeline-ranking.ts`  
  Local timeline ranking helper.
- `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/*`  
  API management UI components.
- `apps/desktop/layer/renderer/src/modules/settings/tabs/ai.tsx`  
  Replace the narrow BYOK UI with API management sections.
- `apps/desktop/layer/renderer/src/modules/ai-chat/store/transport.ts`  
  Select local or Folo chat transport.
- `apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useAIConfiguration.ts`  
  Merge local model configuration with Folo configuration.
- `apps/desktop/layer/renderer/src/modules/entry-column/hooks/useEntriesByView.ts`  
  Use local timeline ranking when enabled.
- `apps/desktop/layer/renderer/src/modules/ai-task/query.ts`  
  Route AI task hooks to local tasks when enabled.
- `apps/desktop/layer/renderer/src/modules/player/tts-service.ts`  
  Route TTS through local AI speech when enabled.
- `apps/desktop/layer/renderer/src/initialize/index.ts`  
  Provide the local AI bridge during desktop initialization.
- `locales/ai/en.json`, `locales/ai/zh-CN.json`, `locales/ai/ja.json`  
  Add API management labels and local task/TTS/MCP copy.

## Task 1: Shared Settings And Store Bridge Contract

**Files:**

- Modify: `packages/internal/shared/src/settings/interface.ts`
- Modify: `packages/internal/shared/src/settings/defaults.ts`
- Create: `packages/internal/store/src/modules/local-ai/types.ts`
- Modify: `packages/internal/store/src/context.ts`
- Test: `packages/internal/store/src/modules/local-ai/types.test.ts`

- [ ] **Step 1: Add failing tests for optional local AI context**

Create `packages/internal/store/src/modules/local-ai/types.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { localAI, localAIContext } from "../../context"
import type { LocalAIBridge } from "./types"

describe("local AI context", () => {
  it("returns undefined before desktop provides a bridge", () => {
    localAIContext.provide(undefined)
    expect(localAI()).toBeUndefined()
  })

  it("returns the provided bridge", async () => {
    const bridge: LocalAIBridge = {
      isFeatureEnabled: vi.fn(() => true),
      summarizeEntry: vi.fn(async () => "summary"),
      translateEntries: vi.fn(async () => ({})),
    }

    localAIContext.provide(bridge)

    expect(localAI()?.isFeatureEnabled("summary")).toBe(true)
    await expect(
      localAI()?.summarizeEntry({
        entryId: "entry-1",
        title: "Title",
        content: "Body",
        target: "content",
        language: "en",
      }),
    ).resolves.toBe("summary")
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @follow/store test -- src/modules/local-ai/types.test.ts
```

Expected: FAIL because `localAIContext`, `localAI`, and `LocalAIBridge` do not exist.

- [ ] **Step 3: Add local AI settings types**

In `packages/internal/shared/src/settings/interface.ts`, add these types near the existing AI settings types:

```ts
export type LocalAIFeature =
  | "chat"
  | "summary"
  | "translation"
  | "timeline"
  | "task"
  | "tts"
  | "mcp"
  | "onboarding"

export type LocalAIMode = "folo" | "custom-first" | "custom-only"

export interface LocalAIFeatureRouting {
  chatProfileId: string | null
  summaryProfileId: string | null
  translationProfileId: string | null
  timelineProfileId: string | null
  taskProfileId: string | null
  ttsProfileId: string | null
  mcpProfileId: string | null
  onboardingProfileId: string | null
}

export interface LocalAISettings {
  mode: LocalAIMode
  fallbackToFoloAI: boolean
  routing: LocalAIFeatureRouting
}
```

Add this property to `AISettings`:

```ts
localAI: LocalAISettings
```

- [ ] **Step 4: Add default local AI settings**

In `packages/internal/shared/src/settings/defaults.ts`, add `localAI` inside `defaultAISettings`:

```ts
  localAI: {
    mode: "folo",
    fallbackToFoloAI: true,
    routing: {
      chatProfileId: null,
      summaryProfileId: null,
      translationProfileId: null,
      timelineProfileId: null,
      taskProfileId: null,
      ttsProfileId: null,
      mcpProfileId: null,
      onboardingProfileId: null,
    },
  },
```

- [ ] **Step 5: Add the bridge contract**

Create `packages/internal/store/src/modules/local-ai/types.ts`:

```ts
import type { LocalAIFeature } from "@follow/shared/settings/interface"

export interface LocalAISummaryInput {
  entryId: string
  title: string
  content: string
  target: "content" | "readabilityContent"
  language: string
}

export interface LocalAITranslationItem {
  entryId: string
  title?: string | null
  description?: string | null
  content?: string | null
  readabilityContent?: string | null
}

export interface LocalAITranslateEntriesInput {
  items: LocalAITranslationItem[]
  language: string
  fields: string
  mode: "bilingual" | "translation"
}

export interface LocalAITranslationResult {
  entryId: string
  title: string | null
  description: string | null
  content: string | null
  readabilityContent: string | null
}

export interface LocalAIBridge {
  isFeatureEnabled: (feature: LocalAIFeature) => boolean
  summarizeEntry: (input: LocalAISummaryInput) => Promise<string | null>
  translateEntries: (
    input: LocalAITranslateEntriesInput,
  ) => Promise<Record<string, LocalAITranslationResult | null>>
}
```

- [ ] **Step 6: Add optional local AI context**

Modify `packages/internal/store/src/context.ts`:

```ts
import type { LocalAIBridge } from "./modules/local-ai/types"
```

Add this helper below `createJSContext`:

```ts
function createOptionalJSContext<T>() {
  let contextValue: T | undefined

  const provide = (value: T | undefined) => {
    contextValue = value
  }

  const consumer = (): T | undefined => contextValue

  return {
    provide,
    consumer,
  }
}
```

Add exports:

```ts
export const localAIContext = createOptionalJSContext<LocalAIBridge>()
export const localAI = localAIContext.consumer
```

- [ ] **Step 7: Run the test**

Run:

```bash
pnpm --filter @follow/store test -- src/modules/local-ai/types.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run shared and store typechecks**

Run:

```bash
pnpm --filter @follow/shared typecheck
pnpm --filter @follow/store typecheck
```

Expected: both commands pass.

- [ ] **Step 9: Commit**

```bash
git add packages/internal/shared/src/settings/interface.ts packages/internal/shared/src/settings/defaults.ts packages/internal/store/src/context.ts packages/internal/store/src/modules/local-ai/types.ts packages/internal/store/src/modules/local-ai/types.test.ts
git commit -m "feat: add local ai settings contract"
```

## Task 2: Main-Process Profile Storage With Encrypted Keys

**Files:**

- Create: `apps/desktop/layer/main/src/lib/local-ai/types.ts`
- Create: `apps/desktop/layer/main/src/lib/local-ai/profile-store.ts`
- Modify: `apps/desktop/layer/main/src/lib/store.ts`
- Test: `apps/desktop/layer/main/src/lib/local-ai/profile-store.test.ts`

- [ ] **Step 1: Write profile store tests**

Create `apps/desktop/layer/main/src/lib/local-ai/profile-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  deleteLocalAIProfile,
  listLocalAIProfiles,
  readLocalAIProfileSecret,
  upsertLocalAIProfile,
} from "./profile-store"

const memory = new Map<string, unknown>()

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString("utf8").replace("encrypted:", ""),
  },
}))

vi.mock("~/lib/store", () => ({
  store: {
    get: vi.fn((key: string) => memory.get(key)),
    set: vi.fn((key: string, value: unknown) => memory.set(key, value)),
  },
}))

describe("local AI profile store", () => {
  beforeEach(() => {
    memory.clear()
  })

  it("stores profiles with masked API keys", () => {
    const profile = upsertLocalAIProfile({
      name: "DeepSeek",
      providerType: "openai-compatible",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: "sk-secret123456",
      headers: {},
      enabled: true,
      models: ["deepseek-chat"],
      defaultChatModel: "deepseek-chat",
      defaultSummaryModel: "deepseek-chat",
      defaultTranslationModel: "deepseek-chat",
      defaultTimelineModel: "deepseek-chat",
      defaultTaskModel: "deepseek-chat",
      defaultTtsModel: null,
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTools: false,
      supportsTts: false,
    })

    expect(listLocalAIProfiles()).toEqual([
      expect.objectContaining({
        id: profile.id,
        name: "DeepSeek",
        maskedApiKey: "sk-...3456",
      }),
    ])
    expect(readLocalAIProfileSecret(profile.id)).toBe("sk-secret123456")
  })

  it("updates metadata without replacing the key when apiKey is undefined", () => {
    const profile = upsertLocalAIProfile({
      name: "OpenAI",
      providerType: "openai-compatible",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-original",
      headers: {},
      enabled: true,
      models: ["gpt-4o-mini"],
      defaultChatModel: "gpt-4o-mini",
      defaultSummaryModel: "gpt-4o-mini",
      defaultTranslationModel: "gpt-4o-mini",
      defaultTimelineModel: "gpt-4o-mini",
      defaultTaskModel: "gpt-4o-mini",
      defaultTtsModel: "tts-1",
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsTools: true,
      supportsTts: true,
    })

    upsertLocalAIProfile({
      ...profile,
      name: "OpenAI Updated",
      apiKey: undefined,
    })

    expect(listLocalAIProfiles()[0]?.name).toBe("OpenAI Updated")
    expect(readLocalAIProfileSecret(profile.id)).toBe("sk-original")
  })

  it("removes profile metadata and secret", () => {
    const profile = upsertLocalAIProfile({
      name: "Local",
      providerType: "openai-compatible",
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
      headers: {},
      enabled: true,
      models: ["llama3.1"],
      defaultChatModel: "llama3.1",
      defaultSummaryModel: "llama3.1",
      defaultTranslationModel: "llama3.1",
      defaultTimelineModel: "llama3.1",
      defaultTaskModel: "llama3.1",
      defaultTtsModel: null,
      supportsStreaming: true,
      supportsJsonMode: false,
      supportsTools: false,
      supportsTts: false,
    })

    deleteLocalAIProfile(profile.id)

    expect(listLocalAIProfiles()).toEqual([])
    expect(readLocalAIProfileSecret(profile.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/profile-store.test.ts
```

Expected: FAIL because the profile store files do not exist.

- [ ] **Step 3: Add main local AI types**

Create `apps/desktop/layer/main/src/lib/local-ai/types.ts`:

```ts
export type LocalAIProviderType = "openai-compatible"

export interface LocalAIProfileUpsertInput {
  id?: string
  name: string
  providerType: LocalAIProviderType
  baseURL: string
  apiKey?: string | null
  headers: Record<string, string>
  enabled: boolean
  models: string[]
  defaultChatModel: string | null
  defaultSummaryModel: string | null
  defaultTranslationModel: string | null
  defaultTimelineModel: string | null
  defaultTaskModel: string | null
  defaultTtsModel: string | null
  supportsStreaming: boolean
  supportsJsonMode: boolean
  supportsTools: boolean
  supportsTts: boolean
}

export interface LocalAIStoredProfile extends Omit<LocalAIProfileUpsertInput, "apiKey" | "id"> {
  id: string
  createdAt: string
  updatedAt: string
  lastTestedAt: string | null
  lastTestResult: LocalAITestResult | null
}

export interface LocalAIProfileView extends LocalAIStoredProfile {
  maskedApiKey: string | null
}

export interface LocalAITestResult {
  ok: boolean
  message: string
  testedAt: string
}
```

- [ ] **Step 4: Add store keys**

Modify `apps/desktop/layer/main/src/lib/store.ts`:

```ts
import type { LocalAIStoredProfile } from "./local-ai/types"
```

Add fields to `StoreData`:

```ts
  localAIEncryptedSecrets?: Record<string, string> | null
  localAIProfiles?: LocalAIStoredProfile[] | null
```

- [ ] **Step 5: Implement profile storage**

Create `apps/desktop/layer/main/src/lib/local-ai/profile-store.ts`:

```ts
import { safeStorage } from "electron"
import { nanoid } from "nanoid"

import { store } from "~/lib/store"

import type { LocalAIProfileUpsertInput, LocalAIProfileView, LocalAIStoredProfile } from "./types"

const PROFILES_KEY = "localAIProfiles"
const SECRETS_KEY = "localAIEncryptedSecrets"
const SAFE_PREFIX = "safe:"
const TEXT_PREFIX = "text:"

const nowIso = () => new Date().toISOString()

const normalizeBaseURL = (value: string) => value.trim().replace(/\/+$/, "")

export const maskSecret = (secret: string | null | undefined) => {
  if (!secret) return null
  if (secret.length <= 8) return "••••"
  return `${secret.slice(0, 3)}...${secret.slice(-4)}`
}

const encryptSecret = (secret: string) => {
  if (safeStorage.isEncryptionAvailable()) {
    return `${SAFE_PREFIX}${safeStorage.encryptString(secret).toString("base64")}`
  }
  return `${TEXT_PREFIX}${Buffer.from(secret, "utf8").toString("base64")}`
}

const decryptSecret = (value: string) => {
  if (value.startsWith(SAFE_PREFIX)) {
    return safeStorage.decryptString(Buffer.from(value.slice(SAFE_PREFIX.length), "base64"))
  }
  if (value.startsWith(TEXT_PREFIX)) {
    return Buffer.from(value.slice(TEXT_PREFIX.length), "base64").toString("utf8")
  }
  return null
}

const readProfiles = (): LocalAIStoredProfile[] => store.get(PROFILES_KEY) ?? []

const writeProfiles = (profiles: LocalAIStoredProfile[]) => {
  store.set(PROFILES_KEY, profiles)
}

const readSecrets = (): Record<string, string> => store.get(SECRETS_KEY) ?? {}

const writeSecrets = (secrets: Record<string, string>) => {
  store.set(SECRETS_KEY, secrets)
}

export const readLocalAIProfileSecret = (profileId: string) => {
  const secret = readSecrets()[profileId]
  return secret ? decryptSecret(secret) : null
}

export const listLocalAIProfiles = (): LocalAIProfileView[] =>
  readProfiles().map((profile) => ({
    ...profile,
    maskedApiKey: maskSecret(readLocalAIProfileSecret(profile.id)),
  }))

export const upsertLocalAIProfile = (input: LocalAIProfileUpsertInput): LocalAIProfileView => {
  const profiles = readProfiles()
  const existing = input.id ? profiles.find((profile) => profile.id === input.id) : undefined
  const timestamp = nowIso()
  const id = existing?.id ?? input.id ?? nanoid()

  const nextProfile: LocalAIStoredProfile = {
    id,
    name: input.name.trim(),
    providerType: input.providerType,
    baseURL: normalizeBaseURL(input.baseURL),
    headers: input.headers,
    enabled: input.enabled,
    models: input.models,
    defaultChatModel: input.defaultChatModel,
    defaultSummaryModel: input.defaultSummaryModel,
    defaultTranslationModel: input.defaultTranslationModel,
    defaultTimelineModel: input.defaultTimelineModel,
    defaultTaskModel: input.defaultTaskModel,
    defaultTtsModel: input.defaultTtsModel,
    supportsStreaming: input.supportsStreaming,
    supportsJsonMode: input.supportsJsonMode,
    supportsTools: input.supportsTools,
    supportsTts: input.supportsTts,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastTestedAt: existing?.lastTestedAt ?? null,
    lastTestResult: existing?.lastTestResult ?? null,
  }

  const nextProfiles = existing
    ? profiles.map((profile) => (profile.id === id ? nextProfile : profile))
    : [...profiles, nextProfile]

  writeProfiles(nextProfiles)

  if (input.apiKey !== undefined && input.apiKey !== null && input.apiKey.trim()) {
    writeSecrets({
      ...readSecrets(),
      [id]: encryptSecret(input.apiKey.trim()),
    })
  }

  return {
    ...nextProfile,
    maskedApiKey: maskSecret(readLocalAIProfileSecret(id)),
  }
}

export const deleteLocalAIProfile = (profileId: string) => {
  writeProfiles(readProfiles().filter((profile) => profile.id !== profileId))
  const secrets = readSecrets()
  delete secrets[profileId]
  writeSecrets(secrets)
}
```

- [ ] **Step 6: Add `nanoid` dependency to main if needed**

If `apps/desktop/layer/main/package.json` does not already depend on `nanoid`, add:

```json
"nanoid": "5.1.6"
```

Run:

```bash
pnpm install
```

Expected: lockfile updates only if the dependency was absent.

- [ ] **Step 7: Run profile store tests**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/profile-store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run main typecheck**

Run:

```bash
pnpm --filter @follow/electron-main typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/layer/main/src/lib/local-ai/types.ts apps/desktop/layer/main/src/lib/local-ai/profile-store.ts apps/desktop/layer/main/src/lib/local-ai/profile-store.test.ts apps/desktop/layer/main/src/lib/store.ts apps/desktop/layer/main/package.json pnpm-lock.yaml
git commit -m "feat: store local ai profiles securely"
```

## Task 3: OpenAI-Compatible Client And Usage Store

**Files:**

- Create: `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts`
- Create: `apps/desktop/layer/main/src/lib/local-ai/usage-store.ts`
- Modify: `apps/desktop/layer/main/src/lib/local-ai/types.ts`
- Test: `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.test.ts`
- Test: `apps/desktop/layer/main/src/lib/local-ai/usage-store.test.ts`

- [ ] **Step 1: Write request-construction and stream parser tests**

Create `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import {
  completeOpenAICompatibleText,
  listOpenAICompatibleModels,
  streamOpenAICompatibleChat,
} from "./openai-compatible"

const profile = {
  id: "profile-1",
  name: "Test",
  providerType: "openai-compatible" as const,
  baseURL: "https://api.example.com/v1",
  headers: { "x-test": "yes" },
  enabled: true,
  models: ["model-a"],
  defaultChatModel: "model-a",
  defaultSummaryModel: "model-a",
  defaultTranslationModel: "model-a",
  defaultTimelineModel: "model-a",
  defaultTaskModel: "model-a",
  defaultTtsModel: null,
  supportsStreaming: true,
  supportsJsonMode: true,
  supportsTools: false,
  supportsTts: false,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
  lastTestedAt: null,
  lastTestResult: null,
}

describe("OpenAI-compatible client", () => {
  it("lists models", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] })),
    )

    await expect(
      listOpenAICompatibleModels({ profile, apiKey: "sk-test", fetchFn: fetchMock }),
    ).resolves.toEqual(["model-a", "model-b"])

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "x-test": "yes",
        }),
      }),
    )
  })

  it("completes text", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello" } }],
            usage: { total_tokens: 12 },
          }),
        ),
    )

    await expect(
      completeOpenAICompatibleText({
        profile,
        apiKey: "sk-test",
        model: "model-a",
        messages: [{ role: "user", content: "Say hello" }],
        fetchFn: fetchMock,
      }),
    ).resolves.toEqual({ text: "Hello", totalTokens: 12 })
  })

  it("streams chat deltas from SSE chunks", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")

    const fetchMock = vi.fn(async () => new Response(body))
    const onDelta = vi.fn()

    await streamOpenAICompatibleChat({
      profile,
      apiKey: "sk-test",
      model: "model-a",
      messages: [{ role: "user", content: "Say hello" }],
      onDelta,
      fetchFn: fetchMock,
    })

    expect(onDelta).toHaveBeenNthCalledWith(1, "Hel")
    expect(onDelta).toHaveBeenNthCalledWith(2, "lo")
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/openai-compatible.test.ts
```

Expected: FAIL because the client is not implemented.

- [ ] **Step 3: Add request and response types**

Extend `apps/desktop/layer/main/src/lib/local-ai/types.ts`:

```ts
export type LocalAIChatRole = "system" | "user" | "assistant" | "tool"

export interface LocalAIChatMessage {
  role: LocalAIChatRole
  content: string
}

export interface LocalAITextResult {
  text: string
  totalTokens: number | null
}

export interface LocalAIUsageRecord {
  id: string
  feature: string
  profileId: string
  model: string
  totalTokens: number | null
  ok: boolean
  errorMessage: string | null
  createdAt: string
}
```

- [ ] **Step 4: Implement the OpenAI-compatible client**

Create `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts`:

```ts
import type { LocalAIChatMessage, LocalAIStoredProfile, LocalAITextResult } from "./types"

interface ClientInput {
  profile: LocalAIStoredProfile
  apiKey: string
  fetchFn?: typeof fetch
}

const jsonHeaders = (profile: LocalAIStoredProfile, apiKey: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
  ...profile.headers,
})

const endpoint = (profile: LocalAIStoredProfile, path: string) =>
  `${profile.baseURL.replace(/\/+$/, "")}${path}`

const readError = async (response: Response) => {
  const text = await response.text().catch(() => "")
  return text || `${response.status} ${response.statusText}`
}

export const listOpenAICompatibleModels = async ({
  profile,
  apiKey,
  fetchFn = fetch,
}: ClientInput): Promise<string[]> => {
  const response = await fetchFn(endpoint(profile, "/models"), {
    headers: jsonHeaders(profile, apiKey),
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const data = (await response.json()) as { data?: Array<{ id?: unknown }> }
  return (data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === "string")
}

export const completeOpenAICompatibleText = async ({
  profile,
  apiKey,
  model,
  messages,
  responseFormat,
  fetchFn = fetch,
}: ClientInput & {
  model: string
  messages: LocalAIChatMessage[]
  responseFormat?: "json_object"
}): Promise<LocalAITextResult> => {
  const response = await fetchFn(endpoint(profile, "/chat/completions"), {
    method: "POST",
    headers: jsonHeaders(profile, apiKey),
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
    }),
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
    usage?: { total_tokens?: unknown }
  }
  const text = data.choices?.[0]?.message?.content

  return {
    text: typeof text === "string" ? text : "",
    totalTokens: typeof data.usage?.total_tokens === "number" ? data.usage.total_tokens : null,
  }
}

export const streamOpenAICompatibleChat = async ({
  profile,
  apiKey,
  model,
  messages,
  onDelta,
  signal,
  fetchFn = fetch,
}: ClientInput & {
  model: string
  messages: LocalAIChatMessage[]
  onDelta: (delta: string) => void
  signal?: AbortSignal
}): Promise<void> => {
  const response = await fetchFn(endpoint(profile, "/chat/completions"), {
    method: "POST",
    headers: jsonHeaders(profile, apiKey),
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }
  if (!response.body) {
    throw new Error("Provider response body is empty")
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value

    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === "[DONE]") continue

      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: unknown } }>
      }
      const delta = parsed.choices?.[0]?.delta?.content
      if (typeof delta === "string" && delta) {
        onDelta(delta)
      }
    }
  }
}
```

- [ ] **Step 5: Write and implement usage store tests**

Create `apps/desktop/layer/main/src/lib/local-ai/usage-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

import { listLocalAIUsage, recordLocalAIUsage } from "./usage-store"

const memory = new Map<string, unknown>()

vi.mock("~/lib/store", () => ({
  store: {
    get: vi.fn((key: string) => memory.get(key)),
    set: vi.fn((key: string, value: unknown) => memory.set(key, value)),
  },
}))

describe("local AI usage store", () => {
  beforeEach(() => {
    memory.clear()
  })

  it("records newest usage first and limits records", () => {
    recordLocalAIUsage({
      feature: "chat",
      profileId: "profile-1",
      model: "model-a",
      totalTokens: 10,
      ok: true,
      errorMessage: null,
    })

    expect(listLocalAIUsage()).toEqual([
      expect.objectContaining({
        feature: "chat",
        totalTokens: 10,
        ok: true,
      }),
    ])
  })
})
```

Create `apps/desktop/layer/main/src/lib/local-ai/usage-store.ts`:

```ts
import { nanoid } from "nanoid"

import { store } from "~/lib/store"

import type { LocalAIUsageRecord } from "./types"

const USAGE_KEY = "localAIUsageRecords"
const MAX_USAGE_RECORDS = 500

type UsageInput = Omit<LocalAIUsageRecord, "id" | "createdAt">

export const listLocalAIUsage = (): LocalAIUsageRecord[] => store.get(USAGE_KEY) ?? []

export const recordLocalAIUsage = (input: UsageInput) => {
  const record: LocalAIUsageRecord = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...input,
  }

  store.set(USAGE_KEY, [record, ...listLocalAIUsage()].slice(0, MAX_USAGE_RECORDS))
  return record
}
```

Add `localAIUsageRecords?: LocalAIUsageRecord[] | null` to `StoreData`.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/openai-compatible.test.ts src/lib/local-ai/usage-store.test.ts
pnpm --filter @follow/electron-main typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts apps/desktop/layer/main/src/lib/local-ai/openai-compatible.test.ts apps/desktop/layer/main/src/lib/local-ai/usage-store.ts apps/desktop/layer/main/src/lib/local-ai/usage-store.test.ts apps/desktop/layer/main/src/lib/local-ai/types.ts apps/desktop/layer/main/src/lib/store.ts
git commit -m "feat: add openai compatible local ai client"
```

## Task 4: Local AI IPC Service And Streaming Relay

**Files:**

- Create: `apps/desktop/layer/main/src/ipc/services/local-ai.ts`
- Modify: `apps/desktop/layer/main/src/ipc/index.ts`
- Test: `apps/desktop/layer/main/src/ipc/services/local-ai.test.ts`

- [ ] **Step 1: Write IPC service tests**

Create `apps/desktop/layer/main/src/ipc/services/local-ai.test.ts`:

```ts
import type { IpcContext } from "electron-ipc-decorator"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LocalAIService } from "./local-ai"

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({
      webContents: {
        send: vi.fn(),
      },
    })),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}))

vi.mock("electron-ipc-decorator", () => ({
  IpcMethod: () => (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
  IpcService: class {},
}))

vi.mock("~/lib/local-ai/profile-store", () => ({
  deleteLocalAIProfile: vi.fn(),
  listLocalAIProfiles: vi.fn(() => []),
  readLocalAIProfileSecret: vi.fn(() => "sk-test"),
  upsertLocalAIProfile: vi.fn((input) => ({
    id: "profile-1",
    ...input,
    maskedApiKey: "sk-...test",
  })),
}))

vi.mock("~/lib/local-ai/openai-compatible", () => ({
  completeOpenAICompatibleText: vi.fn(async () => ({ text: "pong", totalTokens: 1 })),
  listOpenAICompatibleModels: vi.fn(async () => ["model-a"]),
  streamOpenAICompatibleChat: vi.fn(async ({ onDelta }) => {
    onDelta("hel")
    onDelta("lo")
  }),
}))

describe("LocalAIService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists profiles", () => {
    const service = new LocalAIService()
    expect(service.listProfiles({} as IpcContext)).toEqual([])
  })

  it("starts a chat stream and emits stream events", async () => {
    const send = vi.fn()
    const service = new LocalAIService()
    const context = { sender: { send } } as unknown as IpcContext

    const result = await service.startChatStream(context, {
      profileId: "profile-1",
      model: "model-a",
      messages: [{ role: "user", content: "ping" }],
    })

    expect(result.streamId).toMatch(/^local-ai-stream-/)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(send).toHaveBeenCalledWith("local-ai:chat-delta", {
      streamId: result.streamId,
      delta: "hel",
    })
    expect(send).toHaveBeenCalledWith("local-ai:chat-finish", {
      streamId: result.streamId,
    })
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/ipc/services/local-ai.test.ts
```

Expected: FAIL because `LocalAIService` does not exist.

- [ ] **Step 3: Implement IPC service**

Create `apps/desktop/layer/main/src/ipc/services/local-ai.ts`:

```ts
import type { IpcContext } from "electron-ipc-decorator"
import { IpcMethod, IpcService } from "electron-ipc-decorator"

import {
  deleteLocalAIProfile,
  listLocalAIProfiles,
  readLocalAIProfileSecret,
  upsertLocalAIProfile,
} from "~/lib/local-ai/profile-store"
import {
  completeOpenAICompatibleText,
  listOpenAICompatibleModels,
  streamOpenAICompatibleChat,
} from "~/lib/local-ai/openai-compatible"
import type { LocalAIChatMessage, LocalAIProfileUpsertInput } from "~/lib/local-ai/types"

interface CompleteTextInput {
  profileId: string
  model: string
  messages: LocalAIChatMessage[]
  responseFormat?: "json_object"
}

interface StartChatStreamInput {
  profileId: string
  model: string
  messages: LocalAIChatMessage[]
}

const streamEvent = {
  delta: "local-ai:chat-delta",
  error: "local-ai:chat-error",
  finish: "local-ai:chat-finish",
} as const

const findProfile = (profileId: string) => {
  const profile = listLocalAIProfiles().find((item) => item.id === profileId)
  if (!profile) {
    throw new Error("Local AI profile not found")
  }
  return profile
}

const readSecret = (profileId: string) => {
  const secret = readLocalAIProfileSecret(profileId)
  if (!secret) {
    throw new Error("Local AI API key is missing")
  }
  return secret
}

export class LocalAIService extends IpcService {
  static override readonly groupName = "localAI"

  @IpcMethod()
  listProfiles(_context: IpcContext) {
    return listLocalAIProfiles()
  }

  @IpcMethod()
  upsertProfile(_context: IpcContext, input: LocalAIProfileUpsertInput) {
    return upsertLocalAIProfile(input)
  }

  @IpcMethod()
  deleteProfile(_context: IpcContext, profileId: string) {
    deleteLocalAIProfile(profileId)
  }

  @IpcMethod()
  async listModels(_context: IpcContext, profileId: string) {
    const profile = findProfile(profileId)
    return listOpenAICompatibleModels({
      profile,
      apiKey: readSecret(profileId),
    })
  }

  @IpcMethod()
  async completeText(_context: IpcContext, input: CompleteTextInput) {
    const profile = findProfile(input.profileId)
    return completeOpenAICompatibleText({
      profile,
      apiKey: readSecret(input.profileId),
      model: input.model,
      messages: input.messages,
      responseFormat: input.responseFormat,
    })
  }

  @IpcMethod()
  async startChatStream(context: IpcContext, input: StartChatStreamInput) {
    const profile = findProfile(input.profileId)
    const streamId = `local-ai-stream-${crypto.randomUUID()}`

    void streamOpenAICompatibleChat({
      profile,
      apiKey: readSecret(input.profileId),
      model: input.model,
      messages: input.messages,
      onDelta: (delta) => {
        context.sender.send(streamEvent.delta, { streamId, delta })
      },
    })
      .then(() => {
        context.sender.send(streamEvent.finish, { streamId })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Local AI stream failed"
        context.sender.send(streamEvent.error, { streamId, message })
      })

    return { streamId }
  }
}
```

- [ ] **Step 4: Register service**

Modify `apps/desktop/layer/main/src/ipc/index.ts`:

```ts
import { LocalAIService } from "./services/local-ai"
```

Add `LocalAIService` to the `createServices([...])` list.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/ipc/services/local-ai.test.ts
pnpm --filter @follow/electron-main typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/layer/main/src/ipc/services/local-ai.ts apps/desktop/layer/main/src/ipc/services/local-ai.test.ts apps/desktop/layer/main/src/ipc/index.ts
git commit -m "feat: expose local ai ipc service"
```

## Task 5: Desktop Bridge, Hooks, And API Management UI

**Files:**

- Create: `apps/desktop/layer/renderer/src/modules/local-ai/bridge.ts`
- Create: `apps/desktop/layer/renderer/src/modules/local-ai/hooks.ts`
- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/APIManagementSection.tsx`
- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/APIProfileModalContent.tsx`
- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/APIProfileItem.tsx`
- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/FeatureRoutingSection.tsx`
- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/LocalUsageSection.tsx`
- Create: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/index.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai.tsx`
- Modify: `apps/desktop/layer/renderer/src/initialize/index.ts`
- Modify: `locales/ai/en.json`
- Modify: `locales/ai/zh-CN.json`
- Modify: `locales/ai/ja.json`
- Test: `apps/desktop/layer/renderer/src/modules/local-ai/hooks.test.ts`

- [ ] **Step 1: Add hook tests**

Create `apps/desktop/layer/renderer/src/modules/local-ai/hooks.test.ts`:

```ts
import type { AISettings } from "@follow/shared/settings/interface"
import { describe, expect, it } from "vitest"

import { resolveLocalAIProfileId } from "./hooks"

const settings = {
  localAI: {
    mode: "custom-first",
    fallbackToFoloAI: true,
    routing: {
      chatProfileId: "chat-profile",
      summaryProfileId: "summary-profile",
      translationProfileId: null,
      timelineProfileId: null,
      taskProfileId: null,
      ttsProfileId: null,
      mcpProfileId: null,
      onboardingProfileId: null,
    },
  },
} as AISettings

describe("local AI hooks helpers", () => {
  it("resolves feature profile ids", () => {
    expect(resolveLocalAIProfileId(settings, "chat")).toBe("chat-profile")
    expect(resolveLocalAIProfileId(settings, "summary")).toBe("summary-profile")
    expect(resolveLocalAIProfileId(settings, "translation")).toBeNull()
  })

  it("disables local AI in Folo mode", () => {
    expect(
      resolveLocalAIProfileId(
        {
          ...settings,
          localAI: {
            ...settings.localAI,
            mode: "folo",
          },
        },
        "chat",
      ),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @follow/web test -- src/modules/local-ai/hooks.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement routing hooks**

Create `apps/desktop/layer/renderer/src/modules/local-ai/hooks.ts`:

```ts
import type { LocalAIFeature } from "@follow/shared/settings/interface"
import { useQuery } from "@tanstack/react-query"

import { getAISettings, useAISettingKey } from "~/atoms/settings/ai"
import { ipcServices } from "~/lib/client"

const routeKeyByFeature = {
  chat: "chatProfileId",
  summary: "summaryProfileId",
  translation: "translationProfileId",
  timeline: "timelineProfileId",
  task: "taskProfileId",
  tts: "ttsProfileId",
  mcp: "mcpProfileId",
  onboarding: "onboardingProfileId",
} as const satisfies Record<
  LocalAIFeature,
  keyof ReturnType<typeof getAISettings>["localAI"]["routing"]
>

export const resolveLocalAIProfileId = (
  settings: ReturnType<typeof getAISettings>,
  feature: LocalAIFeature,
) => {
  if (settings.localAI.mode === "folo") return null
  return settings.localAI.routing[routeKeyByFeature[feature]]
}

export const getLocalAIProfileId = (feature: LocalAIFeature) =>
  resolveLocalAIProfileId(getAISettings(), feature)

export const useLocalAIProfileId = (feature: LocalAIFeature) => {
  const localAI = useAISettingKey("localAI")
  if (localAI.mode === "folo") return null
  return localAI.routing[routeKeyByFeature[feature]]
}

export const useLocalAIProfiles = () =>
  useQuery({
    queryKey: ["localAI", "profiles"],
    queryFn: () => ipcServices.localAI.listProfiles(),
  })
```

- [ ] **Step 4: Implement desktop bridge**

Create `apps/desktop/layer/renderer/src/modules/local-ai/bridge.ts`:

```ts
import type { LocalAIBridge } from "@follow/store/local-ai/types"

import { getLocalAIProfileId } from "./hooks"
import { ipcServices } from "~/lib/client"

export const createDesktopLocalAIBridge = (): LocalAIBridge => ({
  isFeatureEnabled(feature) {
    return !!getLocalAIProfileId(feature)
  },

  async summarizeEntry(input) {
    const profileId = getLocalAIProfileId("summary")
    if (!profileId) return null

    const profiles = await ipcServices.localAI.listProfiles()
    const profile = profiles.find((item) => item.id === profileId)
    const model = profile?.defaultSummaryModel ?? profile?.defaultChatModel
    if (!profile || !model) return null

    const result = await ipcServices.localAI.completeText({
      profileId,
      model,
      messages: [
        {
          role: "system",
          content: "You summarize RSS entries. Return only the summary text.",
        },
        {
          role: "user",
          content: `Language: ${input.language}\nTitle: ${input.title}\n\nContent:\n${input.content}`,
        },
      ],
    })

    return result.text.trim() || null
  },

  async translateEntries(input) {
    const profileId = getLocalAIProfileId("translation")
    if (!profileId) return {}

    const profiles = await ipcServices.localAI.listProfiles()
    const profile = profiles.find((item) => item.id === profileId)
    const model = profile?.defaultTranslationModel ?? profile?.defaultChatModel
    if (!profile || !model) return {}

    const result = await ipcServices.localAI.completeText({
      profileId,
      model,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content:
            'Translate RSS entry fields. Return strict JSON: {"items":[{"entryId":"...","title":null,"description":null,"content":null,"readabilityContent":null}]}',
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
    })

    const parsed = JSON.parse(result.text) as {
      items?: Array<{
        entryId: string
        title: string | null
        description: string | null
        content: string | null
        readabilityContent: string | null
      }>
    }

    return Object.fromEntries((parsed.items ?? []).map((item) => [item.entryId, item]))
  },
})
```

- [ ] **Step 5: Provide bridge during desktop initialization**

Modify `apps/desktop/layer/renderer/src/initialize/index.ts`:

```ts
import { localAIContext } from "@follow/store/context"
import { createDesktopLocalAIBridge } from "~/modules/local-ai/bridge"
```

After `initializeSettings`:

```ts
localAIContext.provide(createDesktopLocalAIBridge())
```

- [ ] **Step 6: Add API management UI**

Create UI components under `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/`.

`APIManagementSection.tsx` should:

```tsx
import { Button } from "@follow/components/ui/button/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { getAISettings, setAISetting, useAISettingValue } from "~/atoms/settings/ai"
import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { ipcServices } from "~/lib/client"
import { useLocalAIProfiles } from "~/modules/local-ai/hooks"

import { APIProfileItem } from "./APIProfileItem"
import { APIProfileModalContent } from "./APIProfileModalContent"

export const APIManagementSection = () => {
  const { t } = useTranslation("ai")
  const { present } = useModalStack()
  const queryClient = useQueryClient()
  const aiSettings = useAISettingValue()
  const { data: profiles = [] } = useLocalAIProfiles()

  const setMode = (mode: typeof aiSettings.localAI.mode) => {
    setAISetting("localAI", {
      ...getAISettings().localAI,
      mode,
    })
  }

  const refreshProfiles = () => queryClient.invalidateQueries({ queryKey: ["localAI", "profiles"] })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-text">{t("api_management.mode.title")}</Label>
        <div className="flex gap-2">
          {(["folo", "custom-first", "custom-only"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={aiSettings.localAI.mode === mode ? "primary" : "outline"}
              onClick={() => setMode(mode)}
            >
              {t(`api_management.mode.${mode}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-text">
          {t("api_management.profiles.title")}
        </Label>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            present({
              title: t("api_management.profiles.add_title"),
              content: ({ dismiss }) => (
                <APIProfileModalContent
                  profile={null}
                  onCancel={dismiss}
                  onSave={async (input) => {
                    await ipcServices.localAI.upsertProfile(input)
                    await refreshProfiles()
                    toast.success(t("api_management.profiles.saved"))
                    dismiss()
                  }}
                />
              ),
            })
          }
        >
          <i className="i-mgc-add-cute-re mr-2 size-4" />
          {t("api_management.profiles.add")}
        </Button>
      </div>

      <div className="space-y-3">
        {profiles.map((profile) => (
          <APIProfileItem key={profile.id} profile={profile} onChanged={refreshProfiles} />
        ))}
      </div>
    </div>
  )
}
```

Keep `APIProfileModalContent.tsx` focused on form state. It must include fields for name, base URL, API key, models, default models, and capability switches.

- [ ] **Step 7: Replace BYOK section in AI settings**

Modify `apps/desktop/layer/renderer/src/modules/settings/tabs/ai.tsx`:

```ts
import { APIManagementSection, FeatureRoutingSection, LocalUsageSection } from "./ai/api-management"
```

Replace the `ByokSection` item with:

```ts
          {
            type: "title",
            value: t("api_management.title"),
          },
          APIManagementSection,
          FeatureRoutingSection,
          LocalUsageSection,
```

Keep old BYOK files for migration until the new UI is stable.

- [ ] **Step 8: Add locale keys**

Add these keys to `locales/ai/en.json`, and equivalent values to `zh-CN.json` and `ja.json`:

```json
"api_management.title": "AI API Management",
"api_management.mode.title": "AI mode",
"api_management.mode.folo": "Use Folo AI",
"api_management.mode.custom-first": "Custom API first",
"api_management.mode.custom-only": "Custom API only",
"api_management.profiles.title": "API profiles",
"api_management.profiles.add": "Add API",
"api_management.profiles.add_title": "Add AI API profile",
"api_management.profiles.edit_title": "Edit AI API profile",
"api_management.profiles.saved": "AI API profile saved",
"api_management.profiles.deleted": "AI API profile deleted",
"api_management.profiles.test": "Test",
"api_management.profiles.test_success": "Connection test passed",
"api_management.profiles.test_failed": "Connection test failed",
"api_management.routing.title": "Feature routing",
"api_management.usage.title": "Local usage"
```

- [ ] **Step 9: Run tests and typecheck**

Run:

```bash
pnpm --filter @follow/web test -- src/modules/local-ai/hooks.test.ts
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/layer/renderer/src/modules/local-ai apps/desktop/layer/renderer/src/modules/settings/tabs/ai.tsx apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management apps/desktop/layer/renderer/src/initialize/index.ts locales/ai/en.json locales/ai/zh-CN.json locales/ai/ja.json
git commit -m "feat: add ai api management settings"
```

## Task 6: Local Chat Transport, Model Configuration, Ask AI, And Shortcuts

**Files:**

- Create: `apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-chat/store/transport.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useAIConfiguration.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useAIModel.ts`
- Test: `apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.test.ts`

- [ ] **Step 1: Write local chat stream tests**

Create `apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createLocalAIMessageStream } from "./chat-transport"

describe("local AI chat transport", () => {
  it("converts IPC stream events to UI message chunks", async () => {
    const listeners = new Map<string, (event: unknown, payload: unknown) => void>()
    const ipcRenderer = {
      on: vi.fn((name: string, listener: (event: unknown, payload: unknown) => void) => {
        listeners.set(name, listener)
      }),
      removeListener: vi.fn(),
    }

    const stream = createLocalAIMessageStream({
      streamId: "stream-1",
      ipcRenderer,
      abortSignal: undefined,
    })

    listeners.get("local-ai:chat-delta")?.({}, { streamId: "stream-1", delta: "Hi" })
    listeners.get("local-ai:chat-finish")?.({}, { streamId: "stream-1" })

    const reader = stream.getReader()
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ])
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @follow/web test -- src/modules/local-ai/chat-transport.test.ts
```

Expected: FAIL because `chat-transport.ts` does not exist.

- [ ] **Step 3: Implement local chat transport stream adapter**

Create `apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.ts`:

```ts
import type { IpcRenderer } from "electron"
import type { ChatTransport, UIMessageChunk } from "ai"

import { getAISettings } from "~/atoms/settings/ai"
import { ipcServices } from "~/lib/client"
import type { BizUIMessage } from "~/modules/ai-chat/store/types"

import { getLocalAIProfileId } from "./hooks"

interface StreamInput {
  streamId: string
  ipcRenderer: Pick<IpcRenderer, "on" | "removeListener">
  abortSignal: AbortSignal | undefined
}

const textId = "text-1"

export const createLocalAIMessageStream = ({
  streamId,
  ipcRenderer,
  abortSignal,
}: StreamInput): ReadableStream<UIMessageChunk> =>
  new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "start" })
      controller.enqueue({ type: "start-step" })
      controller.enqueue({ type: "text-start", id: textId })

      const cleanup = () => {
        ipcRenderer.removeListener("local-ai:chat-delta", onDelta)
        ipcRenderer.removeListener("local-ai:chat-error", onError)
        ipcRenderer.removeListener("local-ai:chat-finish", onFinish)
      }

      const onDelta = (_event: unknown, payload: unknown) => {
        const data = payload as { streamId?: string; delta?: string }
        if (data.streamId !== streamId || !data.delta) return
        controller.enqueue({ type: "text-delta", id: textId, delta: data.delta })
      }

      const onError = (_event: unknown, payload: unknown) => {
        const data = payload as { streamId?: string; message?: string }
        if (data.streamId !== streamId) return
        controller.enqueue({ type: "error", errorText: data.message ?? "Local AI stream failed" })
        cleanup()
        controller.close()
      }

      const onFinish = (_event: unknown, payload: unknown) => {
        const data = payload as { streamId?: string }
        if (data.streamId !== streamId) return
        controller.enqueue({ type: "text-end", id: textId })
        controller.enqueue({ type: "finish-step" })
        controller.enqueue({ type: "finish" })
        cleanup()
        controller.close()
      }

      ipcRenderer.on("local-ai:chat-delta", onDelta)
      ipcRenderer.on("local-ai:chat-error", onError)
      ipcRenderer.on("local-ai:chat-finish", onFinish)
      abortSignal?.addEventListener("abort", cleanup, { once: true })
    },
  })

const messageText = (message: BizUIMessage) =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n")

export const createLocalAIChatTransport = (): ChatTransport<BizUIMessage> => ({
  async sendMessages({ messages, abortSignal }) {
    const profileId = getLocalAIProfileId("chat")
    if (!profileId) throw new Error("Local AI chat profile is not configured")

    const profiles = await ipcServices.localAI.listProfiles()
    const profile = profiles.find((item) => item.id === profileId)
    const model = profile?.defaultChatModel
    if (!profile || !model) throw new Error("Local AI chat model is not configured")

    const { streamId } = await ipcServices.localAI.startChatStream({
      profileId,
      model,
      messages: [
        {
          role: "system",
          content:
            getAISettings().personalizePrompt || "You are Folo AI, an RSS reading assistant.",
        },
        ...messages.map((message) => ({
          role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: messageText(message),
        })),
      ],
    })

    if (!window.electron?.ipcRenderer) {
      throw new Error("Electron IPC is not available")
    }

    return createLocalAIMessageStream({
      streamId,
      ipcRenderer: window.electron.ipcRenderer,
      abortSignal,
    })
  },

  async reconnectToStream() {
    return null
  },
})
```

- [ ] **Step 4: Select local transport when configured**

Modify `apps/desktop/layer/renderer/src/modules/ai-chat/store/transport.ts`:

```ts
import { getLocalAIProfileId } from "~/modules/local-ai/hooks"
import { createLocalAIChatTransport } from "~/modules/local-ai/chat-transport"
```

At the top of `createChatTransport`:

```ts
if (getLocalAIProfileId("chat")) {
  return createLocalAIChatTransport()
}
```

- [ ] **Step 5: Merge local model configuration**

Modify `apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useAIConfiguration.ts` so it returns local config when `localAI.mode !== "folo"` and local profiles exist:

```ts
const localModels = profiles.flatMap((profile) => profile.models)
return {
  defaultModel: localModels[0] ?? null,
  availableModels: localModels,
  availableModelsMenu: profiles.map((profile) => ({
    label: profile.name,
    models: profile.models.map((model) => ({ id: model, label: model })),
  })),
  usage: localUsage,
  rateLimit: null,
}
```

Keep the existing `followApi.ai.config()` path when local mode is `folo` or fallback is needed.

- [ ] **Step 6: Run chat transport tests and typecheck**

Run:

```bash
pnpm --filter @follow/web test -- src/modules/local-ai/chat-transport.test.ts
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Manual smoke test chat**

Run:

```bash
cd apps/desktop
pnpm run dev:electron
```

Expected:

- Add a local API profile.
- Select custom API first.
- Open AI Chat.
- Send `hello`.
- The assistant streams a response through the local provider.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.ts apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.test.ts apps/desktop/layer/renderer/src/modules/ai-chat/store/transport.ts apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useAIConfiguration.ts apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useAIModel.ts
git commit -m "feat: route ai chat through local providers"
```

## Task 7: Local Summary And Translation Routing

**Files:**

- Modify: `packages/internal/store/src/modules/summary/store.ts`
- Modify: `packages/internal/store/src/modules/summary/store.test.ts`
- Modify: `packages/internal/store/src/modules/translation/store.ts`
- Test: `packages/internal/store/src/modules/translation/store.local-ai.test.ts`

- [ ] **Step 1: Add summary local AI test**

Extend `packages/internal/store/src/modules/summary/store.test.ts` with:

```ts
import { localAIContext } from "../../context"
```

Add a test:

```ts
it("uses local AI summary when the bridge enables summary", async () => {
  localAIContext.provide({
    isFeatureEnabled: (feature) => feature === "summary",
    summarizeEntry: async () => "local summary",
    translateEntries: async () => ({}),
  })

  const result = await summarySyncService.generateSummary({
    entryId: "entry-1",
    target: "content",
    actionLanguage: "en",
  })

  expect(result).toBe("local summary")
})
```

The existing test setup must create `entry-1` before calling the service.

- [ ] **Step 2: Add translation local AI test**

Create `packages/internal/store/src/modules/translation/store.local-ai.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { localAIContext } from "../../context"
import { translationSyncService } from "./store"

describe("local AI translation", () => {
  it("uses local AI bridge even for free users", async () => {
    localAIContext.provide({
      isFeatureEnabled: (feature) => feature === "translation",
      summarizeEntry: async () => null,
      translateEntries: async () => ({
        "entry-1": {
          entryId: "entry-1",
          title: "Translated title",
          description: null,
          content: null,
          readabilityContent: null,
        },
      }),
    })

    const result = await translationSyncService.generateTranslation({
      entryId: "entry-1",
      language: "en",
      target: "content",
    })

    expect(result?.title).toBe("Translated title")
  })
})
```

Add the same entry/user store setup used by existing translation tests before the call.

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm --filter @follow/store test -- src/modules/summary/store.test.ts src/modules/translation/store.local-ai.test.ts
```

Expected: FAIL because summary and translation still use only Folo API paths.

- [ ] **Step 4: Route summary to local AI**

Modify `packages/internal/store/src/modules/summary/store.ts`:

```ts
import { localAI } from "../../context"
```

Before the existing `api().ai.summary(...)` call:

```ts
const bridge = localAI()
if (bridge?.isFeatureEnabled("summary")) {
  const localSummary = await bridge.summarizeEntry({
    entryId,
    title: entry.title ?? "",
    content:
      target === "content"
        ? (entry.content ?? entry.description ?? "")
        : (entry.readabilityContent ?? entry.content ?? entry.description ?? ""),
    target,
    language: actionLanguage,
  })

  if (localSummary) {
    immerSet((state) => {
      if (!state.data[entryId]) state.data[entryId] = {}
      state.data[entryId][actionLanguage] = {
        summary:
          target === "content"
            ? localSummary
            : state.data[entryId]?.[actionLanguage]?.summary || "",
        readabilitySummary:
          target === "readabilityContent"
            ? localSummary
            : state.data[entryId]?.[actionLanguage]?.readabilitySummary || null,
        lastAccessed: Date.now(),
      }
      state.generatingStatus[statusID] = SummaryGeneratingStatus.Success
    })
    return localSummary
  }
}
```

- [ ] **Step 5: Route translation to local AI**

Modify `packages/internal/store/src/modules/translation/store.ts`:

```ts
import { localAI } from "../../context"
```

In `generateTranslation`, before the free-role return:

```ts
const bridge = localAI()
const localTranslationEnabled = bridge?.isFeatureEnabled("translation") ?? false

if (userRole === UserRole.Free && !localTranslationEnabled) return null
```

In the batcher request section, before `api().ai.translationBatch(request)`:

```ts
const bridge = localAI()
if (bridge?.isFeatureEnabled("translation")) {
  const items = group.ids
    .map((id) => getEntry(id))
    .filter((entry): entry is NonNullable<ReturnType<typeof getEntry>> => !!entry)
    .map((entry) => ({
      entryId: entry.id,
      title: entry.title,
      description: entry.description,
      content: entry.content,
      readabilityContent: entry.readabilityContent,
    }))

  const localResults = await bridge.translateEntries({
    items,
    language: group.language,
    fields: group.fields,
    mode: group.mode,
  })

  for (const id of group.ids) {
    const key = group.keyById[id]
    if (!key) continue
    results[key] = localResults[id] ?? null
    if (localResults[id]) {
      await translationActions.upsertMany([localResults[id]])
    }
  }
  continue
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
pnpm --filter @follow/store test -- src/modules/summary/store.test.ts src/modules/translation/store.local-ai.test.ts
pnpm --filter @follow/store typecheck
```

Expected: PASS.

- [ ] **Step 7: Manual smoke test summary and translation**

Run:

```bash
cd apps/desktop
pnpm run dev:electron
```

Expected:

- Open one article.
- Generate AI summary.
- Enable translation and open article text.
- Summary and translation use the configured local API.

- [ ] **Step 8: Commit**

```bash
git add packages/internal/store/src/modules/summary/store.ts packages/internal/store/src/modules/summary/store.test.ts packages/internal/store/src/modules/translation/store.ts packages/internal/store/src/modules/translation/store.local-ai.test.ts
git commit -m "feat: route summary and translation through local ai"
```

## Task 8: Timeline Summary, Timeline Ranking, And Onboarding Recommendations

**Files:**

- Create: `apps/desktop/layer/renderer/src/modules/local-ai/timeline-ranking.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/entry-column/hooks/useEntriesByView.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useSendAIShortcut.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-onboarding/ai-chat-pane.tsx`
- Test: `apps/desktop/layer/renderer/src/modules/local-ai/timeline-ranking.test.ts`

- [ ] **Step 1: Write timeline ranking parser tests**

Create `apps/desktop/layer/renderer/src/modules/local-ai/timeline-ranking.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { parseTimelineRanking } from "./timeline-ranking"

describe("timeline ranking", () => {
  it("parses strict ranking JSON", () => {
    expect(
      parseTimelineRanking(
        JSON.stringify({
          entries: [
            { id: "b", score: 0.9, reason: "important" },
            { id: "a", score: 0.2, reason: "less relevant" },
          ],
        }),
      ),
    ).toEqual([
      { id: "b", score: 0.9 },
      { id: "a", score: 0.2 },
    ])
  })

  it("returns null for malformed JSON", () => {
    expect(parseTimelineRanking("not json")).toBeNull()
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @follow/web test -- src/modules/local-ai/timeline-ranking.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement ranking helper**

Create `apps/desktop/layer/renderer/src/modules/local-ai/timeline-ranking.ts`:

```ts
import type { EntryModel } from "@follow/store/entry/types"

import { ipcServices } from "~/lib/client"

import { getLocalAIProfileId } from "./hooks"

export const parseTimelineRanking = (
  value: string,
): Array<{ id: string; score: number }> | null => {
  try {
    const parsed = JSON.parse(value) as { entries?: Array<{ id?: unknown; score?: unknown }> }
    const entries = (parsed.entries ?? [])
      .filter(
        (item): item is { id: string; score: number } =>
          typeof item.id === "string" && typeof item.score === "number",
      )
      .sort((a, b) => b.score - a.score)
      .map(({ id, score }) => ({ id, score }))
    return entries.length ? entries : null
  } catch {
    return null
  }
}

export const rankTimelineEntriesWithLocalAI = async (entries: EntryModel[]) => {
  const profileId = getLocalAIProfileId("timeline")
  if (!profileId) return null

  const profiles = await ipcServices.localAI.listProfiles()
  const profile = profiles.find((item) => item.id === profileId)
  const model = profile?.defaultTimelineModel ?? profile?.defaultChatModel
  if (!profile || !model) return null

  const candidates = entries.slice(0, 50).map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    publishedAt: entry.publishedAt,
  }))

  const result = await ipcServices.localAI.completeText({
    profileId,
    model,
    responseFormat: "json_object",
    messages: [
      {
        role: "system",
        content:
          'Rank RSS entries by importance for a reader. Return strict JSON: {"entries":[{"id":"entry-id","score":0.0,"reason":"short"}]}',
      },
      {
        role: "user",
        content: JSON.stringify({ entries: candidates }),
      },
    ],
  })

  return parseTimelineRanking(result.text)
}
```

- [ ] **Step 4: Integrate local ranking into timeline hook**

Modify `apps/desktop/layer/renderer/src/modules/entry-column/hooks/useEntriesByView.ts`:

- Keep existing Folo `aiSort` behavior when no local timeline profile is selected.
- When `getLocalAIProfileId("timeline")` returns a profile, fetch entries normally without remote `aiSort`, then call `rankTimelineEntriesWithLocalAI(entries)`.
- If ranking returns scores, order entries by returned id order.
- If ranking fails, keep existing order.

The integration shape:

```ts
const localTimelineProfileId = useLocalAIProfileId("timeline")
const shouldUseRemoteAISort = aiTimelineEnabled && aiEnabled && !localTimelineProfileId
```

Use `shouldUseRemoteAISort` where `aiSort: true` is currently added.

- [ ] **Step 5: Route timeline summary and shortcuts through local chat**

Because Task 6 routes AI chat transport locally, timeline summary and shortcuts that call `sendAIShortcut` should already use the local chat profile. Modify `useSendAIShortcut.ts` only to avoid `ensureLogin()` when a matching local profile exists:

```ts
const localChatProfileId = getLocalAIProfileId("chat")
if (!localChatProfileId && shortcutId !== DEFAULT_SUMMARIZE_TIMELINE_SHORTCUT_ID) {
  await ensureLogin()
}
```

- [ ] **Step 6: Replace onboarding AI dependency**

Modify `apps/desktop/layer/renderer/src/modules/ai-onboarding/ai-chat-pane.tsx`:

- If `getLocalAIProfileId("onboarding")` is configured, call `ipcServices.localAI.completeText` with a JSON prompt that returns feed search terms.
- Use those terms to filter existing discover sources.
- Keep existing Folo onboarding path when local onboarding is not configured.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
pnpm --filter @follow/web test -- src/modules/local-ai/timeline-ranking.test.ts
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Manual smoke test timeline**

Run:

```bash
cd apps/desktop
pnpm run dev:electron
```

Expected:

- Enable AI timeline.
- Local model ranks visible entries.
- Disable local timeline profile.
- Existing Folo behavior remains available when fallback allows it.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/layer/renderer/src/modules/local-ai/timeline-ranking.ts apps/desktop/layer/renderer/src/modules/local-ai/timeline-ranking.test.ts apps/desktop/layer/renderer/src/modules/entry-column/hooks/useEntriesByView.ts apps/desktop/layer/renderer/src/modules/ai-chat/hooks/useSendAIShortcut.ts apps/desktop/layer/renderer/src/modules/ai-onboarding/ai-chat-pane.tsx
git commit -m "feat: add local ai timeline features"
```

## Task 9: Local AI Tasks

**Files:**

- Create: `apps/desktop/layer/main/src/lib/local-ai/tasks-store.ts`
- Modify: `apps/desktop/layer/main/src/ipc/services/local-ai.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-task/query.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-task/types.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-task/components/notify-channels-config.tsx`
- Test: `apps/desktop/layer/main/src/lib/local-ai/tasks-store.test.ts`

- [ ] **Step 1: Write local task schedule tests**

Create `apps/desktop/layer/main/src/lib/local-ai/tasks-store.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { computeNextLocalAITaskRunAt } from "./tasks-store"

describe("local AI task schedule", () => {
  it("computes next daily run", () => {
    const next = computeNextLocalAITaskRunAt(
      { type: "daily", timeOfDay: "2026-06-14T09:00:00.000Z" },
      new Date("2026-06-14T08:00:00.000Z"),
    )

    expect(next?.toISOString()).toBe("2026-06-14T09:00:00.000Z")
  })

  it("moves daily run to tomorrow after today's time passed", () => {
    const next = computeNextLocalAITaskRunAt(
      { type: "daily", timeOfDay: "2026-06-14T09:00:00.000Z" },
      new Date("2026-06-14T10:00:00.000Z"),
    )

    expect(next?.toISOString()).toBe("2026-06-15T09:00:00.000Z")
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/tasks-store.test.ts
```

Expected: FAIL because the local task store is missing.

- [ ] **Step 3: Implement task store and scheduler**

Create `apps/desktop/layer/main/src/lib/local-ai/tasks-store.ts`:

```ts
import { nanoid } from "nanoid"

import { store } from "~/lib/store"

export type LocalAITaskSchedule =
  | { type: "once"; date: string }
  | { type: "daily"; timeOfDay: string }
  | { type: "weekly"; dayOfWeek: number; timeOfDay: string }
  | { type: "monthly"; dayOfMonth: number; timeOfDay: string }

export interface LocalAITask {
  id: string
  name: string
  prompt: string
  isEnabled: boolean
  schedule: LocalAITaskSchedule
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  nextRunAt: string | null
  runCount: number
  lastResult: string | null
  lastError: string | null
}

const TASKS_KEY = "localAITasks"

const setTimeFromTemplate = (date: Date, template: string) => {
  const time = new Date(template)
  date.setUTCHours(time.getUTCHours(), time.getUTCMinutes(), 0, 0)
  return date
}

export const computeNextLocalAITaskRunAt = (
  schedule: LocalAITaskSchedule,
  now = new Date(),
): Date | null => {
  if (schedule.type === "once") {
    const date = new Date(schedule.date)
    return date > now ? date : null
  }

  const next = setTimeFromTemplate(new Date(now), schedule.timeOfDay)
  if (schedule.type === "daily") {
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }

  if (schedule.type === "weekly") {
    const diff = (schedule.dayOfWeek - next.getUTCDay() + 7) % 7
    next.setUTCDate(next.getUTCDate() + diff)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7)
    return next
  }

  next.setUTCDate(Math.min(schedule.dayOfMonth, 28))
  if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

export const listLocalAITasks = (): LocalAITask[] => store.get(TASKS_KEY) ?? []

export const saveLocalAITask = (
  input: Omit<
    LocalAITask,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "lastRunAt"
    | "nextRunAt"
    | "runCount"
    | "lastResult"
    | "lastError"
  > & { id?: string },
) => {
  const tasks = listLocalAITasks()
  const existing = input.id ? tasks.find((task) => task.id === input.id) : undefined
  const timestamp = new Date().toISOString()
  const task: LocalAITask = {
    id: existing?.id ?? input.id ?? nanoid(),
    name: input.name,
    prompt: input.prompt,
    isEnabled: input.isEnabled,
    schedule: input.schedule,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastRunAt: existing?.lastRunAt ?? null,
    nextRunAt: computeNextLocalAITaskRunAt(input.schedule)?.toISOString() ?? null,
    runCount: existing?.runCount ?? 0,
    lastResult: existing?.lastResult ?? null,
    lastError: existing?.lastError ?? null,
  }

  store.set(
    TASKS_KEY,
    existing ? tasks.map((item) => (item.id === task.id ? task : item)) : [...tasks, task],
  )
  return task
}
```

Add `localAITasks?: LocalAITask[] | null` to `StoreData`.

- [ ] **Step 4: Add task IPC methods**

Extend `LocalAIService` with:

```ts
  @IpcMethod()
  listTasks(_context: IpcContext) {
    return listLocalAITasks()
  }

  @IpcMethod()
  saveTask(_context: IpcContext, input: Parameters<typeof saveLocalAITask>[0]) {
    return saveLocalAITask(input)
  }

  @IpcMethod()
  async runTask(_context: IpcContext, input: { taskId: string; profileId: string; model: string }) {
    const task = listLocalAITasks().find((item) => item.id === input.taskId)
    if (!task) throw new Error("Local AI task not found")
    return this.completeText(_context, {
      profileId: input.profileId,
      model: input.model,
      messages: [{ role: "user", content: task.prompt }],
    })
  }
```

Import task helpers at the top of `local-ai.ts`.

- [ ] **Step 5: Route AI task hooks to local tasks**

Modify `apps/desktop/layer/renderer/src/modules/ai-task/query.ts`:

- Use `useLocalAIProfileId("task")`.
- If a task profile exists, `useAITaskListQuery` reads `ipcServices.localAI.listTasks()`.
- Create/update/delete/test-run mutations call local IPC methods.
- Keep existing `followApi.aiTask` path when no local task profile exists.

- [ ] **Step 6: Update task notification UI copy**

Modify `notify-channels-config.tsx` so local mode shows desktop notification text instead of email-only wording.

- [ ] **Step 7: Run tests and typechecks**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/tasks-store.test.ts
pnpm --filter @follow/electron-main typecheck
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Manual smoke test local task**

Run:

```bash
cd apps/desktop
pnpm run dev:electron
```

Expected:

- Create AI task.
- Run it manually.
- Result appears in task UI.
- UI states that scheduled local tasks only run while Folo desktop is open.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/layer/main/src/lib/local-ai/tasks-store.ts apps/desktop/layer/main/src/lib/local-ai/tasks-store.test.ts apps/desktop/layer/main/src/ipc/services/local-ai.ts apps/desktop/layer/main/src/lib/store.ts apps/desktop/layer/renderer/src/modules/ai-task/query.ts apps/desktop/layer/renderer/src/modules/ai-task/types.ts apps/desktop/layer/renderer/src/modules/ai-task/components/notify-channels-config.tsx
git commit -m "feat: add local ai tasks"
```

## Task 10: OpenAI-Compatible TTS

**Files:**

- Modify: `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts`
- Modify: `apps/desktop/layer/main/src/ipc/services/local-ai.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/player/tts-service.ts`
- Test: `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.test.ts`
- Test: `apps/desktop/layer/renderer/src/modules/player/entry-tts.test.ts`

- [ ] **Step 1: Add speech request test**

Extend `openai-compatible.test.ts`:

```ts
import { synthesizeOpenAICompatibleSpeech } from "./openai-compatible"

it("synthesizes speech through audio speech endpoint", async () => {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))

  const result = await synthesizeOpenAICompatibleSpeech({
    profile: { ...profile, supportsTts: true, defaultTtsModel: "tts-1" },
    apiKey: "sk-test",
    model: "tts-1",
    voice: "alloy",
    text: "Hello",
    fetchFn: fetchMock,
  })

  expect(result.byteLength).toBe(3)
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.com/v1/audio/speech",
    expect.objectContaining({
      method: "POST",
    }),
  )
})
```

- [ ] **Step 2: Implement speech client**

Add to `openai-compatible.ts`:

```ts
export const synthesizeOpenAICompatibleSpeech = async ({
  profile,
  apiKey,
  model,
  voice,
  text,
  fetchFn = fetch,
}: ClientInput & {
  model: string
  voice: string
  text: string
}): Promise<ArrayBuffer> => {
  const response = await fetchFn(endpoint(profile, "/audio/speech"), {
    method: "POST",
    headers: jsonHeaders(profile, apiKey),
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: "mp3",
    }),
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return response.arrayBuffer()
}
```

- [ ] **Step 3: Add TTS IPC method**

Extend `LocalAIService`:

```ts
  @IpcMethod()
  async synthesizeSpeech(
    _context: IpcContext,
    input: { profileId: string; model: string; voice: string; text: string },
  ) {
    const profile = findProfile(input.profileId)
    const buffer = await synthesizeOpenAICompatibleSpeech({
      profile,
      apiKey: readSecret(input.profileId),
      model: input.model,
      voice: input.voice,
      text: input.text,
    })
    return Array.from(new Uint8Array(buffer))
  }
```

- [ ] **Step 4: Route renderer TTS**

Modify `apps/desktop/layer/renderer/src/modules/player/tts-service.ts`:

```ts
import { ipcServices } from "~/lib/client"
import { getLocalAIProfileId } from "~/modules/local-ai/hooks"
```

At the start of `requestTts` after text normalization:

```ts
const profileId = getLocalAIProfileId("tts")
if (profileId) {
  const profiles = await ipcServices.localAI.listProfiles()
  const profile = profiles.find((item) => item.id === profileId)
  const model = profile?.defaultTtsModel
  if (!profile || !model) {
    throw new Error("Local AI TTS model is not configured")
  }

  const bytes = await ipcServices.localAI.synthesizeSpeech({
    profileId,
    model,
    voice: normalizedVoice || "alloy",
    text: normalizedText,
  })

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "audio/mpeg",
    },
  })
}
```

Keep the existing `tts.folo.is` path as fallback.

- [ ] **Step 5: Run tests and typechecks**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/openai-compatible.test.ts
pnpm --filter @follow/web test -- src/modules/player/entry-tts.test.ts
pnpm --filter @follow/electron-main typecheck
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Manual smoke test TTS**

Run:

```bash
cd apps/desktop
pnpm run dev:electron
```

Expected:

- Configure a profile with `supportsTts`.
- Set default TTS model.
- Play article TTS.
- Audio is generated through local profile.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts apps/desktop/layer/main/src/lib/local-ai/openai-compatible.test.ts apps/desktop/layer/main/src/ipc/services/local-ai.ts apps/desktop/layer/renderer/src/modules/player/tts-service.ts apps/desktop/layer/renderer/src/modules/player/entry-tts.test.ts
git commit -m "feat: add local ai text to speech"
```

## Task 11: Local MCP Management And Tool Exposure

**Files:**

- Create: `apps/desktop/layer/main/src/lib/local-ai/mcp-client.ts`
- Modify: `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts`
- Modify: `apps/desktop/layer/main/src/ipc/services/local-ai.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/mcp/MCPServicesSection.tsx`
- Modify: `apps/desktop/layer/renderer/src/modules/ai-chat/store/chat-core/chat-actions.ts`
- Test: `apps/desktop/layer/main/src/lib/local-ai/mcp-client.test.ts`

- [ ] **Step 1: Write MCP discovery test**

Create `apps/desktop/layer/main/src/lib/local-ai/mcp-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { callLocalMCPTool, listLocalMCPTools } from "./mcp-client"

describe("local MCP client", () => {
  it("lists tools through JSON-RPC", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            result: {
              tools: [
                { name: "search", description: "Search docs", inputSchema: { type: "object" } },
              ],
            },
          }),
        ),
    )

    await expect(
      listLocalMCPTools({
        url: "https://mcp.example.com",
        headers: {},
        fetchFn: fetchMock,
      }),
    ).resolves.toEqual([
      {
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object" },
      },
    ])
  })

  it("calls a tool through JSON-RPC", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            result: {
              content: [{ type: "text", text: "tool result" }],
            },
          }),
        ),
    )

    await expect(
      callLocalMCPTool({
        url: "https://mcp.example.com",
        headers: {},
        name: "search",
        arguments: { q: "folo" },
        fetchFn: fetchMock,
      }),
    ).resolves.toEqual({
      content: [{ type: "text", text: "tool result" }],
    })
  })
})
```

- [ ] **Step 2: Implement local MCP client**

Create `apps/desktop/layer/main/src/lib/local-ai/mcp-client.ts`:

```ts
export interface LocalMCPTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface LocalMCPToolCallResult {
  content: Array<{ type: string; text?: string }>
}

export const listLocalMCPTools = async ({
  url,
  headers,
  fetchFn = fetch,
}: {
  url: string
  headers: Record<string, string>
  fetchFn?: typeof fetch
}): Promise<LocalMCPTool[]> => {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "tools/list",
      params: {},
    }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const data = (await response.json()) as {
    result?: { tools?: LocalMCPTool[] }
  }
  return data.result?.tools ?? []
}

export const callLocalMCPTool = async ({
  url,
  headers,
  name,
  arguments: toolArguments,
  fetchFn = fetch,
}: {
  url: string
  headers: Record<string, string>
  name: string
  arguments: Record<string, unknown>
  fetchFn?: typeof fetch
}): Promise<LocalMCPToolCallResult> => {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "tools/call",
      params: {
        name,
        arguments: toolArguments,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const data = (await response.json()) as {
    result?: LocalMCPToolCallResult
  }
  return data.result ?? { content: [] }
}
```

- [ ] **Step 3: Add MCP IPC methods**

Extend `LocalAIService`:

```ts
  @IpcMethod()
  async listMCPTools(
    _context: IpcContext,
    input: { url: string; headers: Record<string, string> },
  ) {
    return listLocalMCPTools(input)
  }

  @IpcMethod()
  async callMCPTool(
    _context: IpcContext,
    input: {
      url: string
      headers: Record<string, string>
      name: string
      arguments: Record<string, unknown>
    },
  ) {
    return callLocalMCPTool(input)
  }
```

- [ ] **Step 4: Add one-round MCP tool execution to local chat**

Modify `apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts` so `streamOpenAICompatibleChat` accepts OpenAI-compatible tool definitions and a tool executor:

```ts
export interface LocalAIChatTool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

export interface LocalAIToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}
```

Add optional inputs:

```ts
  tools?: LocalAIChatTool[]
  callTool?: (toolCall: LocalAIToolCall) => Promise<string>
```

When the first non-streaming planning call returns `tool_calls`, execute each call with `callTool`, append tool results to the message list, then start the existing streaming call. The request shape is:

```ts
{
  model,
  messages,
  stream: false,
  tools,
  tool_choice: "auto"
}
```

Append tool results as:

```ts
{
  role: "tool",
  tool_call_id: toolCall.id,
  content: await callTool(toolCall),
}
```

Then stream the final assistant answer with the updated messages.

- [ ] **Step 5: Route MCP settings to local mode**

Modify `MCPServicesSection.tsx`:

- When `useLocalAIProfileId("mcp")` returns a profile, use local MCP IPC methods instead of `followApi.mcp`.
- Keep existing Folo MCP behavior when local MCP is not configured.
- Show copy that OAuth presets remain cloud-backed unless manually configured as local MCP endpoints.

- [ ] **Step 6: Pass local MCP tools into local chat**

Modify the local chat path so it passes discovered MCP tools to `streamOpenAICompatibleChat`:

```ts
const tools = localMCPTools.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
  },
}))
```

Use `ipcServices.localAI.callMCPTool(...)` as the executor. Tool execution is limited to one planning round in this implementation to keep streaming behavior understandable and prevent runaway loops.

- [ ] **Step 7: Run tests and typechecks**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai/mcp-client.test.ts
pnpm --filter @follow/electron-main typecheck
pnpm --filter @follow/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Manual smoke test MCP**

Run:

```bash
cd apps/desktop
pnpm run dev:electron
```

Expected:

- Add a local MCP HTTP endpoint.
- Discover tools.
- Open AI chat.
- Ask the assistant to use a discovered tool.
- The local service calls `tools/call` once and streams a final answer that includes the tool result.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/layer/main/src/lib/local-ai/mcp-client.ts apps/desktop/layer/main/src/lib/local-ai/mcp-client.test.ts apps/desktop/layer/main/src/lib/local-ai/openai-compatible.ts apps/desktop/layer/main/src/ipc/services/local-ai.ts apps/desktop/layer/renderer/src/modules/settings/tabs/ai/mcp/MCPServicesSection.tsx apps/desktop/layer/renderer/src/modules/ai-chat/store/chat-core/chat-actions.ts
git commit -m "feat: add local mcp tools for ai"
```

## Task 12: Migration, Cleanup, And Full Verification

**Files:**

- Modify: `apps/desktop/layer/renderer/src/atoms/settings/ai.ts`
- Modify: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/byok/*`
- Modify: `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/api-management/*`
- Modify: `locales/ai/en.json`
- Modify: `locales/ai/zh-CN.json`
- Modify: `locales/ai/ja.json`
- Test: existing tests touched by previous tasks

- [ ] **Step 1: Add BYOK migration**

Modify `apps/desktop/layer/renderer/src/atoms/settings/ai.ts` so `createDefaultSettings` normalizes old `byok.providers` into `localAI` routing only when local AI has no routing configured.

Migration shape:

```ts
const migrateByokToLocalAI = (settings: WebAISettings): WebAISettings => {
  if (settings.localAI.mode !== "folo") return settings
  if (!settings.byok?.enabled || settings.byok.providers.length === 0) return settings
  return {
    ...settings,
    localAI: {
      ...settings.localAI,
      mode: "custom-first",
      fallbackToFoloAI: true,
    },
  }
}
```

Profile metadata migration into main-process secure storage should be triggered from the API management UI because it needs IPC access.

- [ ] **Step 2: Hide old BYOK UI from the main AI settings path**

Keep old files for compatibility, but remove the old BYOK section from the visible settings list. The visible path is now API Management.

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm --filter @follow/electron-main test -- src/lib/local-ai src/ipc/services/local-ai.test.ts
pnpm --filter @follow/web test -- src/modules/local-ai src/modules/player/entry-tts.test.ts
pnpm --filter @follow/store test -- src/modules/summary/store.test.ts src/modules/translation/store.local-ai.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run required quality gates**

Run from repository root:

```bash
pnpm run typecheck
pnpm run lint:fix
pnpm run test
```

Expected: PASS.

If the full recursive test suite is too slow for the local machine, record the last passing focused commands and the exact full-suite failure or timeout message before handing off.

- [ ] **Step 5: Manual desktop end-to-end smoke test**

Run:

```bash
cd apps/desktop
pnpm run dev:electron
```

Verify:

- API profile can be added, edited, tested, and deleted.
- Chat streams through local API.
- Ask AI and AI shortcuts use local chat.
- Summary uses local API and caches result.
- Translation uses local API for free/local mode.
- Timeline summary uses local chat.
- Timeline ranking sorts current entries locally.
- AI task can be created and manually run locally.
- TTS uses local speech when configured.
- MCP endpoint can list tools.
- Switching mode to `Use Folo AI` restores existing cloud behavior.

- [ ] **Step 6: Commit final cleanup**

```bash
git add apps/desktop/layer/renderer/src/atoms/settings/ai.ts apps/desktop/layer/renderer/src/modules/settings/tabs/ai apps/desktop/layer/renderer/src/modules/local-ai locales/ai/en.json locales/ai/zh-CN.json locales/ai/ja.json
git commit -m "chore: finalize local ai api management"
```

## Completion Criteria

The implementation is complete when:

- Local profiles are stored with masked renderer visibility and encrypted main-process secrets.
- Local chat, shortcuts, summary, translation, timeline ranking, tasks, TTS, and MCP have local-provider paths.
- Existing Folo AI behavior remains available when local mode is disabled.
- Tests in each task pass.
- Root quality gates pass or the exact failing command and output are documented.
