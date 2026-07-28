export type AppEnv = {
  PORT: number;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  VAST_BASE_URL: string;
  VAST_AUTH_URL: string;
  VAST_MODEL: string;
  SSH_HOST: string;
  SSH_PORT: number;
  SSH_USERNAME: string;
  SSH_PRIVATE_KEY_PATH: string;
  // TODO: SECURITY - require BETTER_AUTH_SECRET here and validate that it is strong enough for auth/session signing.
  BETTER_AUTH_URL: string;
  ENABLE_TESTING_UI: boolean;
};

function requireString(
  value: unknown,
  key: keyof Omit<AppEnv, 'PORT' | 'SSH_PORT'>,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Environment variable ${key} is required`);
  }

  return value.trim();
}

function parsePort(
  value: unknown,
  key: 'PORT' | 'SSH_PORT',
  defaultPort?: number,
): number {
  if (value === undefined || value === null || value === '') {
    if (defaultPort !== undefined) {
      return defaultPort;
    }

    throw new Error(`Environment variable ${key} must be a positive integer`);
  }

  let port: number;

  if (typeof value === 'number') {
    port = value;
  } else if (typeof value === 'string') {
    port = Number.parseInt(value, 10);
  } else {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }

  return port;
}

export function validateEnv(config: Record<string, unknown>): AppEnv {
  return {
    PORT: parsePort(config.PORT, 'PORT', 3000),
    OPENAI_API_KEY: requireString(config.OPENAI_API_KEY, 'OPENAI_API_KEY'),
    OPENAI_MODEL: requireString(config.OPENAI_MODEL, 'OPENAI_MODEL'),
    VAST_BASE_URL: requireString(config.VAST_BASE_URL, 'VAST_BASE_URL'),
    VAST_AUTH_URL: requireString(config.VAST_AUTH_URL, 'VAST_AUTH_URL'),
    VAST_MODEL: requireString(config.VAST_MODEL, 'VAST_MODEL'),
    SSH_HOST: requireString(config.SSH_HOST, 'SSH_HOST'),
    SSH_PORT: parsePort(config.SSH_PORT, 'SSH_PORT', 22),
    SSH_USERNAME: requireString(config.SSH_USERNAME, 'SSH_USERNAME'),
    SSH_PRIVATE_KEY_PATH: requireString(
      config.SSH_PRIVATE_KEY_PATH,
      'SSH_PRIVATE_KEY_PATH',
    ),
    BETTER_AUTH_URL: requireString(config.BETTER_AUTH_URL, 'BETTER_AUTH_URL'),
    ENABLE_TESTING_UI:
      config.ENABLE_TESTING_UI === 'true' || config.ENABLE_TESTING_UI === true,
  };
}
