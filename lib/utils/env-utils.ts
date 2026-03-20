export function envBool(key: string, fallback = false): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val === "true" || val === "1";
}

export function envIntClamped(
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function envModel(key: string, fallback = "claude-haiku-4-5"): string {
  return process.env[key] || fallback;
}
