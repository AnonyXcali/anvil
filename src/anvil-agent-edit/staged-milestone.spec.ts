import {
  buildStagedMilestones,
  getMilestoneDirectories,
  getMilestoneFiles,
  getMilestoneRollbackFiles,
  getReadyMilestones,
} from './staged-milestone';
import type { FILE_EDIT, STAGED_FILE_ENTRY } from './anvil-agent-edit.types';

const edit = (file_path: string, depends_on: string[] = []) =>
  ({
    file_path,
    downloaded_local_file_path: null,
    backup_file: null,
    instructions: [],
    error: null,
    isEdited: false,
    hash: null,
    file_exists: false,
    file_type: 'component',
    architectural_role: 'feature-component',
    operation: 'create',
    depends_on,
    structure_plan: {
      feature_root: 'src/features/flowers',
      phases: [
        { id: 'shared', file_paths: ['src/shared/colors.css'] },
        { id: 'feature', file_paths: ['src/features/flowers/Flowers.tsx'] },
      ],
      directories_to_create: [],
      preserve: [],
      existing_paths: [],
    },
  }) as FILE_EDIT;

describe('staged milestones', () => {
  it('derives ordered milestones and cross-phase dependencies', () => {
    const milestones = buildStagedMilestones(
      edit('src/shared/colors.css').structure_plan,
      [
        edit('src/shared/colors.css'),
        edit('src/features/flowers/Flowers.tsx', ['src/shared/colors.css']),
      ],
    );

    expect(milestones.map(({ id }) => id)).toEqual(['shared', 'feature']);
    expect(milestones[1].dependsOn).toEqual(['shared']);
  });

  it('keeps independent passed milestones ready when another is repair-pending', () => {
    const milestones = buildStagedMilestones(
      edit('src/shared/colors.css').structure_plan,
      [edit('src/shared/colors.css'), edit('src/features/flowers/Flowers.tsx')],
    );
    milestones[0].validationStatus = 'repair_pending';
    milestones[1].validationStatus = 'passed';

    expect(getReadyMilestones(milestones).map(({ id }) => id)).toEqual([
      'feature',
    ]);
  });

  it('blocks a passed milestone whose prerequisite needs repair', () => {
    const milestones = buildStagedMilestones(
      edit('src/shared/colors.css').structure_plan,
      [
        edit('src/shared/colors.css'),
        edit('src/features/flowers/Flowers.tsx', ['src/shared/colors.css']),
      ],
    );
    milestones[0].validationStatus = 'repair_pending';
    milestones[1].validationStatus = 'passed';

    expect(getReadyMilestones(milestones)).toEqual([]);
  });

  it('scopes files, directories, and rollback to the active milestone', () => {
    const sharedFile = {
      projectPath: 'src/shared/tokens.css',
      milestoneId: 'shared',
    } as STAGED_FILE_ENTRY;
    const featureFile = {
      projectPath: 'src/features/flowers/Flowers.tsx',
      milestoneId: 'feature',
    } as STAGED_FILE_ENTRY;
    const attemptedFeatureFile = {
      projectPath: 'src/features/flowers/flowers.css',
      milestoneId: 'feature',
    } as STAGED_FILE_ENTRY;

    expect(getMilestoneFiles([sharedFile, featureFile], 'feature')).toEqual([
      featureFile,
    ]);
    expect(
      getMilestoneDirectories(
        ['src/shared', 'src/features', 'src/features/flowers'],
        [featureFile, attemptedFeatureFile],
      ),
    ).toEqual(['src/features', 'src/features/flowers']);
    expect(
      getMilestoneRollbackFiles(
        [sharedFile, featureFile],
        attemptedFeatureFile,
        'feature',
      ),
    ).toEqual([attemptedFeatureFile, featureFile]);
  });

  it('keeps a later failed milestone isolated from an earlier committed one', () => {
    const milestones = buildStagedMilestones(
      edit('src/shared/colors.css').structure_plan,
      [
        edit('src/shared/colors.css'),
        edit('src/features/flowers/Flowers.tsx', ['src/shared/colors.css']),
      ],
    );
    milestones[0].status = 'committed';
    milestones[0].validationStatus = 'passed';
    milestones[0].commitStatus = 'committed';
    milestones[1].status = 'failed';
    milestones[1].validationStatus = 'failed';
    milestones[1].commitStatus = 'rolled-back';

    expect(getReadyMilestones(milestones)).toEqual([]);
    expect(milestones[0]).toEqual(
      expect.objectContaining({
        id: 'shared',
        status: 'committed',
        commitStatus: 'committed',
      }),
    );
    expect(milestones[1]).toEqual(
      expect.objectContaining({
        id: 'feature',
        status: 'failed',
        commitStatus: 'rolled-back',
      }),
    );
  });

  it('allows an independent milestone to remain eligible while another fails', () => {
    const milestones = buildStagedMilestones(
      edit('src/shared/colors.css').structure_plan,
      [edit('src/shared/colors.css'), edit('src/features/flowers/Flowers.tsx')],
    );
    milestones[0].status = 'failed';
    milestones[0].validationStatus = 'failed';
    milestones[1].status = 'pending';
    milestones[1].validationStatus = 'passed';

    expect(getReadyMilestones(milestones).map(({ id }) => id)).toEqual([
      'feature',
    ]);
  });
});
