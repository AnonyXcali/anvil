import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(__dirname, '../../../../');
const srcRoot = join(root, 'src');
const errors: string[] = [];

function allTsFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return allTsFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function resolveImport(file: string, specifier: string): string | null {
  let candidate = specifier.startsWith('src/')
    ? join(root, specifier)
    : resolve(dirname(file), specifier);

  if (extname(candidate) !== '.ts') candidate += '.ts';
  return candidate.startsWith(srcRoot) ? normalize(candidate) : null;
}

function moduleName(file: string): string {
  return relative(srcRoot, file).split('/')[0] ?? '';
}

const files = allTsFiles(srcRoot);
const graph = new Map<string, Set<string>>();

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const dependencies = new Set<string>();

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const imported = resolveImport(file, statement.moduleSpecifier.text);
    if (imported && files.includes(imported)) dependencies.add(imported);
  }

  graph.set(file, dependencies);
}

const forbidden: Array<[string, string, string]> = [
  ['db', 'core', 'database infrastructure must not import application orchestration'],
  ['db', 'mastra', 'database infrastructure must not import Mastra orchestration'],
  ['sharedredis', 'core', 'shared Redis infrastructure must not import application orchestration'],
  ['sharedredis', 'mastra', 'shared Redis infrastructure must not import Mastra orchestration'],
  ['ssh', 'core', 'SSH infrastructure must not import application orchestration'],
  ['ssh', 'mastra', 'SSH infrastructure must not import Mastra orchestration'],
  ['types', 'core', 'shared types must not import feature orchestration'],
  ['types', 'mastra', 'shared types must not import Mastra orchestration'],
];

for (const [file, dependencies] of graph) {
  for (const dependency of dependencies) {
    const from = moduleName(file);
    const to = moduleName(dependency);
    const rule = forbidden.find(([source, target]) => source === from && target === to);
    if (rule) errors.push(`${file} imports ${dependency}: ${rule[2]}`);
  }
}

const visiting = new Set<string>();
const visited = new Set<string>();
const pathStack: string[] = [];
const reportedCycles = new Set<string>();

function visit(file: string): void {
  if (visiting.has(file)) {
    const start = pathStack.indexOf(file);
    const cycle = [...pathStack.slice(start), file].map((item) => relative(root, item)).join(' -> ');
    if (!reportedCycles.has(cycle)) {
      reportedCycles.add(cycle);
      errors.push(`circular internal dependency: ${cycle}`);
    }
    return;
  }
  if (visited.has(file)) return;

  visiting.add(file);
  pathStack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  pathStack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of files) visit(file);

if (errors.length > 0) {
  console.error('Module boundary validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Module boundary validation passed.');
}
