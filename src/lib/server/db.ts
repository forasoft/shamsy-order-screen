import "server-only";
import pg from "pg";

type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

// Money columns are bigint; they stay far below 2^53, so parse them as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

const globalForPool = globalThis as unknown as { __shamsyPool?: Pool };

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = url.includes("localhost") || url.includes("127.0.0.1");
  return new pg.Pool({
    connectionString: url,
    ssl: local ? false : { rejectUnauthorized: false },
    max: local ? 10 : 3,
    idleTimeoutMillis: 10_000,
  });
}

export function pool(): Pool {
  if (!globalForPool.__shamsyPool) globalForPool.__shamsyPool = makePool();
  return globalForPool.__shamsyPool;
}

/**
 * Runs `fn` in one transaction with the acting user set for the database rules.
 * The triggers read `app.actor_id` to decide who may approve, change prices or settings.
 */
export async function withActor<T>(actorId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function query<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const res = await pool().query<T>(text, params);
  return res.rows;
}
