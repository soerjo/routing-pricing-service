import { parseDurationToSeconds } from './token-expiry.util.js';

describe('parseDurationToSeconds', () => {
  it('parses seconds suffix', () => {
    expect(parseDurationToSeconds('30s')).toBe(30);
  });

  it('parses minutes suffix', () => {
    expect(parseDurationToSeconds('15m')).toBe(900);
  });

  it('parses hours suffix', () => {
    expect(parseDurationToSeconds('24h')).toBe(86400);
  });

  it('parses days suffix', () => {
    expect(parseDurationToSeconds('7d')).toBe(604800);
  });

  it('treats a bare number as seconds', () => {
    expect(parseDurationToSeconds('300')).toBe(300);
    expect(parseDurationToSeconds('0')).toBe(0);
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseDurationToSeconds('15M')).toBe(900);
    expect(parseDurationToSeconds(' 7D ')).toBe(604800);
  });

  it('rejects invalid values', () => {
    expect(() => parseDurationToSeconds('')).toThrow();
    expect(() => parseDurationToSeconds('abc')).toThrow();
    expect(() => parseDurationToSeconds('15x')).toThrow();
    expect(() => parseDurationToSeconds('m15')).toThrow();
    expect(() => parseDurationToSeconds('-15m')).toThrow();
    expect(() => parseDurationToSeconds('1.5h')).toThrow();
  });
});
