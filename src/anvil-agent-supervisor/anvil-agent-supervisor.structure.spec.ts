import {
  sortFilesByDependencies,
  validateStructurePlan,
} from './structural-ordering';
import type {
  FINAL_RESPONSE_SHAPE,
  STRUCTURE_PLAN,
} from 'src/anvil-agent/anvil-agent.types';

const plan: STRUCTURE_PLAN = {
  feature_root: 'src/features/catalog',
  phases: [],
  directories_to_create: ['src/features/catalog'],
  preserve: ['src/app/App.tsx'],
  existing_paths: [],
};

function file(
  file_path: string,
  depends_on: string[] = [],
): FINAL_RESPONSE_SHAPE {
  return {
    file_path,
    line_range: { startRange: 1, endRange: 1 },
    file_exists: true,
    action_tokens: ['replace'],
    precise_instruction: 'edit',
    code: 'content',
    patch: null,
    file_type: 'component',
    architectural_role: 'feature-component',
    operation: 'edit',
    depends_on,
  };
}

describe('supervisor structural ordering', () => {
  it('orders prerequisites before dependent files while preserving stable order', () => {
    const stylesheet = file('src/features/catalog/catalog.css');
    const component = file('src/features/catalog/Catalog.tsx', [
      stylesheet.file_path,
    ]);

    expect(
      sortFilesByDependencies([component, stylesheet]).map(
        (item) => item.file_path,
      ),
    ).toEqual([stylesheet.file_path, component.file_path]);
  });

  it('reports a direct self-dependency', () => {
    const self = file('src/app/App.tsx', ['src/app/App.tsx']);

    expect(() => sortFilesByDependencies([self])).toThrow(
      'Self-referencing structural dependency: src/app/App.tsx → src/app/App.tsx',
    );
  });

  it('reports a two-file cycle', () => {
    const first = file('src/a.tsx', ['src/b.tsx']);
    const second = file('src/b.tsx', ['src/a.tsx']);

    expect(() => sortFilesByDependencies([first, second])).toThrow(
      'Circular structural dependency: src/a.tsx → src/b.tsx → src/a.tsx',
    );
  });

  it('reports a three-file cycle', () => {
    const first = file('src/a.tsx', ['src/b.tsx']);
    const second = file('src/b.tsx', ['src/c.tsx']);
    const third = file('src/c.tsx', ['src/a.tsx']);

    expect(() => sortFilesByDependencies([first, second, third])).toThrow(
      'Circular structural dependency: src/a.tsx → src/b.tsx → src/c.tsx → src/a.tsx',
    );
  });

  it('reports the cycle from the repeated node when unrelated files precede it', () => {
    const unrelated = file('src/unrelated.tsx');
    const first = file('src/a.tsx', ['src/b.tsx']);
    const second = file('src/b.tsx', ['src/c.tsx']);
    const third = file('src/c.tsx', ['src/b.tsx']);

    expect(() =>
      sortFilesByDependencies([unrelated, first, second, third]),
    ).toThrow(
      'Circular structural dependency: src/b.tsx → src/c.tsx → src/b.tsx',
    );
  });

  it('rejects unknown dependencies unless they are known existing paths', () => {
    const target = file('src/a.tsx', ['src/missing.css']);
    expect(() => validateStructurePlan([target], plan)).toThrow(
      'Missing structural dependency',
    );

    expect(() =>
      validateStructurePlan([target], {
        ...plan,
        existing_paths: ['src/missing.css'],
      }),
    ).not.toThrow();
  });
});
