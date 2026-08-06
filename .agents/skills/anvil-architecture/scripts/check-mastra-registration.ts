import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../../../../');
const mastraRoot = join(root, 'src', 'mastra');
const registryPath = join(mastraRoot, 'index.ts');

const errors: string[] = [];
const registry = readFileSync(registryPath, 'utf8');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(directory, entry.name));
}

function sourceFiles(directory: string): string[] {
  return filesUnder(directory).filter((file) => !file.endsWith('.spec.ts'));
}

function exportedSymbols(source: string): string[] {
  return Array.from(
    source.matchAll(/export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z0-9_$]+)/g),
  ).map((match) => match[1]);
}

function duplicateIds(files: string[]): void {
  const ids = new Map<string, string[]>();

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)) {
      const locations = ids.get(match[1]) ?? [];
      locations.push(file);
      ids.set(match[1], locations);
    }
  }

  for (const [id, locations] of ids) {
    if (locations.length > 1) {
      errors.push(`duplicate Mastra id "${id}" in ${locations.join(', ')}`);
    }
  }
}

const agentFiles = sourceFiles(join(mastraRoot, 'agents')).filter(
  (file) => !file.endsWith('.prompt.ts'),
);
const workflowFiles = [
  ...sourceFiles(join(mastraRoot, 'workflows')),
  join(root, 'src', 'anvil-agent-supervisor', 'anvil-agent-supervisor.workflow.ts'),
  join(root, 'src', 'anvil-agent-edit', 'anvil-agent-edit.workflow.ts'),
];
const toolFiles = sourceFiles(join(mastraRoot, 'tools'));

duplicateIds([...agentFiles, ...workflowFiles]);

for (const file of agentFiles) {
  const source = readFileSync(file, 'utf8');
  for (const symbol of exportedSymbols(source)) {
    if (!registry.includes(symbol)) {
      errors.push(`agent export ${symbol} from ${file} is not referenced by src/mastra/index.ts`);
    }
  }
}

for (const file of workflowFiles) {
  const source = readFileSync(file, 'utf8');
  for (const symbol of exportedSymbols(source)) {
    if (!registry.includes(symbol)) {
      errors.push(`workflow export ${symbol} from ${file} is not referenced by src/mastra/index.ts`);
    }
  }
}

const registeredAgentSources = agentFiles
  .filter((file) => exportedSymbols(readFileSync(file, 'utf8')).some((symbol) => registry.includes(symbol)))
  .map((file) => readFileSync(file, 'utf8'));

for (const file of toolFiles) {
  const toolSource = readFileSync(file, 'utf8');
  const toolBase = file.slice(mastraRoot.length + 1, -3);
  const exposed = registeredAgentSources.some((agentSource) =>
    agentSource.includes(`../tools/${toolBase.split('/').pop()}`),
  );

  if (!exposed) {
    errors.push(`tool module ${file} is not exposed by a registered agent factory`);
  }
}

const scorerSources = [
  join(root, 'src', 'anvil-agent-edit', 'anvil-agent-edit.workflow.ts'),
  join(root, 'src', 'anvil-agent-supervisor', 'anvil-agent-supervisor.workflow.ts'),
].map((file) => readFileSync(file, 'utf8'));

for (const source of scorerSources) {
  if (source.includes('createRubricScorer') && !registry.includes('createEditWorkflow')) {
    errors.push('workflow-local scorer is unreachable because its workflow is not registered');
  }
}

if (errors.length > 0) {
  console.error('Mastra registration validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Mastra registration validation passed.');
}
