# OpenAI-Compatible AI API Management Design

## Goal

Build a desktop-first AI API management system that lets this local Folo app use user-managed OpenAI-compatible APIs instead of depending on Folo's hosted AI quota for AI features.

The target experience is:

```text
Folo AI feature -> Local AI Router -> User API profile -> OpenAI-compatible provider
```

The first complete version should cover every AI feature that currently exists in the desktop app, while keeping cloud-only features behind explicit local replacements.

## Current State

The project already has an AI settings page and a BYOK section, but the existing implementation still sends most AI work to Folo services:

- AI chat streams through `VITE_API_URL /ai/chat`.
- Article summary calls `api().ai.summary(...)`.
- Translation calls `api().ai.translationBatch(...)`.
- AI model configuration and usage analytics come from `followApi.ai.config()` and `followApi.aiAnalytics`.
- AI tasks are managed by `followApi.aiTask`.
- MCP connections are managed by `followApi.mcp`.
- TTS uses `https://tts.folo.is`.

The current BYOK settings store provider, base URL, API key, and headers, but they are not yet the central routing layer for all AI features.

## Design Principles

1. **Local-first AI control**
   The desktop app should be able to run AI features with the user's own API configuration. Login may still exist for normal Folo account features, but local AI should not require Folo AI quota.

2. **One AI route, many features**
   Chat, summary, translation, timeline summary, timeline sorting, AI shortcuts, onboarding recommendations, TTS, tasks, and MCP should all resolve their provider through one local AI router.

3. **Provider compatibility first**
   The first implementation supports OpenAI-compatible APIs. This includes OpenAI, DeepSeek, OpenRouter, SiliconFlow, One API, New API, LiteLLM, Ollama OpenAI-compatible mode, and similar services.

4. **Do not expose API keys to renderer code**
   Renderer UI can display masked keys and edit metadata, but real API requests and decrypted keys should live in Electron main process services.

5. **Fallback remains explicit**
   If no local provider is configured, the app may fall back to the existing Folo AI services. Once a local provider is enabled for a feature, the app should use it first and avoid accidental cloud usage.

6. **Desktop first**
   This design targets `apps/desktop`. Mobile and web can keep using existing Folo AI paths until separate platform work is planned.

## API Profile Model

Add a new local AI profile concept. This replaces the narrow BYOK shape with a fuller API management model.

Each API profile contains:

- `id`: stable local id.
- `name`: user-visible name, such as `DeepSeek` or `Local Ollama`.
- `providerType`: OpenAI-compatible provider family.
- `baseURL`: API base URL, such as `https://api.openai.com/v1`.
- `apiKey`: stored encrypted in Electron main process.
- `headers`: optional custom headers.
- `enabled`: whether this profile can be selected.
- `models`: manually configured model ids.
- `defaultChatModel`
- `defaultSummaryModel`
- `defaultTranslationModel`
- `defaultTimelineModel`
- `defaultTaskModel`
- `defaultTtsModel`
- `supportsStreaming`
- `supportsJsonMode`
- `supportsTools`
- `supportsTts`
- `createdAt`
- `updatedAt`
- `lastTestedAt`
- `lastTestResult`

The settings UI should also keep a global routing preference:

- `chatProfileId`
- `summaryProfileId`
- `translationProfileId`
- `timelineProfileId`
- `taskProfileId`
- `ttsProfileId`
- `mcpProfileId`
- `fallbackToFoloAI`

## Secure Storage

The main process should own API key storage.

Recommended storage:

- Store non-secret profile metadata through the existing settings system or a new main-process store key.
- Store API keys in Electron main process using `safeStorage` encryption when available.
- Renderer receives only masked values, such as `sk-...abcd`.
- Export/import should exclude API keys by default.

This keeps user keys out of React components and avoids putting full secrets into normal localStorage-backed settings.

## Local AI Router

Create a local AI router with these responsibilities:

1. Resolve the active profile for a feature.
2. Load decrypted credentials from main process.
3. Convert Folo feature input into provider requests.
4. Normalize provider output into the format expected by existing Folo UI/store code.
5. Record local usage statistics.
6. Decide whether to fall back to Folo AI when local routing is unavailable.

The router should expose feature-level methods:

- `chat(...)`
- `summarizeEntry(...)`
- `translateEntries(...)`
- `summarizeTimeline(...)`
- `rankTimelineEntries(...)`
- `runShortcut(...)`
- `recommendFeeds(...)`
- `runTask(...)`
- `synthesizeSpeech(...)`
- `listModels(...)`
- `testConnection(...)`

## Feature Coverage

### AI Chat, Ask AI, And AI Shortcuts

Replace the current `/ai/chat` transport with a local transport when a local chat profile is enabled.

The local chat transport must:

- Preserve existing chat UI behavior.
- Support streaming text.
- Preserve local chat history persistence.
- Include selected context blocks such as current entry, feed, timeline, category, unread state, and file attachments when possible.
- Continue supporting custom AI shortcuts by converting shortcuts into system/user prompt text.

The first local version does not need Folo's advanced cloud tools. Tool calling can be added later through local MCP integration.

### Article Summary

Replace `api().ai.summary(...)` with local summary generation when a summary profile is configured.

The local prompt should include:

- Article title.
- Content or readability content depending on the requested target.
- Target language.
- Clear instruction to return only the summary text.

Generated summaries should continue using the existing summary store and database cache.

### Translation

Replace `api().ai.translationBatch(...)` with local translation generation when a translation profile is configured.

The local translation path should:

- Support title, description, content, and readability content fields.
- Preserve bilingual and translation-only modes.
- Return the same `TranslationModel` shape used by the current store.
- Remove the free-account blocker when a local provider is selected, because usage is paid by the user's own API key.

### Timeline Summary

Timeline summary should use the same local chat/summary routing as AI shortcuts.

The prompt should include:

- Timeline scope.
- Feed/category context.
- Unread-only state.
- A compact list of candidate entries.

The result can remain a chat session response.

### AI Timeline Sorting

Replace server-side `aiSort` dependency with local scoring when a timeline profile is configured.

The local sorter should:

- Load a bounded batch of entries already available in the local store.
- Ask the configured model to score entries by importance and relevance.
- Parse strict JSON output.
- Sort locally by model score.
- Fall back to normal ordering if parsing or API request fails.

To keep the app responsive, the first implementation should limit the batch size and show a loading overlay while scoring.

### New User AI Recommendations

Replace onboarding recommendation calls with local feed recommendation prompts where possible.

The local version should:

- Ask the user for interests as the current onboarding flow does.
- Use the local provider to produce search terms or preferred categories.
- Match those terms against bundled discover data or existing feed discovery results.

This preserves the onboarding experience without depending on Folo's hosted AI tools.

### AI Tasks

AI tasks currently depend on Folo's server-side scheduler. Local coverage requires a local task engine.

The desktop first version should:

- Store tasks locally.
- Run tasks only while the desktop app is open.
- Support once, daily, weekly, and monthly schedules.
- Use the configured task profile.
- Save task run results locally.
- Show run history in the AI task UI.
- Use desktop notifications for task completion.

Email notifications are not included in the local first version because they require an email delivery service. The UI should make this clear.

### TTS

TTS needs a separate OpenAI Audio Speech compatible route.

The first local TTS version should:

- Support `/v1/audio/speech` compatible providers.
- Configure `defaultTtsModel`, voice, and response format.
- Cache generated audio files like the current reader service does.
- Fall back to `tts.folo.is` only when local TTS is disabled and fallback is allowed.

### MCP

MCP currently depends on Folo cloud APIs. Local MCP coverage requires a desktop-managed MCP client.

The first local MCP version should:

- Store MCP service configs locally.
- Support manually configured streamable HTTP and SSE endpoints.
- List available tools where the server supports discovery.
- Expose local MCP tools to the local chat router.

OAuth-based MCP presets can remain cloud-backed until a separate local OAuth flow is designed.

## Settings UI

Replace the current narrow BYOK section with an **AI API Management** section.

The section should include:

1. **Global Mode**
   - Use Folo AI.
   - Use custom API first.
   - Use custom API only.

2. **API Profiles**
   - Add profile.
   - Edit profile.
   - Delete profile.
   - Enable or disable profile.
   - Test connection.
   - Refresh or manually edit model list.

3. **Feature Routing**
   - Chat model/profile.
   - Summary model/profile.
   - Translation model/profile.
   - Timeline model/profile.
   - Task model/profile.
   - TTS model/profile.
   - MCP profile.

4. **Local Usage**
   - Requests today.
   - Estimated tokens.
   - Last error.
   - Last successful request.

## Error Handling

Local AI calls should produce user-readable errors:

- Missing API key.
- Disabled profile.
- Invalid base URL.
- Model not configured.
- Provider rejected request.
- Streaming response parse failed.
- JSON output parse failed.
- TTS provider does not support speech endpoint.

Feature UIs should show these errors without crashing. For summary and translation, failed local calls should leave existing cached data untouched.

## Testing Strategy

Unit tests should cover:

- Profile selection and fallback rules.
- API key masking.
- OpenAI-compatible request construction.
- Summary prompt construction.
- Translation response parsing.
- Timeline ranking JSON parsing and fallback.
- TTS request construction.
- Local task schedule calculation.

Integration-style tests should cover:

- Chat transport using a mocked streaming response.
- Summary store using local AI and preserving cache behavior.
- Translation store using local AI and no longer blocking free users when local provider is active.
- Main-process profile storage returning masked keys to renderer.

Manual desktop smoke tests should cover:

- Add a custom OpenAI-compatible provider.
- Test connection.
- Send AI chat message.
- Generate article summary.
- Translate article.
- Run timeline summary.
- Sort timeline with local AI.
- Create and run a local AI task.
- Generate TTS audio.

## Rollout Plan

Implement in phases so every phase leaves the app usable:

1. Add local API profile storage and API management UI.
2. Add local AI router and OpenAI-compatible text generation client.
3. Route AI chat, Ask AI, and shortcuts through local provider.
4. Route summary and translation through local provider.
5. Add local timeline summary and timeline sorting.
6. Add local task engine.
7. Add OpenAI-compatible TTS.
8. Add local MCP connection support.
9. Retire the old BYOK UI after migration is stable.

## Migration

Existing BYOK provider settings should be migrated into API profiles:

- `provider` maps to `providerType`.
- `baseURL` maps to `baseURL`.
- `apiKey` is moved into encrypted main-process storage.
- `headers` maps to `headers`.

After migration, old BYOK settings can remain readable for compatibility but should no longer be the primary UI.

## Risks

1. **Streaming format mismatch**
   OpenAI-compatible streams do not match Folo's current AI SDK UI message stream. The implementation needs an adapter that converts provider deltas into UI message chunks or uses a compatible AI SDK transport.

2. **Tool calling differences**
   Folo cloud tools are not equivalent to provider-native tool calls. Local chat should start with plain context injection and add local MCP tools later.

3. **Credential security**
   API keys must not be exposed through renderer state or logs.

4. **Task scheduling expectations**
   Local tasks only run while the desktop app is open. The UI must make that limitation explicit.

5. **Provider variance**
   OpenAI-compatible providers differ in JSON mode, tool support, model listing, and audio support. Profile capability flags avoid assuming every provider supports everything.

## Success Criteria

The feature is successful when:

- A user can add an OpenAI-compatible API profile and test it.
- Chat, summary, translation, timeline summary, timeline sorting, local tasks, TTS, and local MCP have a local-provider path.
- API keys are stored in main process storage and never exposed unmasked in renderer state.
- Existing Folo AI behavior still works when local AI is disabled and fallback is allowed.
- Local AI failures are visible and recoverable.
- The desktop app can be used as a self-managed AI RSS reader without relying on Folo AI quota for supported local routes.
