const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
};

export function parseDurationToSeconds(value: string): number {
  const normalized = value.trim().toLowerCase();
  const match = /^(\d+)([smhd])?$/.exec(normalized);

  if (!match) {
    throw new Error(`Invalid duration value: "${value}"`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';

  return amount * UNIT_SECONDS[unit];
}
