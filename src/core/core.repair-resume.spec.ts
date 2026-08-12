jest.mock('kysely', () => ({ Kysely: class Kysely {} }));
jest.mock('@mastra/nestjs', () => ({ MastraService: class MastraService {} }));
jest.mock('src/anvil-agent-supervisor/anvil-agent-supervisor.service', () => ({
  AnvilAgentSupervisorService: class AnvilAgentSupervisorService {},
}));
jest.mock('src/anvil-agent/anvil-agent-stream-publisher.service', () => ({
  AnvilAgentStreamPublisher: class AnvilAgentStreamPublisher {},
}));
jest.mock('src/channels/channels.service', () => ({
  ChannelsService: class ChannelsService {},
}));
jest.mock('src/conversation/conversation-transcript.service', () => ({
  ConversationTranscriptService: class ConversationTranscriptService {},
}));

import { CoreService } from './core.service';
import { StreamEventType } from 'src/anvil-agent/anvil-agent-chunk.dictionary';

const updateBuilder = () => ({
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
});

type RepairStarter = {
  startRepairSupervisorRun(input: {
    transactionId: string;
    approvalRequestId: string;
    conversationId: string;
  }): Promise<void>;
};

describe('CoreService repair approval handoff', () => {
  const invoke = (
    service: CoreService,
    input: Parameters<RepairStarter['startRepairSupervisorRun']>[0],
  ) => (service as unknown as RepairStarter).startRepairSupervisorRun(input);

  it('publishes the resume start, queues the repair, and keeps the approval running', async () => {
    const statusUpdate = updateBuilder();
    const streamPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const queueRepairSupervisorAgent = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(CoreService.prototype) as CoreService;
    Object.assign(service, {
      streamPublisher,
      anvilAgentSupervisorService: { queueRepairSupervisorAgent },
      db: { updateTable: jest.fn().mockReturnValue(statusUpdate) },
      logger: { error: jest.fn() },
    });

    await invoke(service, {
      transactionId: 'transaction-1',
      approvalRequestId: 'approval-1',
      conversationId: 'conversation-1',
    });

    const resumeChunkMatcher: unknown = expect.objectContaining({
      type: 'workflow-resume-start',
    });
    expect(streamPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        source: 'workflow-resume',
        approvalRequestId: 'approval-1',
        chunk: resumeChunkMatcher,
      }),
    );
    expect(queueRepairSupervisorAgent).toHaveBeenCalledWith(
      'transaction-1',
      'approval-1',
    );
    expect(statusUpdate.set).toHaveBeenCalledWith({ status: 'running' });
  });

  it('marks the repair approval and transaction failed when queueing fails', async () => {
    const statusUpdate = updateBuilder();
    const streamPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const queueError = new Error('queue unavailable');
    const service = Object.create(CoreService.prototype) as CoreService;
    Object.assign(service, {
      streamPublisher,
      anvilAgentSupervisorService: {
        queueRepairSupervisorAgent: jest.fn().mockRejectedValue(queueError),
      },
      db: { updateTable: jest.fn().mockReturnValue(statusUpdate) },
      logger: { error: jest.fn() },
    });

    await invoke(service, {
      transactionId: 'transaction-1',
      approvalRequestId: 'approval-1',
      conversationId: 'conversation-1',
    });

    expect(statusUpdate.set).toHaveBeenNthCalledWith(1, { status: 'failed' });
    expect(statusUpdate.set).toHaveBeenNthCalledWith(2, { status: 'failed' });
    expect(streamPublisher.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chunk: {
          type: StreamEventType.WORKFLOW_ERROR,
          payload: { status: 'failed', message: 'Something went wrong.' },
        },
      }),
    );
  });
});
