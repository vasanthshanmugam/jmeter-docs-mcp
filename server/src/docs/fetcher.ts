import { readCache, writeCache } from "./cache.js";

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "jmeter-docs-mcp (+https://github.com/vasanthshanmugam/jmeter-docs-mcp)";

export interface FetchedPage {
  url: string;
  html: string;
  fromCache: boolean;
  stale: boolean;
}

/**
 * Fetches a documentation page, preferring a fresh disk cache entry and falling back to a
 * stale one when the network is unavailable.
 */
export async function fetchPage(url: string): Promise<FetchedPage> {
  const cached = await readCache(url);
  if (cached?.fresh) {
    return { url, html: cached.body, fromCache: true, stale: false };
  }

  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    await writeCache(url, html);
    return { url, html, fromCache: false, stale: false };
  } catch (error) {
    if (cached) {
      return { url, html: cached.body, fromCache: true, stale: true };
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch ${url}: ${reason}`);
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
