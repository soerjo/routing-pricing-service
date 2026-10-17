import type { Request } from 'express';
import { getRouteLabel } from './request-logging.middleware.js';

describe('getRouteLabel', () => {
  const reqWithRoute = (path: unknown): Request =>
    ({ route: { path } }) as unknown as Request;

  it('returns the matched route template', () => {
    expect(getRouteLabel(reqWithRoute('/api/users/:id'))).toBe(
      '/api/users/:id',
    );
  });

  it('joins array route paths with a pipe', () => {
    expect(getRouteLabel(reqWithRoute(['/api/a', '/api/b']))).toBe(
      '/api/a|/api/b',
    );
  });

  it("returns 'unmatched' when no route matched", () => {
    expect(getRouteLabel({} as Request)).toBe('unmatched');
  });

  it("returns 'unmatched' when route.path is missing", () => {
    expect(getRouteLabel(reqWithRoute(undefined))).toBe('unmatched');
  });

  it("returns 'unmatched' when route.path is not a string or string array", () => {
    expect(getRouteLabel(reqWithRoute(42))).toBe('unmatched');
    expect(getRouteLabel(reqWithRoute([/api/]))).toBe('unmatched');
    expect(getRouteLabel(reqWithRoute([]))).toBe('unmatched');
  });
});
