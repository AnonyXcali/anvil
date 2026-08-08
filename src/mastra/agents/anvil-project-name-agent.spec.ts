import { ProjectNameSchema } from 'src/project/project-name.types';

describe('ProjectNameSchema', () => {
  it('accepts concise project names and trims surrounding whitespace', () => {
    expect(ProjectNameSchema.parse({ name: '  Lemon Landing  ' })).toEqual({
      name: 'Lemon Landing',
    });
  });

  it('rejects empty names', () => {
    expect(ProjectNameSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});
