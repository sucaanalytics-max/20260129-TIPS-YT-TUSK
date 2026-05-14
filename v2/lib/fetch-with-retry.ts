/**
 * fetch with retry + per-request timeout. Retries on 429 / 5xx with exponential
 * backoff (1s, 2s, 4s). 4xx (non-429) and the final attempt are returned as-is.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  timeoutMs = 8_000,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxRetries) return res;
      await sleep(1000 * 2 ** (attempt - 1));
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt === maxRetries) break;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetchWithRetry failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
