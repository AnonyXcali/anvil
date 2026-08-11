type ErrorRecord = Record<string, unknown>;

export interface UpstreamLlmErrorDiagnostics {
  category: 'upstream_llm_api_error';
  provider: string;
  modelId: string;
  statusCode: number | null;
  endpoint: string | null;
  retryable: boolean | null;
  retryAfter: string | null;
  rayId: string | null;
  responseClassification: string;
}

function asRecord(value: unknown): ErrorRecord {
  return typeof value === 'object' && value !== null
    ? (value as ErrorRecord)
    : {};
}

function getHeader(headers: unknown, name: string): string | null {
  const record = asRecord(headers);
  const matchingKey = Object.keys(record).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  const value = matchingKey ? record[matchingKey] : undefined;
  return typeof value === 'string' ? value : null;
}

function getEndpoint(url: unknown): string | null {
  if (typeof url !== 'string') {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.host}${parsedUrl.pathname}`;
  } catch {
    return null;
  }
}

function classifyResponse(statusCode: number | null, responseBody: unknown) {
  if (
    statusCode === 520 &&
    typeof responseBody === 'string' &&
    responseBody.includes('Web server is returning an unknown error')
  ) {
    return 'cloudflare_520_host_error';
  }

  if (typeof responseBody === 'string' && responseBody.includes('"error"')) {
    return 'provider_error_response';
  }

  if (statusCode !== null && statusCode >= 500) {
    return 'upstream_server_error';
  }

  if (statusCode !== null && statusCode >= 400) {
    return 'upstream_request_error';
  }

  return 'unknown_upstream_error';
}

export function getUpstreamLlmErrorDiagnostics(
  error: unknown,
  fallbackModelId: string,
  provider = 'openai',
): UpstreamLlmErrorDiagnostics {
  const record = asRecord(error);
  const responseHeaders = asRecord(record.responseHeaders);
  const requestBodyValues = asRecord(record.requestBodyValues);
  const statusCode =
    typeof record.statusCode === 'number' ? record.statusCode : null;
  const modelId =
    typeof requestBodyValues.model === 'string'
      ? requestBodyValues.model
      : fallbackModelId;

  return {
    category: 'upstream_llm_api_error',
    provider,
    modelId,
    statusCode,
    endpoint: getEndpoint(record.url),
    retryable:
      typeof record.isRetryable === 'boolean' ? record.isRetryable : null,
    retryAfter: getHeader(responseHeaders, 'retry-after'),
    rayId: getHeader(responseHeaders, 'cf-ray'),
    responseClassification: classifyResponse(statusCode, record.responseBody),
  };
}
