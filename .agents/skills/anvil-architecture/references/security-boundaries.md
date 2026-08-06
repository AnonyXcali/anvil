# Security boundaries

Better Auth owns authentication and session configuration. Controllers use session data and services perform project ownership checks for project and testing-UI operations. Project IDs scope remote workspace paths, containers, files, and preview metadata.

`SshService` validates project-relative paths and centralizes shell quoting and remote command execution. Agent tools expose project-scoped file operations, while the editing agent instructions require explicit safety for delete operations and approval before applying proposed edits.

The plan workflow is the human approval boundary for frontend changes. Workflow resume must use a persisted application workflow run and validated approval request.

Known gaps include direct HTTP preview URLs, local Compose publication of Redis/Postgres, development credentials in Compose, and security TODOs in the SSH and Docker configuration. These are current risks, not guarantees of production safety.

Preview inspection must use an explicitly supplied, HTTP(S)-validated preview
URL. Browser navigation and navigation redirects must remain on that preview
origin. The URL is resolved by an ownership-aware application service before it
reaches the tool; it is never looked up by a Mastra tool.
