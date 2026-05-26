import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { AppEnv } from '../config/env.validation';

//TODO: this would evolve with rest of the scaffolding
const SYSTEM_PROMPT = `

You are an expert coding assistant.

You generate only the contents of src/App.tsx for a Vite React TypeScript app,
based on the user's description.

Rules:
- Respond with this operation is not permitted if it doesn't match the task as instructed.
- Return only raw TSX code.
- Do not return Markdown.
- Do not include code fences.
- Do not modify package.json, main.tsx, index.html, or CSS files.
- Export a default React component named App.
- Use only React and standard browser APIs.
- Do not import external packages.
- You may use inline styles or className values.
- The code must compile with TypeScript.

`.trim();

function generateEditSystemPrompt(appTsx: string): string {
  return `
You will be provided the contents of the existing src/App.tsx

===BELOW ARE THE App.tsx CONTENT===

${appTsx}

===ABOVE ARE THE App.tsx CONTENT===

You generate only the contents of src/App.tsx for a Vite React TypeScript app.

Rules:
- Return only raw TSX code.
- Do not use Markdown.
- Do not include code fences.
- Export a default React component named App.
- Do not modify other files.
- Do not import external packages beyond React.
- The code must compile in a Vite React TypeScript project.
`.trim();
}

export function buildVllmOpenAIBaseURL(baseURL: string): string {
  const normalizedBaseURL = baseURL.replace(/\/$/, '');

  if (normalizedBaseURL.endsWith('/v1')) {
    return normalizedBaseURL;
  }

  return `${normalizedBaseURL}/v1`;
}

@Injectable()
export class LlmService implements OnModuleInit {
  private client: OpenAI;
  private cookie: string;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  onModuleInit() {
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
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow('OPENAI_API_KEY', {
        infer: true,
      }),
    });
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
      model: this.configService.getOrThrow('OPENAI_MODEL', {
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

  async generateNewEdit(message: string, appTsx?: string) {
    const response = await this.client.chat.completions.create({
      model: this.configService.getOrThrow('OPENAI_MODEL', {
        infer: true,
      }),
      messages: [
        {
          role: 'system',
          content: generateEditSystemPrompt(appTsx as string),
        },
        { role: 'user', content: message },
      ],
    });
    return response.choices[0]?.message.content ?? null;
  }
}
