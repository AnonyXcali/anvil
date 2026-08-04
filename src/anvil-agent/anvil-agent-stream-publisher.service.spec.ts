import { AnvilAgentStreamPublisher } from './anvil-agent-stream-publisher.service';

describe('AnvilAgentStreamPublisher', () => {
  it('stores and publishes the existing envelope contract', async () => {
    const publishAndStoreChunk = jest.fn().mockResolvedValue(undefined);
    const publisher = new AnvilAgentStreamPublisher({
      publishAndStoreChunk,
    } as never);

    await publisher.publish({
      chunk: { type: 'workflow-start', payload: {} },
      conversationId: 'conversation-1',
      jobId: 'job-1',
      envelopeJobId: 'job-1',
      source: 'supervisor',
      streamId: 'job-1:supervisor',
    });

    expect(publishAndStoreChunk).toHaveBeenCalledWith(
      expect.stringContaining('workflow-start'),
      'conversation:conversation-1:job:job-1:seq',
      'conversation:conversation-1:job:job-1:chunks',
      'conversation:conversation-1:job:job-1:meta',
      'conversation-1',
      { streamId: 'job-1:supervisor' },
    );
  });

  it('does not publish empty deltas', async () => {
    const publishAndStoreChunk = jest.fn();
    const publisher = new AnvilAgentStreamPublisher({
      publishAndStoreChunk,
    } as never);

    await expect(
      publisher.publish({
        chunk: { type: 'text-delta', payload: { text: '' } },
        conversationId: 'conversation-1',
        jobId: 'job-1',
        source: 'supervisor',
      }),
    ).resolves.toBe(false);
    expect(publishAndStoreChunk).not.toHaveBeenCalled();
  });
});
