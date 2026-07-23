# Human in the loop

Human in the loop is a technique that allows AI systems to suspend their flow, and request the user to provide feedback or confirmation before performing any further steps.

# Framework in question

[Human In the loop](https://mastra.ai/docs/workflows/human-in-the-loop)

- Idea is that the architecture should work in this way

Inside Anvil, when a workflow is suspended, it can be resumed via -

```
const workflow = mastra.getWorkflow('testWorkflow')
const run = await workflow.createRun({ runId: '123' })

const stream = run.resume({
  resumeData: { approved: true },
})
```

# How to resume?

- Stream from a agent or a workflow , is captured via async for loop.
- Specifically speaking for workflow, if workflow-execution-suspended occurs and similarly for agent stream if exists.
- The following needs to happen

## Database Save

- Database table workflow_run must store the runId and workflowId apart from other required details.
- Redis pub sub implementation of this.channelService.publishAndStoreChunk should be used to relay

```
{
"type": "approval_required",
"payload": {
"approvalId": "9a4e6d85-...", //this is the id that is returned after saving the necessary details in db.
"title": "Apply proposed changes?",
"message": "The AI has prepared a set of changes that require your approval."
}
}
```

it is expected that the approvalId used in the POST call that the user would use when deciding to accept or deny the proposition the Agents provide.

JSONB column must store the snapshot

```
const storage = mastra.getStorage()
const workflowStore = await storage?.getStore('workflows')

const snapshot = await workflowStore?.loadWorkflowSnapshot({
  runId: '<run-id>',
  workflowName: '<workflow-id>',
})
```

## API CALL

- A POST call that is reusable across any kind of HITL situation.
- part of core.controller.ts
- POST Call name - @Post('/decision')
- The body requires the following shape

```
{
  decision: ‘accept’ | ‘deny’,
  approvalRequestId: string,
}
```

- authenticated route
- core.service.ts must implement a service that does
- searches for the workflow based on the approvalRequestId, rerieves the workflow_id and run_id.
- check for accept or deny value, incase of accept true else false.

```
const workflow = mastra.getWorkflow('testWorkflow')
const run = await workflow.createRun({ runId: '123' })

const stream = run.resume({
  resumeData: { approved: true },
})
```

## Within the workflow

resumeData in the context Object of a step's execute method, can be used to access the decision.

## Guardrails

- Incase of no such workflow exists, throw error to user.
