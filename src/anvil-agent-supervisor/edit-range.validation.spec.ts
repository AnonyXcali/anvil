import { validateCompressedFileLineRange } from './edit-range.validation';

describe('compressed edit line-range contract', () => {
  it('accepts add with the 0 to 0 sentinel', () => {
    expect(() =>
      validateCompressedFileLineRange(
        'src/features/flowers/data/flowers.ts',
        ['add'],
        { startRange: 0, endRange: 0 },
      ),
    ).not.toThrow();
  });

  it('rejects add with a positive range', () => {
    expect(() =>
      validateCompressedFileLineRange(
        'src/features/flowers/data/flowers.ts',
        ['add'],
        { startRange: 1, endRange: 20 },
      ),
    ).toThrow(
      'add for src/features/flowers/data/flowers.ts must use line range 0 to 0',
    );
  });

  it('accepts the whole-file sentinel for patch', () => {
    expect(() =>
      validateCompressedFileLineRange('src/app/App.tsx', ['patch'], {
        startRange: 0,
        endRange: 0,
      }),
    ).not.toThrow();
  });

  it('accepts the whole-file sentinel for replace_file', () => {
    expect(() =>
      validateCompressedFileLineRange('src/app/App.tsx', ['replace_file'], {
        startRange: 0,
        endRange: 0,
      }),
    ).not.toThrow();
  });

  it.each(['import', 'replace', 'delete'])(
    'requires a positive range for %s',
    (token) => {
      expect(() =>
        validateCompressedFileLineRange(
          'src/app/App.tsx',
          [token as 'import' | 'replace' | 'delete'],
          { startRange: 1, endRange: 20 },
        ),
      ).not.toThrow();
    },
  );
});
