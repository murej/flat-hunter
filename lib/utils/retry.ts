export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(e: unknown): boolean {
  const err = e as { status?: number; message?: string };
  if (err?.status === 429) return true;
  if (typeof err?.message === "string" && /rate.?limit|429/i.test(err.message))
    return true;
  return false;
}

/** True when `messages.create` should be retried after a short wait (Tier 1 TPM/RPM). */
export function isAnthropicRateOrOverloadError(e: unknown): boolean {
  const s = (e as { status?: number })?.status;
  if (s === 429 || s === 529) return true;
  const msg = String((e as Error)?.message ?? e);
  if (/rate_limit_error|overloaded_error|529/i.test(msg)) return true;
  if (/rate.?limit/i.test(msg) && /429|529/.test(msg)) return true;
  return false;
}

/** Prefer API `retry-after` (seconds); else backoff from attempt index. */
export function sleepMsFromAnthropicRetryAfter(
  e: unknown,
  attemptIndex: number,
): number {
  const headers = (e as { headers?: Headers })?.headers;
  if (headers && typeof headers.get === "function") {
    const raw = headers.get("retry-after");
    if (raw) {
      const sec = Number.parseFloat(raw);
      if (Number.isFinite(sec) && sec > 0) {
        return Math.min(120_000, Math.max(1_500, sec * 1000));
      }
    }
  }
  return Math.min(60_000, 3_000 * (attemptIndex + 1));
}

function isRetryable(e: unknown): boolean {
  if (e instanceof TypeError) return true;

  const err = e as { status?: number; message?: string };
  const status =
    err.status ??
    parseInt(err.message?.match(/(429|500|502|503|504)/)?.[1] ?? "", 10);
  if (!Number.isNaN(status))
    return status === 429 || (status >= 500 && status <= 504);

  if (err.message?.toLowerCase().includes("rate limit")) return true;

  return false;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries) throw e;
      if (!isRetryable(e)) throw e;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }

  throw lastError;
}
