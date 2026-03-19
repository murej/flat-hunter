/**
 * Shared env parsing for lib/config/* (single source of truth).
 */

export function envBool(
  raw: string | undefined,
  defaultValue: boolean,
  envKey?: string,
): boolean {
  if (raw === undefined || raw === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  if (process.env.NODE_ENV === "development" && envKey) {
    console.warn(
      `[config] Unrecognised boolean for ${envKey}="${raw}", using default ${defaultValue}`,
    );
  }
  return defaultValue;
}

export function envIntClamped(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  envKey?: string,
): number {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) {
    if (process.env.NODE_ENV === "development" && envKey) {
      console.warn(
        `[config] Unrecognised integer for ${envKey}="${raw}", using default ${defaultValue}`,
      );
    }
    return defaultValue;
  }
  return Math.min(max, Math.max(min, n));
}

export function envModel(raw: string | undefined, fallback: string): string {
  const t = raw?.trim();
  return t && t.length > 0 ? t : fallback;
}
