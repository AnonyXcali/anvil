type MockStep = {
  id?: string;
  execute?: (context: unknown) => Promise<unknown>;
};

const mockSteps: MockStep[] = [];

jest.mock('@mastra/core/workflows', () => ({
  createStep: jest.fn((params: MockStep) => {
    mockSteps.push(params);
    return params;
  }),
  createWorkflow: jest.fn(() => ({
    then: jest.fn().mockReturnThis(),
    foreach: jest.fn().mockReturnThis(),
    map: jest.fn().mockReturnThis(),
    branch: jest.fn().mockReturnThis(),
    commit: jest.fn().mockReturnThis(),
  })),
}));
jest.mock('@mastra/evals/scorers/prebuilt', () => ({
  createRubricScorer: jest.fn(),
}));

import { RequestContext } from '@mastra/core/request-context';
import type {
  EDIT_AGENT_INPUT,
  STAGING_MANIFEST,
} from './anvil-agent-edit.types';
import { createStagedEditWorkflow } from './anvil-agent-edit.workflow';

describe('staged repair cleanup', () => {
  it('resolves bugs, records history, removes ledger entries, and cleans artifacts', async () => {
    const bug = {
      bug_key: 'BUG-CSS-1',
      category: 'css-syntax',
      validator: 'css-validator',
      affected_files: ['src/app/App.css'],
      originating_run_id: 'run-1',
    };
    const listOpenBugs = jest.fn().mockResolvedValue([bug]);
    const resolveBug = jest.fn().mockResolvedValue(undefined);
    const completeRepairTransaction = jest.fn().mockResolvedValue(undefined);
    const appendHistoryEntry = jest.fn().mockResolvedValue(undefined);
    const removeBugEntry = jest.fn().mockResolvedValue(undefined);
    const cleanUp = jest.fn().mockResolvedValue(undefined);
    const stagingCleanup = jest.fn().mockResolvedValue(undefined);
    const writeManifest = jest.fn().mockResolvedValue(undefined);

    const workflow = createStagedEditWorkflow({
      anvilAgentEditService: { cleanUp } as never,
      anvilEditStagingService: {
        cleanup: stagingCleanup,
        writeManifest,
      } as never,
      anvilHistoryService: { appendHistoryEntry, removeBugEntry } as never,
      anvilRepairStateService: {
        listOpenBugs,
        resolveBug,
        completeRepairTransaction,
      } as never,
    });
    void workflow;

    const cleanupStep = mockSteps.find(
      (step) => step.id === 'anvil-edit-agent-staging-cleanup-transaction-step',
    );
    if (!cleanupStep?.execute) throw new Error('Cleanup step was not created');

    const manifest = {
      projectId: 'project-1',
      editRunId: 'edit-1',
      stagingRoot: '/tmp/staging',
      files: [
        {
          projectPath: 'src/app/App.css',
          localPath: '/tmp/staging/src/app/App.css',
          operation: 'edit',
          existedRemotely: true,
          originalHash: 'hash-1',
          backupPath: '.anvil-backups/edit-1/src/app/App.css',
          instructionIndexes: [],
          applied: true,
          verified: true,
          validationStatus: 'passed',
          commitStatus: 'uploaded',
          milestoneId: 'feature',
        },
      ],
      directoriesToCreate: [],
      createdDirectories: [],
      totalBytes: 1,
      fileCount: 1,
      structurePlan: null,
      milestones: [
        {
          id: 'feature',
          sequence: 0,
          filePaths: ['src/app/App.css'],
          dependsOn: [],
          status: 'committed',
          validationStatus: 'passed',
          commitStatus: 'committed',
        },
      ],
    } as unknown as STAGING_MANIFEST;
    const requestContext = new RequestContext<Record<string, unknown>>();
    requestContext.set('stagingManifest', manifest);
    requestContext.set('stagingWorkspace', { rootPath: '/tmp/staging' });
    requestContext.set('editTransactionId', 'transaction-1');
    requestContext.set('repairApprovalId', 'approval-1');

    await cleanupStep.execute({
      inputData: [] as EDIT_AGENT_INPUT,
      requestContext,
    });

    expect(resolveBug).toHaveBeenCalledWith('transaction-1', 'BUG-CSS-1');
    expect(appendHistoryEntry).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        bugId: 'BUG-CSS-1',
        repairRunId: 'approval-1',
        classification: 'resolved',
      }),
    );
    expect(removeBugEntry).toHaveBeenCalledWith('project-1', 'BUG-CSS-1');
    expect(completeRepairTransaction).toHaveBeenCalledWith('transaction-1');
    expect(cleanUp).toHaveBeenCalledWith(
      'project-1',
      '.anvil-backups/edit-1/src/app/App.css',
      '/tmp/staging/src/app/App.css',
    );
    expect(stagingCleanup).toHaveBeenCalled();
  });
});
