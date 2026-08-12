jest.mock('kysely', () => ({ Kysely: class Kysely {} }));
jest.mock('@mastra/nestjs', () => ({ MastraService: class MastraService {} }));

import { AnvilAgentSupervisorService } from './anvil-agent-supervisor.service';

const builder = (result?: unknown) => {
  const query = {
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    whereRef: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    column: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(result),
    executeTakeFirst: jest.fn().mockResolvedValue(result),
  };
  return query;
};

const createService = (input: {
  transaction?: unknown;
  bugs?: unknown[];
  attempt?: unknown;
}) => {
  const transactionQuery = builder(input.transaction);
  const bugsQuery = builder(input.bugs ?? []);
  const messagesQuery = builder([]);
  const attemptQuery = builder(input.attempt);
  const transactionUpdate = builder();
  const bugsUpdate = builder();
  const db = {
    selectFrom: jest
      .fn()
      .mockReturnValueOnce(transactionQuery)
      .mockReturnValueOnce(bugsQuery)
      .mockReturnValueOnce(messagesQuery),
    updateTable: jest
      .fn()
      .mockReturnValueOnce(attemptQuery)
      .mockReturnValueOnce(transactionUpdate)
      .mockReturnValueOnce(bugsUpdate),
  };
  const queue = {
    add: jest.fn().mockResolvedValue({ id: 'repair-job-1' }),
  };
  const jobService = { insert: jest.fn().mockResolvedValue(undefined) };
  const service = Object.create(
    AnvilAgentSupervisorService.prototype,
  ) as AnvilAgentSupervisorService;
  Object.assign(service, {
    db,
    anvilSupervisorAgentTaskQueueProcessor: queue,
    jobService,
    logger: { log: jest.fn(), error: jest.fn(), debug: jest.fn() },
  });
  return { service, queue, jobService, db };
};

describe('repair supervisor queue boundary', () => {
  it('queues a bounded repair run and marks bugs as repairing', async () => {
    const { service, queue, jobService } = createService({
      transaction: {
        conversation_id: 'conversation-1',
        project_id: 'project-1',
        originating_run_id: 'workflow-run-1',
      },
      bugs: [
        {
          bug_key: 'BUG-CSS-1',
          category: 'css-syntax',
          severity: 'repairable',
          diagnostic: 'Unbalanced brace',
          affected_files: ['src/app/App.css'],
        },
      ],
      attempt: { repair_attempt_count: 1 },
    });

    await service.queueRepairSupervisorAgent('transaction-1', 'approval-1');

    expect(queue.add).toHaveBeenCalledWith(
      'repair-supervisor-query',
      expect.objectContaining({
        conversation_id: 'conversation-1',
        project_id: 'project-1',
        repair_transaction_id: 'transaction-1',
        repair_approval_id: 'approval-1',
        stream_source: 'workflow-resume',
        originating_run_id: 'workflow-run-1',
      }),
      { attempts: 1 },
    );
    expect(jobService.insert).toHaveBeenCalledWith(
      'repair-job-1:supervisor',
      'conversation-1',
      'supervisor',
    );
  });

  it('does not queue a repair run when the budget is exhausted', async () => {
    const { service, queue, jobService } = createService({
      transaction: {
        conversation_id: 'conversation-1',
        project_id: 'project-1',
      },
      bugs: [{ bug_key: 'BUG-CSS-1' }],
      attempt: undefined,
    });

    await expect(
      service.queueRepairSupervisorAgent('transaction-1', 'approval-1'),
    ).rejects.toThrow('Repair budget exhausted for transaction-1');
    expect(queue.add).not.toHaveBeenCalled();
    expect(jobService.insert).not.toHaveBeenCalled();
  });
});
