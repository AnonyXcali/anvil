# Queue and job model

BullMQ queues are registered by Nest modules and processed by `WorkerHost` processors. Current queues cover intent execution, normal conversation work, supervisor agent work, agent search/offload work, code execution, edit execution, and project start/stop operations.

Processors update progress where applicable, call application services, and respond to BullMQ active, completed, failed, and error events. Instant conversation jobs carry `conversation_id`, `project_id`, the current query, and prior messages; the processor invokes `anvil-convo` and persists the assembled final response after streaming. Application job records are stored separately from BullMQ job records and use suffixed IDs such as `:supervisor`, `:conversation`, or `:scaffold-project`.

Queue configuration currently uses low retry counts for several flows and removes completed/failed jobs after age/count limits. Concurrency is explicitly configured on agent processors. Cancellation and idempotency are partial concerns: workflow edit invocation has a request-context tripwire, while broader queue cancellation and recovery are not uniformly implemented.

When changing queues, update the owning module, processor, application job persistence, this reference, and relevant error/recovery behavior.
