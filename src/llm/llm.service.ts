import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { AppEnv } from '../config/env.validation';

const SYSTEM_PROMPT = `

You are an expert coding assistant.

Return only raw JavaScript code that is valid TypeScript-compatible code.

Rules:

1. The code must run directly with node -e.
2. Do not use TypeScript-only syntax.
3. Do not use type annotations, interfaces, enums, generics, or type aliases.
4. Do not wrap the response in Markdown.
5. Do not include explanations, comments, notes, file names, or shell commands.
6. Return executable code only.
7. Don't give any example or test-cases.

`.trim();

export function buildVllmOpenAIBaseURL(baseURL: string): string {
  const normalizedBaseURL = baseURL.replace(/\/$/, '');

  if (normalizedBaseURL.endsWith('/v1')) {
    return normalizedBaseURL;
  }

  return `${normalizedBaseURL}/v1`;
}

@Injectable()
export class LlmService {
  private client: OpenAI;
  private cookie: string;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  async onModuleInit() {
    // this.cookie = await this.getAuthCookie();
    // this.client = new OpenAI({
    //   apiKey: 'not-needed',
    //   baseURL: buildVllmOpenAIBaseURL(
    //     this.configService.getOrThrow('VAST_BASE_URL', {
    //       infer: true,
    //     }),
    //   ),
    //   defaultHeaders: {
    //     Cookie: this.cookie,
    //   },
    // });
  }

  private async getAuthCookie(): Promise<string> {
    const url = this.configService.getOrThrow('VAST_AUTH_URL', {
      infer: true,
    });
    const response = await fetch(url, {
      redirect: 'manual',
    });

    const setCookie = response.headers.get('set-cookie');

    if (!setCookie) {
      throw new Error('Failed to get Vast auth cookie');
    }

    return setCookie.split(';')[0];
  }

  async chat(message: string) {
    const response = await this.client.chat.completions.create({
      model: this.configService.getOrThrow('VAST_MODEL', {
        infer: true,
      }),
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        { role: 'user', content: message },
      ],
    });
    return response.choices[0]?.message.content ?? null;
  }
}
