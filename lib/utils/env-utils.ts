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
  const val = process.env[key];
  if (val == null || val === "") return fallback;
  const t = val.trim();
  return t === "" ? fallback : t;
}

/** Trimmed CRON_SECRET for Bearer checks — Vercel env values often include accidental newlines vs Vault. */
export function cronSecretFromEnv(): string | undefined {
  const raw = process.env.CRON_SECRET;
  if (raw == null || raw === "") return undefined;
  const t = raw.trim();
  return t === "" ? undefined : t;
}

/** Trimmed CLOUDMAILIN_SECRET for Basic auth — same trimming issue as cron on Vercel. */
export function cloudmailinSecretFromEnv(): string | undefined {
  const raw = process.env.CLOUDMAILIN_SECRET;
  if (raw == null || raw === "") return undefined;
  const t = raw.trim();
  return t === "" ? undefined : t;
}
