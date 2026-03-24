export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("429") || msg.includes("rate limit");
  }
  return false;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number; tag?: string } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/** Global Nominatim queue — serialises calls with 1.1s gaps to respect 1 req/sec. */
let _nominatimQueue: Promise<void> = Promise.resolve();

export function nominatimThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const p = _nominatimQueue.then(() => sleep(1100)).then(fn);
  _nominatimQueue = p.then(() => {}, () => {});
  return p;
}
