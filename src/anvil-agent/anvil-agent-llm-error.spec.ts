import { getUpstreamLlmErrorDiagnostics } from './anvil-agent-llm-error';

describe('getUpstreamLlmErrorDiagnostics', () => {
  it('classifies a Cloudflare 520 without retaining the response body', () => {
    const diagnostics = getUpstreamLlmErrorDiagnostics(
      {
        statusCode: 520,
        url: 'https://api.openai.com/v1/responses?secret=should-not-log',
        isRetryable: true,
        responseHeaders: {
          'retry-after': '60',
          'cf-ray': 'ray-123',
        },
        responseBody: 'Web server is returning an unknown error',
      },
      'gpt-5.6',
    );

    expect(diagnostics).toEqual({
      category: 'upstream_llm_api_error',
      provider: 'openai',
      modelId: 'gpt-5.6',
      statusCode: 520,
      endpoint: 'api.openai.com/v1/responses',
      retryable: true,
      retryAfter: '60',
      rayId: 'ray-123',
      responseClassification: 'cloudflare_520_host_error',
    });
    expect(JSON.stringify(diagnostics)).not.toContain('secret');
  });

  it('classifies provider errors without exposing response content', () => {
    expect(
      getUpstreamLlmErrorDiagnostics(
        {
          statusCode: 400,
          url: 'https://api.openai.com/v1/responses',
          responseBody: '{"error":{"message":"invalid request"}}',
        },
        'gpt-5.6',
      ).responseClassification,
    ).toBe('provider_error_response');
  });

  it('uses the model from the failed request when available', () => {
    expect(
      getUpstreamLlmErrorDiagnostics(
        {
          requestBodyValues: { model: 'gpt-5.5' },
        },
        'gpt-5.6',
      ).modelId,
    ).toBe('gpt-5.5');
  });
});
