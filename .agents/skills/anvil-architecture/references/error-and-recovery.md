# Error and recovery

Validation errors generally fail the current service, workflow step, or tool call. BullMQ failed handlers update application job status and preserve the failure message. Worker error handlers log errors that are not associated with a recoverable job.

Workflow approvals are recoverable because the application persists workflow identifiers and suspended snapshots. Resume uses the same run ID. Stream consumers can query stored chunks and reconnect through the Redis-backed SSE path, but reconnection behavior is owned by the client and is not fully specified in backend code.

SSH, filesystem, database, and Redis failures are surfaced through their owning service or processor. The system has uneven retry behavior: queue attempts are configured per job, while remote-operation retries and global recovery policies are not uniform. The edit workflow cleans temporary files after successful upload but documents lifecycle cleanup gaps for controlled failures before upload.

Instant conversation streams have a 30-second execution timeout. The conversation service aborts the Mastra stream, logs the error with the conversation and queue job IDs, publishes a user-visible fallback `text-delta`, and returns that fallback so the conversation job completes and persists the message. This timeout does not cancel work that an external tool fails to observe; tool-level timeouts remain responsible for their own network and browser operations.

Intent classification failures publish a user-visible fallback `text-delta` on the conversation channel before the intent processor rethrows the classification error. The rethrow preserves BullMQ failure state and invokes the intent job failure handler, while the persisted stream chunk gives the user feedback without introducing a separate SSE event type. If fallback publication fails, the processor logs the publication error and still preserves the original classification failure.

Any new recovery behavior must document persistence guarantees, retry ownership, duplicate-operation handling, and user-visible status transitions.

The multi-file edit workflow persists its manifest before each remote backup,
directory creation, and file mutation. The manifest is retained when rollback
or cleanup fails, allowing the edit service to discover stale transactions at
startup and attempt compensating restore/delete operations. Recovery is
best-effort and idempotent at the file level: existing-file edits/deletes are
restored from the transaction backup, newly created files are removed, and
created directories are removed only when empty. A later recovery failure
retains the manifest and backup artifacts for another operator/worker attempt;
it never replaces the original edit failure. Startup recovery logs its outcome
through the owning service; it does not publish a historical workflow-resume
event after the worker has stopped. Normal in-run diagnostics continue through
the existing workflow-resume/edit_status contract without exposing local paths
or patch contents.
