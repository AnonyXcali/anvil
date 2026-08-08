import { posix } from 'path';
import type { EDIT_AGENT_INPUT, FILE_EDIT } from './anvil-agent-edit.types';

export function normalizeStagedPath(value: string): string {
  return posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');
}

export function validateAndOrderStagedInput(
  inputData: EDIT_AGENT_INPUT,
): EDIT_AGENT_INPUT {
  const byPath = new Map<string, FILE_EDIT>();
  const originalIndex = new Map<string, number>();
  for (const [index, file] of inputData.entries()) {
    const normalized = normalizeStagedPath(file.file_path);
    if (
      !normalized ||
      posix.isAbsolute(normalized) ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`Invalid staged file path: ${file.file_path}`);
    }
    if (byPath.has(normalized)) {
      throw new Error(`Duplicate staged file path: ${file.file_path}`);
    }
    byPath.set(normalized, {
      ...file,
      file_path: normalized,
      depends_on: file.depends_on.map(normalizeStagedPath),
    });
    originalIndex.set(normalized, index);
  }

  const firstPlan = inputData[0]?.structure_plan;
  const canonicalPlan = JSON.stringify({
    ...firstPlan,
    phases: (firstPlan?.phases ?? []).map((phase) => ({
      ...phase,
      file_paths: phase.file_paths.map(normalizeStagedPath),
    })),
    directories_to_create: (firstPlan?.directories_to_create ?? []).map(
      normalizeStagedPath,
    ),
    preserve: (firstPlan?.preserve ?? []).map(normalizeStagedPath),
    existing_paths: (firstPlan?.existing_paths ?? []).map(normalizeStagedPath),
  });
  const existingPaths = new Set(
    (firstPlan?.existing_paths ?? []).map(normalizeStagedPath),
  );
  const stagedPaths = new Set(byPath.keys());
  for (const file of inputData) {
    const plan = file.structure_plan;
    const normalizedPlan = JSON.stringify({
      ...plan,
      phases: plan.phases.map((phase) => ({
        ...phase,
        file_paths: phase.file_paths.map(normalizeStagedPath),
      })),
      directories_to_create:
        plan.directories_to_create.map(normalizeStagedPath),
      preserve: plan.preserve.map(normalizeStagedPath),
      existing_paths: plan.existing_paths.map(normalizeStagedPath),
    });
    if (normalizedPlan !== canonicalPlan) {
      throw new Error('Structural plans are inconsistent across staged files');
    }
  }
  for (const directory of firstPlan?.directories_to_create ?? []) {
    const normalized = normalizeStagedPath(directory);
    if (
      !normalized ||
      posix.isAbsolute(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`Invalid staged directory path: ${directory}`);
    }
  }
  for (const phase of firstPlan?.phases ?? []) {
    for (const path of phase.file_paths) {
      const normalized = normalizeStagedPath(path);
      if (
        /\.[a-z0-9]+$/i.test(normalized) &&
        !stagedPaths.has(normalized) &&
        !existingPaths.has(normalized)
      ) {
        throw new Error(`Structural phase references unknown file: ${path}`);
      }
    }
  }
  for (const preserved of firstPlan?.preserve ?? []) {
    const normalized = normalizeStagedPath(preserved);
    const file = byPath.get(normalized);
    if (file && (file.operation === 'create' || file.operation === 'delete')) {
      throw new Error(
        `Preserved path cannot be created or deleted: ${preserved}`,
      );
    }
  }
  const plannedFilePaths = new Set(
    (firstPlan?.phases ?? []).flatMap((phase) =>
      phase.file_paths
        .map(normalizeStagedPath)
        .filter((path) => /\.[a-z0-9]+$/i.test(path)),
    ),
  );
  for (const stagedPath of stagedPaths) {
    if (!plannedFilePaths.has(stagedPath)) {
      throw new Error(
        `Structural plan does not include staged file: ${stagedPath}`,
      );
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: FILE_EDIT[] = [];
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    if (visiting.has(path)) {
      throw new Error(`Circular staged dependency detected at ${path}`);
    }
    const file = byPath.get(path);
    if (!file) return;
    visiting.add(path);
    for (const dependency of file.depends_on) {
      if (!byPath.has(dependency) && !existingPaths.has(dependency)) {
        throw new Error(
          `Missing staged dependency ${dependency} for ${file.file_path}`,
        );
      }
      if (byPath.has(dependency)) visit(dependency);
    }
    visiting.delete(path);
    visited.add(path);
    ordered.push(file);
  };
  [...byPath.keys()]
    .sort(
      (left, right) =>
        (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0),
    )
    .forEach(visit);
  return ordered;
}
