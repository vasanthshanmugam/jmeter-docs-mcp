import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_TTL_HOURS = 24 * 7;

export function getCacheDir(): string {
  const configured = process.env.JMETER_DOCS_CACHE_DIR?.trim();
  if (configured) {
    return configured;
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "jmeter-docs-mcp", "cache");
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  return join(xdg || join(homedir(), ".cache"), "jmeter-docs-mcp");
}

export function getCacheTtlMs(): number {
  const hours = Number(process.env.JMETER_DOCS_CACHE_TTL_HOURS);
  return (Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
}

function cacheFile(url: string): string {
  const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return join(getCacheDir(), `${key}.html`);
}

export interface CachedEntry {
  body: string;
  fresh: boolean;
}

export async function readCache(url: string): Promise<CachedEntry | undefined> {
  const file = cacheFile(url);
  try {
    const [info, body] = await Promise.all([stat(file), readFile(file, "utf8")]);
    return { body, fresh: Date.now() - info.mtimeMs < getCacheTtlMs() };
  } catch {
    return undefined;
  }
}

export async function writeCache(url: string, body: string): Promise<void> {
  try {
    await mkdir(getCacheDir(), { recursive: true });
    await writeFile(cacheFile(url), body, "utf8");
  } catch {
    // Caching is best effort; a read-only home directory must not break the server.
  }
}

export async function clearCache(): Promise<string> {
  const dir = getCacheDir();
  await rm(dir, { recursive: true, force: true });
  return dir;
}
