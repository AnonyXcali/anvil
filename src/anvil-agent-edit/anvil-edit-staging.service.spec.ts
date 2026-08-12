import { mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  AnvilEditStagingService,
  MAX_STAGED_FILE_COUNT,
} from './anvil-edit-staging.service';

describe('AnvilEditStagingService', () => {
  let service: AnvilEditStagingService;
  let workspace: Awaited<
    ReturnType<AnvilEditStagingService['createWorkspace']>
  >;

  beforeEach(async () => {
    service = new AnvilEditStagingService();
    workspace = await service.createWorkspace(
      `staging-test-${Date.now()}`,
      `run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
  });

  afterEach(async () => {
    await service.cleanup(workspace);
  });

  it('isolates project paths below a job-scoped workspace', async () => {
    const localPath = await service.writeFile(
      workspace,
      'src/features/Card.tsx',
      'export const Card = () => null;',
    );

    expect(localPath).toBe(
      join(workspace.rootPath, 'src', 'features', 'Card.tsx'),
    );
    await expect(
      service.readFile(workspace, './src/features/Card.tsx'),
    ).resolves.toEqual(Buffer.from('export const Card = () => null;'));
  });

  it.each(['../outside.tsx', '/absolute.tsx', 'src/../../outside.tsx'])(
    'rejects traversal path %s',
    async (projectPath) => {
      await expect(
        service.writeFile(workspace, projectPath, 'unsafe'),
      ).rejects.toThrow();
    },
  );

  it('rejects symlinked staging paths', async () => {
    const outsideDirectory = await mkdtemp(
      join(process.cwd(), 'temp', 'outside-'),
    );
    const linkedDirectory = join(workspace.rootPath, 'linked');
    await symlink(outsideDirectory, linkedDirectory, 'junction');

    await expect(
      service.writeFile(workspace, 'linked/file.tsx', 'unsafe'),
    ).rejects.toThrow('symbolic links');

    await rm(outsideDirectory, { recursive: true, force: true });
  });

  it('preserves the original file when the byte limit is exceeded', async () => {
    const original = 'original';
    await service.writeFile(workspace, 'src/file.ts', original);
    const originalTotal = workspace.totalBytes;
    workspace.totalBytes = Number.MAX_SAFE_INTEGER;

    await expect(
      service.writeFile(workspace, 'src/file.ts', 'replacement'),
    ).rejects.toThrow('Staging byte limit exceeded');
    await expect(service.readFile(workspace, 'src/file.ts')).resolves.toEqual(
      Buffer.from(original),
    );
    workspace.totalBytes = originalTotal;
  });

  it('tracks replacement and deletion sizes', async () => {
    await service.writeFile(workspace, 'src/file.ts', 'one');
    expect(workspace.totalBytes).toBe(3);
    await service.writeFile(workspace, 'src/file.ts', 'three');
    expect(workspace.totalBytes).toBe(5);
    await service.deleteFile(workspace, './src/file.ts');
    expect(workspace.totalBytes).toBe(0);
    await expect(service.readFile(workspace, 'src/file.ts')).rejects.toThrow(
      'Staging file does not exist',
    );
  });

  it('rejects a source symlink when copying into staging', async () => {
    const sourceDirectory = await mkdtemp(
      join(process.cwd(), 'temp', 'source-'),
    );
    const sourceFile = join(sourceDirectory, 'source.ts');
    const sourceLink = join(sourceDirectory, 'link.ts');
    await writeFile(sourceFile, 'content', 'utf8');
    await symlink(sourceFile, sourceLink);

    await expect(
      service.copyFile(workspace, 'src/copied.ts', sourceLink),
    ).rejects.toThrow('regular file');

    await rm(sourceDirectory, { recursive: true, force: true });
  });

  it('cleans the entire job workspace', async () => {
    const rootPath = workspace.rootPath;
    await service.writeFile(workspace, 'src/file.ts', 'content');
    await service.cleanup(workspace);

    await expect(readFile(join(rootPath, 'src/file.ts'))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    );
  });

  it('discovers a preserved manifest that can be reopened after a restart', async () => {
    await service.writeFile(
      workspace,
      'src/features/flowers/Flowers.tsx',
      'export const Flowers = () => null;',
    );
    await service.writeManifest(workspace, {
      projectId: workspace.projectId,
      editRunId: workspace.editRunId,
      stagingRoot: workspace.rootPath,
      files: [
        {
          projectPath: 'src/features/flowers/Flowers.tsx',
          localPath: join(
            workspace.rootPath,
            'src/features/flowers/Flowers.tsx',
          ),
          operation: 'create',
          existedRemotely: false,
          originalHash: null,
          backupPath: null,
          instructionIndexes: [],
          applied: true,
          verified: false,
          validationStatus: 'repair_pending',
          commitStatus: 'pending',
          milestoneId: 'feature',
        },
      ],
      directoriesToCreate: ['src/features/flowers'],
      createdDirectories: [],
      milestones: [
        {
          id: 'feature',
          sequence: 0,
          filePaths: ['src/features/flowers/Flowers.tsx'],
          dependsOn: [],
          status: 'repair_pending',
          validationStatus: 'repair_pending',
          commitStatus: 'not-committed',
        },
      ],
      totalBytes: workspace.totalBytes,
    });
    await utimes(workspace.rootPath, new Date(0), new Date(0));

    const [abandoned] = await service.findAbandonedWorkspaces(-1);
    expect(abandoned?.manifest.milestones[0]?.status).toBe('repair_pending');
    expect(abandoned?.manifest.files[0]?.milestoneId).toBe('feature');

    const reopened = await service.openWorkspace(
      workspace.projectId,
      workspace.editRunId,
      workspace.rootPath,
    );
    await expect(
      service.readFile(reopened, 'src/features/flowers/Flowers.tsx'),
    ).resolves.toEqual(Buffer.from('export const Flowers = () => null;'));
  });

  it(`defines the agreed hard file limit of ${MAX_STAGED_FILE_COUNT}`, () => {
    expect(MAX_STAGED_FILE_COUNT).toBe(500);
  });
});
