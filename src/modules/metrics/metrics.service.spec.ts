import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  const sampleLines = (text: string, prefix: string): string[] =>
    text.split('\n').filter((line) => line.startsWith(prefix));

  const firstLine = (text: string, prefix: string): string => {
    const line = sampleLines(text, prefix)[0];
    if (!line) {
      throw new Error(`missing sample line with prefix: ${prefix}`);
    }
    return line;
  };

  const findLine = (text: string, prefix: string, part: string): string => {
    const line = sampleLines(text, prefix).find((candidate) =>
      candidate.includes(part),
    );
    if (!line) {
      throw new Error(`missing sample line containing: ${part}`);
    }
    return line;
  };

  const parseValue = (line: string): number =>
    Number(line.slice(line.lastIndexOf('}') + 1).trim());

  it('exposes the prometheus text content type', () => {
    expect(service.contentType).toContain('text/plain');
  });

  it('increments http_requests_total once per recorded request', async () => {
    service.recordRequest('GET', '/api/health', 200, 0.01);

    let line = firstLine(await service.getMetrics(), 'http_requests_total{');
    expect(parseValue(line)).toBe(1);

    service.recordRequest('GET', '/api/health', 200, 0.01);
    line = firstLine(await service.getMetrics(), 'http_requests_total{');
    expect(parseValue(line)).toBe(2);
  });

  it('tracks distinct label combinations as separate series', async () => {
    service.recordRequest('GET', '/api/health', 200, 0.01);
    service.recordRequest('GET', '/api/users/:id', 200, 0.02);
    service.recordRequest('GET', '/api/users/:id', 401, 0.03);

    const lines = sampleLines(
      await service.getMetrics(),
      'http_requests_total{',
    );
    expect(lines).toHaveLength(3);
  });

  it('coerces numeric label values to strings', async () => {
    service.recordRequest('GET', '/api/users/:id', 401, 0.05);

    const line = firstLine(await service.getMetrics(), 'http_requests_total{');
    expect(line).toContain('method="GET"');
    expect(line).toContain('route="/api/users/:id"');
    expect(line).toContain('status="401"');
  });

  it('observes durations in http_request_duration_seconds buckets', async () => {
    service.recordRequest('POST', '/api/auth/login', 200, 0.12);

    const text = await service.getMetrics();
    const bucket = (le: string): string =>
      findLine(text, 'http_request_duration_seconds_bucket{', `le="${le}"`);

    expect(parseValue(bucket('0.1'))).toBe(0);
    expect(parseValue(bucket('0.25'))).toBe(1);
    expect(parseValue(bucket('+Inf'))).toBe(1);
  });

  it('records histogram count and sum per label set', async () => {
    service.recordRequest('POST', '/api/auth/login', 200, 0.12);

    const text = await service.getMetrics();
    expect(
      parseValue(firstLine(text, 'http_request_duration_seconds_count{')),
    ).toBe(1);
    expect(
      parseValue(firstLine(text, 'http_request_duration_seconds_sum{')),
    ).toBeCloseTo(0.12, 6);
  });

  it('includes default process metrics in the registry', async () => {
    const text = await service.getMetrics();
    expect(text).toContain('process_cpu_seconds_total');
    expect(text).toContain('process_resident_memory_bytes');
  });
});
