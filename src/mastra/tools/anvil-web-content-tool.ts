import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export function createAnvilWebContentTool(apiKey?: string) {
  return createTool({
    id: 'anvil-web-content-tool',
    description:
      'Read a public web page and return concise content for answering the user.',
    inputSchema: z.object({
      url: z.string(),
      prompt: z.string().max(500).optional(),
    }),
    outputSchema: z.object({
      url: z.string(),
      title: z.string().nullable(),
      content: z.string(),
      error: z.string().nullable(),
    }),
    execute: async ({ url, prompt }) => {
      if (!apiKey) {
        return {
          url,
          title: null,
          content: '',
          error: 'External web content is unavailable.',
        };
      }

      try {
        const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            formats: ['markdown'],
            ...(prompt ? { onlyMainContent: true, prompt } : {}),
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (!response.ok) {
          return {
            url,
            title: null,
            content: '',
            error: `Web content request failed (${response.status}).`,
          };
        }

        const payload = (await response.json()) as {
          success?: boolean;
          data?: { markdown?: string; metadata?: { title?: string } };
          error?: string;
        };

        return {
          url,
          title: payload.data?.metadata?.title ?? null,
          content: (payload.data?.markdown ?? '').slice(0, 12000),
          error:
            payload.success === false
              ? (payload.error ?? 'Scrape failed.')
              : null,
        };
      } catch (error) {
        return {
          url,
          title: null,
          content: '',
          error: error instanceof Error ? error.message : 'Web content failed.',
        };
      }
    },
  });
}
