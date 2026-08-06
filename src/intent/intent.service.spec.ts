jest.mock('@mastra/nestjs', () => ({ MastraService: class MastraService {} }));

import { MastraService } from '@mastra/nestjs';
import { IntentService } from './intent.service';
import { IntentClassificationSchema } from './intent.types';

function createDb(
  rows: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    message: string;
  }>,
) {
  const execute = jest.fn().mockResolvedValue(rows);
  const orderBy = jest.fn().mockReturnValue({ execute });
  const where = jest.fn().mockReturnValue({ orderBy });
  const select = jest.fn().mockReturnValue({ where });
  const selectFrom = jest.fn().mockReturnValue({ select });

  return { selectFrom, query: { execute, orderBy } };
}

describe('IntentService', () => {
  it('passes ordered history and includes the current query once', async () => {
    const db = createDb([
      { role: 'assistant', message: 'Earlier answer' },
      { role: 'user', message: 'Current question' },
    ]);
    const generate = jest
      .fn()
      .mockResolvedValue({ object: { intent: 'instant' } });
    const service = new IntentService(
      db as never,
      {
        getAgent: jest.fn().mockReturnValue({ generate }),
      } as unknown as MastraService,
    );

    await expect(
      service.classifyIntent('Current question', 'conversation-1'),
    ).resolves.toBe('instant');
    expect(db.query.orderBy).toHaveBeenCalledWith('sequence_number', 'asc');
    expect(generate).toHaveBeenCalledWith(
      [
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Current question' },
      ],
      { structuredOutput: { schema: IntentClassificationSchema } },
    );
  });

  it('appends the current query when it is not already the latest stored message', async () => {
    const db = createDb([{ role: 'user', message: 'Previous question' }]);
    const generate = jest
      .fn()
      .mockResolvedValue({ object: { intent: 'offload' } });
    const service = new IntentService(
      db as never,
      {
        getAgent: jest.fn().mockReturnValue({ generate }),
      } as unknown as MastraService,
    );

    await expect(
      service.classifyIntent('Create a dashboard', 'conversation-1'),
    ).resolves.toBe('offload');
    const firstCall = generate.mock.calls[0] as unknown[];
    expect(firstCall[0]).toEqual([
      { role: 'user', content: 'Previous question' },
      { role: 'user', content: 'Create a dashboard' },
    ]);
  });

  it.each(['instant', 'offload', 'unknown'] as const)(
    'returns structured %s classification',
    async (intent) => {
      const service = new IntentService(
        createDb([]) as never,
        {
          getAgent: jest.fn().mockReturnValue({
            generate: jest.fn().mockResolvedValue({ object: { intent } }),
          }),
        } as unknown as MastraService,
      );

      await expect(
        service.classifyIntent('query', 'conversation-1'),
      ).resolves.toBe(intent);
    },
  );

  it('turns malformed or failed agent output into unknown', async () => {
    const service = new IntentService(
      createDb([]) as never,
      {
        getAgent: jest.fn().mockReturnValue({
          generate: jest
            .fn()
            .mockResolvedValue({ object: { intent: 'invalid' } }),
        }),
      } as unknown as MastraService,
    );

    await expect(
      service.classifyIntent('query', 'conversation-1'),
    ).resolves.toBe('unknown');
  });
});
