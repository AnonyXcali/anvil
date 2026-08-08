import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('returns parsed values for a valid environment', () => {
    expect(
      validateEnv({
        PORT: '4500',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o-mini',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
        VAST_BASE_URL: 'http://localhost:8080/v1',
        VAST_AUTH_URL: 'http://localhost:8080/auth',
        VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        SSH_HOST: 'localhost',
        SSH_PORT: '2222',
        SSH_USERNAME: 'test-user',
        SSH_PRIVATE_KEY_PATH: '/tmp/test-key',
        BETTER_AUTH_URL: 'http://localhost:3000',
        EXA_KEY: 'exa-key',
        FIRECRAWL_KEY: 'firecrawl-key',
        LIGHTPANDA_KEY: 'lightpanda-key',
        LIGHTPANDA_ENDPOINT: 'wss://lightpanda.example/ws',
      }),
    ).toEqual({
      PORT: 4500,
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'gpt-4o-mini',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
      VAST_BASE_URL: 'http://localhost:8080/v1',
      VAST_AUTH_URL: 'http://localhost:8080/auth',
      VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      SSH_HOST: 'localhost',
      SSH_PORT: 2222,
      SSH_USERNAME: 'test-user',
      SSH_PRIVATE_KEY_PATH: '/tmp/test-key',
      BETTER_AUTH_URL: 'http://localhost:3000',
      EXA_KEY: 'exa-key',
      FIRECRAWL_KEY: 'firecrawl-key',
      LIGHTPANDA_KEY: 'lightpanda-key',
      LIGHTPANDA_ENDPOINT: 'wss://lightpanda.example/ws',
      ENABLE_TESTING_UI: false,
    });
  });

  it('defaults PORT to 3000 when not provided', () => {
    expect(
      validateEnv({
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o-mini',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
        VAST_BASE_URL: 'http://localhost:8080/v1',
        VAST_AUTH_URL: 'http://localhost:8080/auth',
        VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        SSH_HOST: 'localhost',
        SSH_USERNAME: 'test-user',
        SSH_PRIVATE_KEY_PATH: '/tmp/test-key',
        BETTER_AUTH_URL: 'http://localhost:3000',
        EXA_KEY: 'exa-key',
        FIRECRAWL_KEY: 'firecrawl-key',
        LIGHTPANDA_KEY: 'lightpanda-key',
        LIGHTPANDA_ENDPOINT: 'wss://lightpanda.example/ws',
      }),
    ).toMatchObject({
      PORT: 3000,
      SSH_PORT: 22,
    });
  });

  it('fails when OPENAI_API_KEY is missing', () => {
    expect(() =>
      validateEnv({
        OPENAI_MODEL: 'gpt-4o-mini',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
        VAST_BASE_URL: 'http://localhost:8080/v1',
        VAST_AUTH_URL: 'http://localhost:8080/auth',
        VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        SSH_HOST: 'localhost',
        SSH_USERNAME: 'test-user',
        SSH_PRIVATE_KEY_PATH: '/tmp/test-key',
      }),
    ).toThrow('Environment variable OPENAI_API_KEY is required');
  });

  it('fails when OPENAI_MODEL is missing', () => {
    expect(() =>
      validateEnv({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
        VAST_BASE_URL: 'http://localhost:8080/v1',
        VAST_AUTH_URL: 'http://localhost:8080/auth',
        VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        SSH_HOST: 'localhost',
        SSH_USERNAME: 'test-user',
        SSH_PRIVATE_KEY_PATH: '/tmp/test-key',
      }),
    ).toThrow('Environment variable OPENAI_MODEL is required');
  });

  it('fails when VAST_BASE_URL is missing', () => {
    expect(() =>
      validateEnv({
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o-mini',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
        VAST_AUTH_URL: 'http://localhost:8080/auth',
        VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        SSH_HOST: 'localhost',
        SSH_USERNAME: 'test-user',
        SSH_PRIVATE_KEY_PATH: '/tmp/test-key',
      }),
    ).toThrow('Environment variable VAST_BASE_URL is required');
  });

  it('fails when SSH_HOST is missing', () => {
    expect(() =>
      validateEnv({
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o-mini',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
        VAST_BASE_URL: 'http://localhost:8080/v1',
        VAST_AUTH_URL: 'http://localhost:8080/auth',
        VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        SSH_USERNAME: 'test-user',
        SSH_PRIVATE_KEY_PATH: '/tmp/test-key',
      }),
    ).toThrow('Environment variable SSH_HOST is required');
  });

  it('fails when SSH_PRIVATE_KEY_PATH is missing', () => {
    expect(() =>
      validateEnv({
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-4o-mini',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MASTRA_DATABASE_URL: 'postgresql://localhost/mastra',
        VAST_BASE_URL: 'http://localhost:8080/v1',
        VAST_AUTH_URL: 'http://localhost:8080/auth',
        VAST_MODEL: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        SSH_HOST: 'localhost',
        SSH_USERNAME: 'test-user',
      }),
    ).toThrow('Environment variable SSH_PRIVATE_KEY_PATH is required');
  });
});
