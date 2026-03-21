export function clampScore(n: number, fallback = 5): number {
  if (isNaN(n) || n < 1 || n > 10) return fallback;
  return Math.round(Math.max(1, Math.min(10, n)));
}
