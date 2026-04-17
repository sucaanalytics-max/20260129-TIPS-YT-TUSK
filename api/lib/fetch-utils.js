/**
 * Shared fetch utility with retry + timeout for all cron jobs.
 *
 * - Retries on 429 (rate limit) and 5xx (server error)
 * - Exponential backoff: 1s, 2s, 4s
 * - 8-second per-request timeout (Vercel cron has 10s total)
 * - Does NOT retry on 4xx (client error, except 429)
 */

export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) return response;

      // Retry on rate-limit or server errors
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.log(`  Retry ${attempt}/${maxRetries} after ${delay}ms (HTTP ${response.status})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return response; // 4xx (non-429) or final attempt — return as-is
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.log(`  Retry ${attempt}/${maxRetries} after ${delay}ms (${err.message})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
