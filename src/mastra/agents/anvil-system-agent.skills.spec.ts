import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Anvil system agent skills', () => {
  it('ships every skill directory with a valid SKILL.md', () => {
    const skillNames = [
      'search-tool-playbook',
      'frontend-project-structure',
      'architecture-history',
      'css-tsx-analysis',
      'structural-edit-planning',
    ];

    for (const skillName of skillNames) {
      const skillPath = resolve(process.cwd(), 'mastra-skills', skillName);
      const skillFile = resolve(skillPath, 'SKILL.md');

      expect(existsSync(skillFile)).toBe(true);
      expect(readFileSync(skillFile, 'utf8')).toContain(`name: ${skillName}`);
    }
  });

  it('attaches the bundled skills to the active system agent', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/mastra/agents/anvil-system-agent.ts'),
      'utf8',
    );

    expect(source).toContain('skills: ANVIL_SEARCH_SKILLS');
  });

  it('keeps the finalizer tool-free', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/mastra/agents/anvil-system-agent.ts'),
      'utf8',
    );
    const finalizerSection = source.slice(
      source.indexOf('export function createAnvilSearchFinalizerAgent'),
    );

    expect(finalizerSection).not.toContain('tools:');
    expect(finalizerSection).not.toContain('skills:');
  });
});
