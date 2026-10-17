import { parseCorsOrigins } from './cors-origins.util.js';

describe('parseCorsOrigins', () => {
  it('returns an empty list when unset', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins(null)).toEqual([]);
  });

  it('returns an empty list for empty or whitespace-only input', () => {
    expect(parseCorsOrigins('')).toEqual([]);
    expect(parseCorsOrigins('   ')).toEqual([]);
  });

  it('parses a single origin', () => {
    expect(parseCorsOrigins('http://localhost:5173')).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('parses a comma-separated list, trimming each origin', () => {
    expect(
      parseCorsOrigins('http://localhost:5173, https://app.example.com'),
    ).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('drops empty entries and surrounding whitespace', () => {
    expect(parseCorsOrigins(' a ,, b , ')).toEqual(['a', 'b']);
  });
});
