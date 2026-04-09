/** Round and clamp to [1, 10]. Returns null if not a finite number. */
export function clampScore(n: number): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(Math.max(1, Math.min(10, n)));
}
