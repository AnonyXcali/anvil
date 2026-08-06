import {
  buildAppStreamEvent,
  buildStreamEnvelope,
} from './anvil-agent-streaming.helpers';

describe('stream event mapping', () => {
  it('maps workflow start to a workflow status event', () => {
    expect(
      buildAppStreamEvent({ type: 'workflow-start', payload: {} }),
    ).toEqual({
      type: 'workflow_status',
      payload: {
        status: 'started',
        message: 'Started preparing changes.',
        step: 'workflow',
      },
    });
  });

  it.each([
    ['anvil-agent-workflow-search-step', 'search_status'],
    ['anvil-edit-agent-nested-workflow-edit-step', 'edit_status'],
    [
      'anvil-edit-agent-nested-workflow-verify-edit-step',
      'verification_status',
    ],
  ])('maps %s to %s', (step, eventType) => {
    expect(
      buildAppStreamEvent({
        type: 'workflow-step-start',
        payload: { id: step },
      })?.type,
    ).toBe(eventType);
  });

  it('maps workflow step results to completed status', () => {
    expect(
      buildAppStreamEvent({
        type: 'workflow-step-result',
        payload: { id: 'anvil-agent-workflow-search-step' },
      }),
    ).toMatchObject({
      type: 'search_status',
      payload: { status: 'completed' },
    });
  });

  it('preserves failed workflow step results as failed status events', () => {
    expect(
      buildAppStreamEvent({
        type: 'workflow-step-result',
        payload: {
          id: 'anvil-agent-workflow-edit-step',
          status: 'failed',
        },
      }),
    ).toMatchObject({
      type: 'edit_status',
      payload: {
        status: 'failed',
        message: 'The edit workflow failed.',
      },
    });
  });

  it('maps nested edit progress to the stable edit status event', () => {
    expect(
      buildAppStreamEvent({
        type: 'edit_progress',
        payload: {
          status: 'started',
          message: 'Creating a backup of the original file.',
          step: 'anvil-edit-agent-nested-workflow-backup-original-file-step',
        },
      }),
    ).toEqual({
      type: 'edit_status',
      payload: {
        status: 'started',
        message: 'Creating a backup of the original file.',
        step: 'anvil-edit-agent-nested-workflow-backup-original-file-step',
      },
    });

    expect(
      buildAppStreamEvent({
        type: 'edit_progress',
        payload: {
          status: 'failed',
          message: 'Verifying the edit.',
          step: 'anvil-edit-agent-nested-workflow-verify-edit-file-step',
        },
      }),
    ).toMatchObject({
      type: 'edit_status',
      payload: { status: 'failed' },
    });

    expect(
      buildAppStreamEvent({
        type: 'edit_progress',
        payload: { status: 'unexpected', step: 'nested-step' },
      }),
    ).toBeNull();
  });

  it('maps tool start and completion events', () => {
    expect(
      buildAppStreamEvent({
        type: 'tool-call',
        payload: { toolName: 'read_file' },
      }),
    ).toMatchObject({
      type: 'tool_status',
      payload: { status: 'started', toolName: 'read_file' },
    });

    expect(
      buildAppStreamEvent({
        type: 'tool-result',
        payload: { toolName: 'read_file' },
      }),
    ).toMatchObject({
      type: 'tool_status',
      payload: { status: 'completed', toolName: 'read_file' },
    });
  });

  it('maps workflow finish, failure, and abort events', () => {
    expect(
      buildAppStreamEvent({
        type: 'workflow-finish',
        payload: { workflowStatus: 'completed' },
      }),
    ).toMatchObject({ type: 'completed', payload: { status: 'completed' } });

    expect(
      buildAppStreamEvent({
        type: 'workflow-finish',
        payload: { workflowStatus: 'failed' },
      }),
    ).toMatchObject({ type: 'error', payload: { status: 'failed' } });

    expect(buildAppStreamEvent({ type: 'abort', payload: {} })).toMatchObject({
      type: 'error',
      payload: { status: 'failed' },
    });
  });

  it('does not map suspended or unknown chunks to ordinary UI events', () => {
    expect(
      buildAppStreamEvent({ type: 'workflow-step-suspended', payload: {} }),
    ).toBeNull();
    expect(
      buildAppStreamEvent({ type: 'unrecognized', payload: {} }),
    ).toBeNull();
  });

  it('keeps raw chunks and stream metadata in the envelope', () => {
    const raw = { type: 'workflow-start', payload: {} };

    expect(
      buildStreamEnvelope({
        chunk: raw,
        conversationId: 'conversation-1',
        source: 'supervisor',
        jobId: 'job-1',
      }),
    ).toMatchObject({
      type: 'workflow-start',
      conversationId: 'conversation-1',
      source: 'supervisor',
      jobId: 'job-1',
      raw,
    });
  });
});
