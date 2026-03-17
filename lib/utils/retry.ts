export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
