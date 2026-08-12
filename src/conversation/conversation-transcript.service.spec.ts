jest.mock('kysely', () => ({ Kysely: class Kysely {} }));

import { ConversationTranscriptService } from './conversation-transcript.service';

describe('ConversationTranscriptService', () => {
  it('upserts a completed assistant message by conversation and source id', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const doUpdateSet = jest.fn().mockReturnValue({ execute });
    const conflictBuilder = {
      columns: jest.fn().mockReturnValue({ doUpdateSet }),
    };
    const onConflict = jest.fn(
      (callback: (builder: typeof conflictBuilder) => unknown) => {
        callback(conflictBuilder);
        return { execute };
      },
    );
    const values = jest.fn().mockReturnValue({ onConflict });
    const insertInto = jest.fn().mockReturnValue({ values });
    const db = { insertInto } as never;
    const service = new ConversationTranscriptService(db);

    await service.storeAssistantMessage({
      conversationId: 'conversation-1',
      sourceId: 'workflow-resume:approval-1',
      message: '  The changes are ready.  ',
    });
    await service.storeAssistantMessage({
      conversationId: 'conversation-1',
      sourceId: 'workflow-resume:approval-1',
      message: 'The changes are ready after retry.',
    });

    expect(insertInto).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenNthCalledWith(1, {
      conversation_id: 'conversation-1',
      role: 'assistant',
      message: 'The changes are ready.',
      source_id: 'workflow-resume:approval-1',
    });
    expect(values).toHaveBeenNthCalledWith(2, {
      conversation_id: 'conversation-1',
      role: 'assistant',
      message: 'The changes are ready after retry.',
      source_id: 'workflow-resume:approval-1',
    });
    expect(onConflict).toHaveBeenCalledTimes(2);
    expect(doUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'The changes are ready after retry.',
      }),
    );
  });

  it('does not write empty transcript content', async () => {
    const insertInto = jest.fn();
    const service = new ConversationTranscriptService({ insertInto } as never);

    await service.storeAssistantMessage({
      conversationId: 'conversation-1',
      sourceId: 'source-1',
      message: '  ',
    });

    expect(insertInto).not.toHaveBeenCalled();
  });
});
