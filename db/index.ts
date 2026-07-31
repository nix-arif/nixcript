import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Neon's serverless HTTP pooler throws transient "fetch failed" /
// "Error connecting to database" errors on cold starts or brief outages.
// We wrap the raw Neon client so every query — including those made
// internally by better-auth's drizzle adapter — retries automatically.
const RETRYABLE = ["fetch failed", "error connecting to database", "econnreset", "socket hang up"];

function isTransient(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return RETRYABLE.some((s) => msg.includes(s));
}

async function retry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err) || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1))); // 500 → 1000 → 2000 ms
    }
  }
  throw new Error("unreachable");
}

const rawSql = neon(process.env.DATABASE_URL!, {
  fetchOptions: { timeout: 30000 },
});

// Drizzle calls client(sqlString, params, options) — wrap that call with retry.
// Copy all own properties from rawSql so tagged-template usage still works.
const retriedSql = function (...args: Parameters<typeof rawSql>) {
  return retry(() => (rawSql as (...a: typeof args) => Promise<unknown>)(...args));
} as unknown as typeof rawSql;
Object.assign(retriedSql, rawSql);

export const db = drizzle({ client: retriedSql });
