import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const Z_WEB_SEARCH_RESULT = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export function createAnvilWebSearchTool(apiKey?: string) {
  return createTool({
    id: 'anvil-web-search-tool',
    description:
      'Find relevant public web pages for questions about Anvil or current external information.',
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(5).optional(),
    }),
    outputSchema: z.object({
      results: z.array(Z_WEB_SEARCH_RESULT),
      error: z.string().nullable(),
    }),
    execute: async ({ query, limit = 3 }) => {
      if (!apiKey) {
        return { results: [], error: 'External web search is unavailable.' };
      }

      try {
        const response = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            query,
            type: 'auto',
            numResults: limit,
            contents: { highlights: { maxCharacters: 500 } },
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
          return {
            results: [],
            error: `Web search failed (${response.status}).`,
          };
        }

        const payload = (await response.json()) as {
          results?: Array<{
            title?: string;
            url?: string;
            highlights?: string[];
            text?: string;
          }>;
        };

        return {
          results: (payload.results ?? []).slice(0, limit).map((result) => ({
            title: result.title ?? result.url ?? 'Untitled result',
            url: result.url ?? '',
            snippet: (result.highlights?.[0] ?? result.text ?? '').slice(
              0,
              500,
            ),
          })),
          error: null,
        };
      } catch (error) {
        return {
          results: [],
          error: error instanceof Error ? error.message : 'Web search failed.',
        };
      }
    },
  });
}
