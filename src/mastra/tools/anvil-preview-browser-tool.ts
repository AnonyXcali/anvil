import { createTool } from '@mastra/core/tools';
import { chromium, type BrowserContext } from 'playwright-core';
import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Only HTTP and HTTPS preview URLs are supported.',
  });

export function createAnvilPreviewBrowserTool(
  apiKey?: string,
  endpoint?: string,
) {
  return createTool({
    id: 'anvil-preview-browser-tool',
    description:
      'Inspect the current rendered application for the active Anvil project.',
    inputSchema: z.object({
      previewUrl: httpUrl,
      route: z.string().regex(/^\//).optional(),
    }),
    outputSchema: z.object({
      url: z.string().nullable(),
      title: z.string().nullable(),
      headings: z.array(z.string()),
      visibleText: z.string(),
      errors: z.array(z.string()),
      error: z.string().nullable(),
    }),
    execute: async ({ previewUrl, route = '/' }) => {
      let browser:
        | Awaited<ReturnType<typeof chromium.connectOverCDP>>
        | undefined;
      let browserContext: BrowserContext | undefined;

      try {
        if (!apiKey || !endpoint) {
          throw new Error('Preview browser is not configured.');
        }

        const baseUrl = new URL(previewUrl);
        const targetUrl = new URL(route, baseUrl);

        if (targetUrl.origin !== baseUrl.origin) {
          throw new Error(
            'Preview browser navigation is restricted to the project preview.',
          );
        }

        const browserEndpoint = new URL(endpoint);
        if (!browserEndpoint.searchParams.has('token')) {
          browserEndpoint.searchParams.set('token', apiKey);
        }

        browser = await chromium.connectOverCDP(browserEndpoint.toString(), {
          timeout: 10000,
        });
        browserContext = await browser.newContext();
        const page = await browserContext.newPage();
        const errors: string[] = [];

        await page.route('**/*', async (routeRequest) => {
          const request = routeRequest.request();
          const requestUrl = new URL(request.url());

          if (
            request.isNavigationRequest() &&
            requestUrl.origin !== baseUrl.origin
          ) {
            await routeRequest.abort('blockedbyclient');
            return;
          }

          await routeRequest.continue();
        });

        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });

        await page.goto(targetUrl.toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 10000,
        });

        const headings = await page.locator('h1,h2,h3').allTextContents();
        const visibleText = (await page.locator('body').innerText()).slice(
          0,
          8000,
        );
        const title = await page.title();

        return {
          url: targetUrl.toString(),
          title,
          headings: headings.map((heading) => heading.trim()).filter(Boolean),
          visibleText,
          errors: errors.slice(0, 20),
          error: null,
        };
      } catch (error) {
        return {
          url: null,
          title: null,
          headings: [],
          visibleText: '',
          errors: [],
          error:
            error instanceof Error
              ? error.message
              : 'Preview inspection failed.',
        };
      } finally {
        await browserContext?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
      }
    },
  });
}
