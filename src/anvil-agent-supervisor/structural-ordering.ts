import type {
  FINAL_RESPONSE_SHAPE,
  STRUCTURE_PLAN,
} from 'src/anvil-agent/anvil-agent.types';

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function validateStructurePlan(
  files: FINAL_RESPONSE_SHAPE[],
  plan: STRUCTURE_PLAN,
): void {
  const filePaths = new Set(files.map((file) => normalizePath(file.file_path)));
  const existingPaths = new Set(plan.existing_paths.map(normalizePath));

  for (const directory of plan.directories_to_create) {
    const normalized = normalizePath(directory);
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`Invalid structural directory path: ${directory}`);
    }
  }

  for (const file of files) {
    for (const dependency of file.depends_on) {
      const normalizedDependency = normalizePath(dependency);
      if (
        !normalizedDependency ||
        normalizedDependency.startsWith('/') ||
        normalizedDependency.split('/').includes('..') ||
        (!filePaths.has(normalizedDependency) &&
          !existingPaths.has(normalizedDependency))
      ) {
        throw new Error(
          `Missing structural dependency ${dependency} for ${file.file_path}`,
        );
      }
    }
  }
}

export function sortFilesByDependencies(
  files: FINAL_RESPONSE_SHAPE[],
): FINAL_RESPONSE_SHAPE[] {
  const byPath = new Map(
    files.map((file) => [normalizePath(file.file_path), file]),
  );
  const originalIndex = new Map(
    files.map((file, index) => [normalizePath(file.file_path), index]),
  );
  const visiting = new Set<string>();
  const traversalStack: string[] = [];
  const visited = new Set<string>();
  const sorted: FINAL_RESPONSE_SHAPE[] = [];

  const visit = (filePath: string): void => {
    if (visited.has(filePath)) return;
    if (visiting.has(filePath)) {
      const cycleStart = traversalStack.indexOf(filePath);
      const cycle = [
        ...(cycleStart >= 0 ? traversalStack.slice(cycleStart) : [filePath]),
        filePath,
      ];
      const cycleMessage = cycle.join(' → ');
      if (cycle.length === 2) {
        throw new Error(
          `Self-referencing structural dependency: ${cycleMessage}`,
        );
      }
      throw new Error(`Circular structural dependency: ${cycleMessage}`);
    }
    const file = byPath.get(filePath);
    if (!file) return;
    visiting.add(filePath);
    traversalStack.push(filePath);
    [...file.depends_on]
      .map(normalizePath)
      .filter((dependency) => byPath.has(dependency))
      .sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0))
      .forEach(visit);
    traversalStack.pop();
    visiting.delete(filePath);
    visited.add(filePath);
    sorted.push(file);
  };

  files.forEach((file) => visit(normalizePath(file.file_path)));
  return sorted;
}
