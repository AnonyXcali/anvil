import { Logger } from '@nestjs/common';

jest.mock('src/conversation/conversation.service', () => ({
  ConversationService: class ConversationService {},
}));
jest.mock('src/intent/intent.service', () => ({
  IntentService: class IntentService {},
}));
jest.mock('src/job/job.service', () => ({ JobService: class JobService {} }));
jest.mock('src/anvil-agent-supervisor/anvil-agent-supervisor.service', () => ({
  AnvilAgentSupervisorService: class AnvilAgentSupervisorService {},
}));
jest.mock('src/anvil-agent/anvil-agent-stream-publisher.service', () => ({
  AnvilAgentStreamPublisher: class AnvilAgentStreamPublisher {},
}));

import { IntentProcessor } from './intent.processor';
import type { INTENT_JOB } from './intent.types';

function createJob(): INTENT_JOB {
  return {
    id: '42',
    data: {
      query: "What is today's date?",
      conversation_id: 'conversation-1',
      project_id: 'project-1',
      stream_id: 'stream-1',
    },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as INTENT_JOB;
}

function createProcessor({
  intent,
  publish = jest.fn().mockResolvedValue(true),
}: {
  intent: string;
  publish?: jest.Mock;
}) {
  const processor = new IntentProcessor(
    { handleConversation: jest.fn().mockResolvedValue(undefined) } as never,
    { classifyIntent: jest.fn().mockResolvedValue(intent) } as never,
    {} as never,
    {
      anvilSupervisorAgentQueue: jest.fn().mockResolvedValue(undefined),
    } as never,
    { publish } as never,
  );

  return { processor, publish };
}

describe('IntentProcessor', () => {
  it('routes instant intent to the conversation service', async () => {
    const { processor } = createProcessor({ intent: 'instant' });
    const job = createJob();

    await expect(processor.process(job)).resolves.toMatchObject({
      job: '42',
      conversationId: 'conversation-1',
    });

    const conversationService = (
      processor as unknown as {
        conversationService: { handleConversation: jest.Mock };
      }
    ).conversationService;

    expect(conversationService.handleConversation).toHaveBeenCalledWith(
      "What is today's date?",
      'conversation-1',
      'project-1',
      'stream-1',
    );
  });

  it('routes offload intent to the supervisor service', async () => {
    const { processor } = createProcessor({ intent: 'offload' });
    const job = createJob();

    await expect(processor.process(job)).resolves.toMatchObject({
      job: '42',
      conversationId: 'conversation-1',
    });

    const supervisorService = (
      processor as unknown as {
        anvilAgentSupervisorService: {
          anvilSupervisorAgentQueue: jest.Mock;
        };
      }
    ).anvilAgentSupervisorService;

    expect(supervisorService.anvilSupervisorAgentQueue).toHaveBeenCalledWith(
      'conversation-1',
      "What is today's date?",
      'project-1',
    );
  });

  it('publishes a text fallback before failing an invalid intent', async () => {
    const { processor, publish } = createProcessor({ intent: 'unknown' });
    const job = createJob();

    await expect(processor.process(job)).rejects.toThrow(
      'Invalid query by user',
    );

    expect(publish).toHaveBeenCalledWith({
      chunk: {
        type: 'text-delta',
        payload: {
          text: "I'm sorry, I couldn't determine how to handle that request.",
        },
      },
      conversationId: 'conversation-1',
      jobId: '42:intent',
      source: 'intent',
      streamId: 'stream-1',
    });
  });

  it('preserves the invalid-intent failure when fallback publication fails', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('Redis unavailable'));
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const { processor } = createProcessor({ intent: 'unknown', publish });

    try {
      await expect(processor.process(createJob())).rejects.toThrow(
        'Invalid query by user',
      );
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to publish invalid-intent fallback'),
        expect.any(String),
      );
    } finally {
      loggerError.mockRestore();
    }
  });
});
