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
  doNothing: jest.Mock;
  leftJoin: jest.Mock;
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
  builder.doNothing = jest.fn().mockReturnValue(builder);
  builder.leftJoin = jest.fn().mockReturnValue(builder);
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

  it('finds a durable repair candidate and only includes open and repairing bugs', async () => {
    const transaction = createBuilder({
      id: 'transaction-1',
      project_id: 'project-1',
      conversation_id: 'conversation-1',
      originating_run_id: 'workflow-run-1',
    });
    const bugs = createBuilder([
      {
        bugKey: 'BUG-1',
        severity: 'repairable',
        category: 'css-syntax',
        milestoneKey: 'feature',
      },
    ]);
    const selectFrom = jest
      .fn()
      .mockReturnValueOnce(transaction)
      .mockReturnValueOnce(bugs);
    const service = new AnvilRepairStateService({ selectFrom } as never);

    await expect(
      service.findPendingRepairForRun({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        originatingRunId: 'workflow-run-1',
      }),
    ).resolves.toEqual({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      originatingRunId: 'workflow-run-1',
      transactionId: 'transaction-1',
      bugs: [
        {
          bugKey: 'BUG-1',
          severity: 'repairable',
          category: 'css-syntax',
          milestoneKey: 'feature',
        },
      ],
    });
    expect(transaction.where).toHaveBeenNthCalledWith(4, 'status', 'in', [
      'completed_with_issues',
      'repair_pending',
      'repairing',
    ]);
    expect(bugs.where).toHaveBeenLastCalledWith(
      'preview_platform.edit_bug.status',
      'in',
      ['open', 'repairing'],
    );
  });

  it('creates a deterministic repair approval without using an update-on-conflict', async () => {
    const transaction = createBuilder({
      id: 'transaction-1',
      project_id: 'project-1',
      conversation_id: 'conversation-1',
      originating_run_id: 'workflow-run-1',
      status: 'completed_with_issues',
    });
    const insert = createBuilder({ id: 'approval-1' });
    const update = createBuilder();
    const insertInto = jest.fn().mockReturnValue(insert);
    const service = new AnvilRepairStateService({
      selectFrom: jest.fn().mockReturnValue(transaction),
      insertInto,
      updateTable: jest.fn().mockReturnValue(update),
    } as never);
    const candidate = {
      projectId: 'project-1',
      conversationId: 'conversation-1',
      originatingRunId: 'workflow-run-1',
      transactionId: 'transaction-1',
      bugs: [
        {
          bugKey: 'BUG-1',
          severity: 'repairable',
          category: 'css-syntax',
          milestoneKey: 'feature',
        },
      ],
    };

    await expect(
      service.createOrReuseRepairApproval(candidate),
    ).resolves.toEqual({
      approvalId: 'approval-1',
      created: true,
      transactionId: 'transaction-1',
      bugCount: 1,
    });
    expect(insert.values).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'repair:transaction-1' }),
    );
    expect(insert.doNothing).toHaveBeenCalled();
    expect(insert.doUpdateSet).not.toHaveBeenCalled();
  });

  it('re-reads an existing approval and does not reset its terminal status', async () => {
    const transaction = createBuilder({
      id: 'transaction-1',
      project_id: 'project-1',
      conversation_id: 'conversation-1',
      originating_run_id: 'workflow-run-1',
      status: 'repair_pending',
    });
    const insert = createBuilder(undefined);
    const existing = createBuilder({ id: 'approval-terminal' });
    const update = createBuilder();
    const insertInto = jest.fn().mockReturnValue(insert);
    const selectFrom = jest
      .fn()
      .mockReturnValueOnce(transaction)
      .mockReturnValueOnce(existing);
    const service = new AnvilRepairStateService({
      insertInto,
      selectFrom,
      updateTable: jest.fn().mockReturnValue(update),
    } as never);

    await expect(
      service.createOrReuseRepairApproval({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        originatingRunId: 'workflow-run-1',
        transactionId: 'transaction-1',
        bugs: [
          { bugKey: 'BUG-1', severity: 'repairable', category: 'css-syntax' },
        ],
      }),
    ).resolves.toEqual({
      approvalId: 'approval-terminal',
      created: false,
      transactionId: 'transaction-1',
      bugCount: 1,
    });
    expect(existing.where).toHaveBeenCalledWith(
      'run_id',
      '=',
      'repair:transaction-1',
    );
    expect(existing.set).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenCalledWith({ status: 'repair_pending' });
    expect(update.set).toHaveBeenCalledWith({ status: 'repair_pending' });
  });

  it('does not return a repair candidate without open bugs', async () => {
    const transaction = createBuilder({
      id: 'transaction-1',
      project_id: 'project-1',
      conversation_id: 'conversation-1',
      originating_run_id: 'workflow-run-1',
    });
    const bugs = createBuilder([]);
    const service = new AnvilRepairStateService({
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(transaction)
        .mockReturnValueOnce(bugs),
    } as never);

    await expect(
      service.findPendingRepairForRun({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        originatingRunId: 'workflow-run-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves a milestone key before writing the bug foreign key', async () => {
    const milestone = createBuilder({ id: 'milestone-1' });
    const bugInsert = createBuilder({ id: 'bug-1' });
    const service = new AnvilRepairStateService({
      selectFrom: jest.fn().mockReturnValue(milestone),
      insertInto: jest.fn().mockReturnValue(bugInsert),
    } as never);

    await service.upsertBug('transaction-1', {
      bugKey: 'BUG-1',
      milestoneKey: 'feature',
      severity: 'repairable',
      category: 'css-syntax',
      validator: 'css-validator',
      diagnostic: 'Invalid CSS',
      affectedFiles: [],
      originatingRunId: 'workflow-run-1',
    });

    expect(bugInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ milestone_id: 'milestone-1' }),
    );
  });
});
