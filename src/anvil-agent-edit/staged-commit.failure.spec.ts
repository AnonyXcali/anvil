jest.mock('@mastra/core/workflows', () => {
  return {
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
  };
});
jest.mock('@mastra/evals/scorers/prebuilt', () => ({
  createRubricScorer: jest.fn(),
}));

import { RequestContext } from '@mastra/core/request-context';
import type {
  EDIT_AGENT_INPUT,
  STAGED_MILESTONE,
  STAGING_MANIFEST,
} from './anvil-agent-edit.types';
import { createStagedEditWorkflow } from './anvil-agent-edit.workflow';

type MockStep = {
  id?: string;
  execute?: (context: unknown) => unknown;
};

const mockSteps: MockStep[] = [];

const file = (projectPath: string, milestoneId: string) => ({
  projectPath,
  localPath: `/workspace/${projectPath}`,
  operation: 'edit' as const,
  existedRemotely: true,
  originalHash: `hash-${projectPath}`,
  backupPath: null,
  instructionIndexes: [],
  applied: true,
  verified: true,
  validationStatus: 'passed' as const,
  commitStatus: 'pending' as const,
  milestoneId,
});

const milestone = (id: string, sequence: number): STAGED_MILESTONE => ({
  id,
  sequence,
  filePaths: [`src/${id}.tsx`],
  dependsOn: [],
  status: 'pending',
  validationStatus: 'passed',
  commitStatus: 'pending',
});

describe('staged commit failure isolation', () => {
  it('keeps phase one committed and rolls back only phase two after upload failure', async () => {
    const first = file('src/phase-one.tsx', 'phase-one');
    const second = file('src/phase-two.tsx', 'phase-two');
    const manifest: STAGING_MANIFEST = {
      projectId: 'project-1',
      editRunId: 'edit-1',
      stagingRoot: '/tmp/staging',
      files: [first, second],
      directoriesToCreate: [],
      createdDirectories: [],
      totalBytes: 0,
      fileCount: 2,
      structurePlan: null,
      milestones: [milestone('phase-one', 0), milestone('phase-two', 1)],
    };
    const uploadCalls: Array<[string, string, string, string]> = [];
    let uploadCount = 0;
    const upload = jest.fn(
      (...args: [string, string, string, string]): Promise<void> => {
        uploadCalls.push(args);
        uploadCount += 1;
        return uploadCount === 2
          ? Promise.reject(new Error('phase two upload failed'))
          : Promise.resolve();
      },
    );
    const restore = jest.fn().mockResolvedValue(undefined);
    const service = {
      getProjectFileState: jest
        .fn()
        .mockImplementation((_project: string, path: string) => ({
          exists: true,
          hash: `hash-${path}`,
        })),
      createCommitBackup: jest
        .fn()
        .mockImplementation(
          (_project: string, path: string) => `.anvil-backups/edit-1/${path}`,
        ),
      upload,
      restore,
      verifyProjectFolderExists: jest.fn().mockResolvedValue(true),
      removeEmptyCreatedDirectory: jest.fn(),
      removeCreatedProjectFile: jest.fn(),
      createProjectFolder: jest.fn(),
      createProjectFile: jest.fn(),
      deleteProjectFile: jest.fn(),
    };
    const writeManifest = jest.fn().mockResolvedValue(undefined);
    const requestContext = new RequestContext<Record<string, unknown>>();
    requestContext.set('projectId', 'project-1');
    requestContext.set('stagingManifest', manifest);
    requestContext.set('stagingWorkspace', { rootPath: '/tmp/staging' });

    const deps = {
      anvilAgentEditService: service as never,
      anvilEditStagingService: { writeManifest } as never,
      anvilHistoryService: {} as never,
      anvilRepairStateService: {} as never,
    };
    createStagedEditWorkflow(deps);

    const commitStep = mockSteps.find(
      (candidate) =>
        candidate.id === 'anvil-edit-agent-staging-commit-files-step',
    );
    expect(commitStep).toBeDefined();

    if (!commitStep?.execute) throw new Error('Commit step was not created');
    await expect(
      commitStep.execute({
        inputData: [] as EDIT_AGENT_INPUT,
        state: [],
        requestContext,
      }),
    ).rejects.toThrow('phase two upload failed');

    expect(upload).toHaveBeenCalledTimes(2);
    expect(uploadCalls[0]?.[1]).toBe(first.localPath);
    expect(uploadCalls[1]?.[1]).toBe(second.localPath);
    expect(first.commitStatus).toBe('uploaded');
    expect(manifest.milestones[0]?.status).toBe('committed');
    expect(manifest.milestones[0]?.commitStatus).toBe('committed');
    expect(second.commitStatus).toBe('rolled-back');
    expect(manifest.milestones[1]?.status).toBe('pending');
    expect(manifest.milestones[1]?.commitStatus).toBe('rolled-back');
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(
      'project-1',
      '.anvil-backups/edit-1/src/phase-two.tsx',
      'src/phase-two.tsx',
    );
    expect(writeManifest).toHaveBeenCalled();
  });
});
