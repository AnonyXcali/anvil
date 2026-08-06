# Streaming contract

`ChannelsService.publishAndStoreChunk` is the backend boundary for Redis-backed stream publication and persistence. Callers provide generated Redis keys and optional stream metadata. Core, agent, supervisor, and code-generation flows use it to publish progress and model output.

The chunk dictionary in `src/anvil-agent/anvil-agent-chunk.dictionary.ts` defines application event names. Supervisor and core services normalize Mastra chunks with `anvil-agent-streaming.helpers.ts`, including stream envelopes, application events, workflow identifiers, approval payloads, and empty-chunk filtering.

Nested edit operations emit best-effort `edit_progress` writer events. The outer workflow maps these to the stable `edit_status` UI event; nested workflows do not publish directly to Redis or expose a separate Mastra lifecycle stream.

The frontend consumes the channel through SSE. Supervisor streams may include reasoning, tool calls, tool-call deltas, workflow lifecycle, approval-required, status, and final response information. Instant conversation streams intentionally publish only plain text delta chunks; the UI appends each received chunk to the active assistant message. Stored chunks support replay for a conversation stream. Ordering follows the Redis sequence generated for the conversation and job stream.

Instant conversation requests receive a request-level `stream_id` when `/talk` queues the intent job. That ID is returned in the HTTP response, carried through the intent and conversation queues, and included as SSE envelope metadata on every instant-conversation chunk. The Redis sequence remains scoped to the conversation worker job; the UI uses `stream_id` to keep sequence tracking isolated across requests and to associate chunks with the active composer.

Intent classification is an internal non-streaming decision. `anvil-intent-agent`
receives ordered application-database history and returns structured routing
output; that output is not part of the user-facing stream and must not be
persisted or published as a Redis/SSE chunk.

Payload details are defined by the helper types and channel interface; this document intentionally describes ownership and lifecycle rather than duplicating every schema. Any new event must update the chunk dictionary, helper mapping, frontend consumer, and this reference.

## Stream-map synchronization checklist

The following maps are behavioral registries that must stay synchronized with the stream contract:

| Change introduced | Registries and consumers to inspect |
| --- | --- |
| New or renamed workflow step | `WORKFLOW_STEP_STATUS_MESSAGES`, `STREAM_LOGGABLE_STEPS`, `buildAppStreamEvent`, related tests, and frontend activity handling |
| New or renamed tool | `TOOL_STATUS_MESSAGES`, `STREAM_LOGGABLE_TOOLS`, `buildAppStreamEvent`, related tests, and frontend activity handling |
| New or renamed raw Mastra chunk type | `buildAppStreamEvent`, suspension/approval orchestration when applicable, related tests, and this contract |
| New or renamed application event type | `StreamEventType`, `STREAM_LOGGABLE_TYPES`, `buildAppStreamEvent` or its publisher call site, frontend event handling, related tests, and this contract |
| Removed workflow step, tool, chunk, or application event | Remove stale entries from every applicable registry and consumer, then update tests and references |

The canonical implementation locations are `src/anvil-agent/anvil-agent-streaming.helpers.ts`, `src/channels/channels.service.ts`, `src/anvil-agent/anvil-agent-chunk.dictionary.ts`, and `public/testing-ui/testing-ui.js`. These registries must not be treated as comments or passive metadata: they control user-visible status messages, backend diagnostics, event naming, and frontend behavior.

If a new entity is intentionally absent from one of these maps, the change must document why and include a test or explicit architectural rationale showing that the omission is deliberate.
Diagnostic chunks such as `edit_verification_*`, `css_validation`, and `history_*_warning` are internal observability events. They remain loggable for backend diagnostics but are not stable frontend events; `edit_progress` is the only nested edit progress event mapped to the UI as `edit_status`.
