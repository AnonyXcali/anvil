jest.mock('kysely', () => ({ Kysely: class Kysely {} }));

import { AnvilRepairStateService } from './anvil-repair-state.service';

type Builder = {
  set: jest.Mock;
  where: jest.Mock;
  whereRef: jest.Mock;
  returning: jest.Mock;
  execute: jest.Mock;
  executeTakeFirst: jest.Mock;
  executeTakeFirstOrThrow: jest.Mock;
  selectAll: jest.Mock;
  orderBy: jest.Mock;
  select: jest.Mock;
  values: jest.Mock;
  onConflict: jest.Mock;
  columns: jest.Mock;
  column: jest.Mock;
  doUpdateSet: jest.Mock;
};

const createBuilder = (result?: unknown): Builder => {
  const builder = {} as Builder;
  builder.set = jest.fn().mockReturnValue(builder);
  builder.where = jest.fn().mockReturnValue(builder);
  builder.whereRef = jest.fn().mockReturnValue(builder);
  builder.returning = jest.fn().mockReturnValue(builder);
  builder.execute = jest.fn().mockResolvedValue(result);
  builder.executeTakeFirst = jest.fn().mockResolvedValue(result);
  builder.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(result);
  builder.selectAll = jest.fn().mockReturnValue(builder);
  builder.orderBy = jest.fn().mockReturnValue(builder);
  builder.select = jest.fn().mockReturnValue(builder);
  builder.values = jest.fn().mockReturnValue(builder);
  builder.columns = jest.fn().mockReturnValue(builder);
  builder.column = jest.fn().mockReturnValue(builder);
  builder.doUpdateSet = jest.fn().mockReturnValue(builder);
  builder.onConflict = jest.fn((callback: (value: Builder) => unknown) => {
    callback(builder);
    return builder;
  });
  return builder;
};

describe('AnvilRepairStateService', () => {
  it('claims repair attempts atomically and rejects an exhausted budget', async () => {
    const successfulUpdate = createBuilder({ repair_attempt_count: 2 });
    const exhaustedUpdate = createBuilder(undefined);
    const updateTable = jest
      .fn()
      .mockReturnValueOnce(successfulUpdate)
      .mockReturnValueOnce(exhaustedUpdate);
    const service = new AnvilRepairStateService({ updateTable } as never);

    await expect(service.claimRepairAttempt('transaction-1')).resolves.toBe(2);
    await expect(service.claimRepairAttempt('transaction-1')).rejects.toThrow(
      'Repair budget exhausted for transaction-1',
    );

    expect(successfulUpdate.whereRef).toHaveBeenCalledWith(
      'repair_attempt_count',
      '<',
      'repair_budget',
    );
    expect(exhaustedUpdate.whereRef).toHaveBeenCalledWith(
      'repair_attempt_count',
      '<',
      'repair_budget',
    );
  });

  it('creates a transaction only for an existing workflow run', async () => {
    const workflowRun = createBuilder({ run_id: 'workflow-run-1' });
    const insert = createBuilder({ id: 'transaction-1' });
    const service = new AnvilRepairStateService({
      selectFrom: jest.fn().mockReturnValue(workflowRun),
      insertInto: jest.fn().mockReturnValue(insert),
    } as never);

    await expect(
      service.createTransaction({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        originatingRunId: 'workflow-run-1',
        stagingRoot: '/tmp/staging',
        manifestPath: '/tmp/staging/.anvil-manifest.json',
      }),
    ).resolves.toBe('transaction-1');

    expect(insert.values).toHaveBeenCalledWith(
      expect.objectContaining({ originating_run_id: 'workflow-run-1' }),
    );
  });

  it('rejects a queue job ID before inserting a transaction', async () => {
    const workflowRun = createBuilder(undefined);
    const insertInto = jest.fn();
    const service = new AnvilRepairStateService({
      selectFrom: jest.fn().mockReturnValue(workflowRun),
      insertInto,
    } as never);

    await expect(
      service.createTransaction({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        originatingRunId: 'bullmq-job-42',
        stagingRoot: '/tmp/staging',
        manifestPath: '/tmp/staging/.anvil-manifest.json',
      }),
    ).rejects.toThrow('Originating workflow run bullmq-job-42 does not exist');

    expect(insertInto).not.toHaveBeenCalled();
  });

  it('serializes milestone and bug affected files as JSON arrays', async () => {
    const milestoneInsert = createBuilder({ id: 'milestone-1' });
    const bugInsert = createBuilder({ id: 'bug-1' });
    const service = new AnvilRepairStateService({
      insertInto: jest
        .fn()
        .mockReturnValueOnce(milestoneInsert)
        .mockReturnValueOnce(bugInsert),
    } as never);

    await service.upsertMilestone({
      transactionId: 'transaction-1',
      milestoneKey: 'feature',
      sequence: 0,
      affectedFiles: ['src/index.css', 'src/App.tsx'],
      originatingRunId: 'workflow-run-1',
    });
    await service.upsertBug('transaction-1', {
      bugKey: 'BUG-CSS-1',
      severity: 'repairable',
      category: 'css-syntax',
      validator: 'css-validator',
      diagnostic: 'Invalid CSS',
      affectedFiles: [],
      originatingRunId: 'workflow-run-1',
    });

    expect(milestoneInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        affected_files: '["src/index.css","src/App.tsx"]',
      }),
    );
    expect(bugInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ affected_files: '[]' }),
    );
    expect(milestoneInsert.doUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        affected_files: '["src/index.css","src/App.tsx"]',
      }),
    );
    expect(bugInsert.doUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ affected_files: '[]' }),
    );
  });

  it('resolves a bug by stable transaction and bug identifiers', async () => {
    const update = createBuilder();
    const service = new AnvilRepairStateService({
      updateTable: jest.fn().mockReturnValue(update),
    } as never);

    await service.resolveBug('transaction-1', 'BUG-CSS-001');

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved' }),
    );
    expect(update.where).toHaveBeenNthCalledWith(
      1,
      'transaction_id',
      '=',
      'transaction-1',
    );
    expect(update.where).toHaveBeenNthCalledWith(
      2,
      'bug_key',
      '=',
      'BUG-CSS-001',
    );
  });

  it('lists only open and repairing bugs in newest-first order', async () => {
    const bugs = [{ bug_key: 'BUG-2' }, { bug_key: 'BUG-1' }];
    const select = createBuilder(bugs);
    const service = new AnvilRepairStateService({
      selectFrom: jest.fn().mockReturnValue(select),
    } as never);

    await expect(service.listOpenBugs('transaction-1')).resolves.toEqual(bugs);
    expect(select.where).toHaveBeenNthCalledWith(
      1,
      'transaction_id',
      '=',
      'transaction-1',
    );
    expect(select.where).toHaveBeenNthCalledWith(2, 'status', 'in', [
      'open',
      'repairing',
    ]);
    expect(select.orderBy).toHaveBeenCalledWith('created_at', 'desc');
  });
});
