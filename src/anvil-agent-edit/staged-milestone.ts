import type { STRUCTURE_PLAN } from 'src/anvil-agent/anvil-agent.types';
import type {
  FILE_EDIT,
  STAGED_FILE_ENTRY,
  STAGED_MILESTONE,
} from './anvil-agent-edit.types';

export function buildStagedMilestones(
  plan: STRUCTURE_PLAN | null,
  edits: FILE_EDIT[],
): STAGED_MILESTONE[] {
  const phases = plan?.phases ?? [];
  const phaseByFile = new Map<string, string>();
  phases.forEach((phase) =>
    phase.file_paths.forEach((filePath) => phaseByFile.set(filePath, phase.id)),
  );

  const milestones = phases
    .map((phase, sequence) => {
      const filePaths = phase.file_paths.filter((filePath) =>
        edits.some((edit) => edit.file_path === filePath),
      );
      const dependsOn = new Set<string>();
      for (const edit of edits.filter((item) =>
        filePaths.includes(item.file_path),
      )) {
        for (const dependency of edit.depends_on) {
          const dependencyPhase = phaseByFile.get(dependency);
          if (dependencyPhase && dependencyPhase !== phase.id) {
            dependsOn.add(dependencyPhase);
          }
        }
      }
      return {
        id: phase.id,
        sequence,
        filePaths,
        dependsOn: [...dependsOn],
        status: 'pending',
        validationStatus: 'pending',
        commitStatus: 'pending',
      } satisfies STAGED_MILESTONE;
    })
    .filter((milestone) => milestone.filePaths.length > 0);

  if (milestones.length > 0 || edits.length === 0) return milestones;
  return [
    {
      id: 'unplanned',
      sequence: 0,
      filePaths: edits.map((edit) => edit.file_path),
      dependsOn: [],
      status: 'pending',
      validationStatus: 'pending',
      commitStatus: 'pending',
    },
  ];
}

export function getReadyMilestones(
  milestones: STAGED_MILESTONE[],
): STAGED_MILESTONE[] {
  const byId = new Map(
    milestones.map((milestone) => [milestone.id, milestone]),
  );
  return milestones
    .filter((milestone) => milestone.validationStatus === 'passed')
    .filter((milestone) => milestone.status === 'pending')
    .filter((milestone) =>
      milestone.dependsOn.every((dependency) => {
        const prerequisite = byId.get(dependency);
        return (
          prerequisite &&
          prerequisite.validationStatus === 'passed' &&
          prerequisite.status !== 'repair_pending' &&
          prerequisite.status !== 'blocked' &&
          prerequisite.status !== 'failed'
        );
      }),
    )
    .sort((left, right) => left.sequence - right.sequence);
}

export function assignMilestone(
  milestones: STAGED_MILESTONE[],
  entry: STAGED_FILE_ENTRY,
): string | null {
  return (
    milestones.find((milestone) =>
      milestone.filePaths.includes(entry.projectPath),
    )?.id ?? null
  );
}

export function getMilestoneFiles(
  files: STAGED_FILE_ENTRY[],
  milestoneId: string,
): STAGED_FILE_ENTRY[] {
  return files.filter((file) => file.milestoneId === milestoneId);
}

export function getMilestoneDirectories(
  directories: string[],
  files: STAGED_FILE_ENTRY[],
): string[] {
  return directories
    .filter((directory) =>
      files.some(
        (file) =>
          file.projectPath === directory ||
          file.projectPath.startsWith(`${directory}/`),
      ),
    )
    .sort((left, right) => left.split('/').length - right.split('/').length);
}

export function getMilestoneRollbackFiles(
  committed: STAGED_FILE_ENTRY[],
  attempted: STAGED_FILE_ENTRY | undefined,
  milestoneId: string,
): STAGED_FILE_ENTRY[] {
  return [
    ...committed.filter((file) => file.milestoneId === milestoneId),
    ...(attempted?.milestoneId === milestoneId ? [attempted] : []),
  ].reverse();
}
