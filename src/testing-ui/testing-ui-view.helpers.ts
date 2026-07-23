import hbs from 'hbs';

export function registerTestingUiViewHelpers(): void {
  hbs.registerHelper('json', (value: unknown) => {
    const text = JSON.stringify(value ?? null, null, 2);
    return new hbs.handlebars.SafeString(hbs.handlebars.escapeExpression(text));
  });

  hbs.registerHelper('statusClass', (status: unknown) => {
    const normalized =
      typeof status === 'string' ? status.toLowerCase() : 'unknown';

    return [
      'active',
      'processing',
      'running',
      'suspended',
      'completed',
      'failed',
      'errored',
      'stopped',
    ].includes(normalized)
      ? normalized
      : 'unknown';
  });

  hbs.registerHelper('eq', (left: unknown, right: unknown) => left === right);
  hbs.registerHelper(
    'fallback',
    (value: unknown, fallback: string) => value || fallback,
  );
}
