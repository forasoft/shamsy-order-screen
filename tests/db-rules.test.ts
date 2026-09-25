// The rules hold in the database itself — even for a SQL session that skips the application.
// Runs against DATABASE_URL (a disposable database: `npm run db:reset` first).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";

pg.types.setTypeParser(20, (v) => Number(v));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/postgres" });
let adviser: string, owner: string, customer: string;
const product: Record<string, { id: string; price: number }> = {};

beforeAll(async () => {
  await client.connect();
  const users = (await client.query("select id, role from shamsy.users")).rows;
  adviser = users.find((u) => u.role === "adviser").id;
  owner = users.find((u) => u.role === "owner").id;
  customer = (await client.query("select id from shamsy.customers where name = 'Ahmed Trading'")).rows[0].id;
  for (const p of (await client.query("select id, sku, price_usd_cents from shamsy.products")).rows) product[p.sku] = { id: p.id, price: p.price_usd_cents };
});
afterAll(() => client.end());

interface L { sku: string; qty: number; discount: number; price?: number; approvedBy?: string | null }

/** Writes an order straight into the tables, as `actor`, the way a hostile or buggy client would. */
async function rawOrder(actor: string | null, opts: { rate?: number; lines: L[]; totalUsd?: number; adviserId?: string }) {
  const id = randomUUID();
  const rate = opts.rate ?? 8200;
  const lineTotals = opts.lines.map((l) => (l.price ?? product[l.sku].price) * l.qty - l.discount);
  const totalUsd = opts.totalUsd ?? lineTotals.reduce((a, b) => a + b, 0);
  await client.query("begin");
  try {
    if (actor) await client.query("select set_config('app.actor_id', $1, true)", [actor]);
    await client.query(
      `insert into shamsy.orders (id, order_number, customer_id, adviser_id, saved_by, rate_sdg_per_usd, total_usd_cents, total_sdg_piastres)
       values ($1, $7, $2, $3, $3, $4, $5, $6)`,
      [id, customer, opts.adviserId ?? adviser, rate, totalUsd, totalUsd * rate, "TEST-" + id.slice(0, 8)]);
    let n = 0;
    for (const l of opts.lines) {
      // derived columns are sent as nonsense on purpose: the database computes them
      await client.query(
        `insert into shamsy.order_lines (order_id, line_no, product_id, quantity, unit_price_usd_cents, line_value_usd_cents,
                                         discount_usd_cents, discount_bp, band, line_total_usd_cents, approved_by)
         values ($1, $2, $3, $4, $5, 1, $6, 1, 'none', 1, $7)`,
        [id, ++n, product[l.sku].id, l.qty, l.price ?? product[l.sku].price, l.discount, l.approvedBy ?? null]);
    }
    await client.query("commit");
    return id;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

const L1 = { sku: "SPF-6000-ES-PLUS", qty: 4, discount: 4000 };
const L2 = { sku: "HOPE-5.0L-B1", qty: 2, discount: 7000 };
const L3 = { sku: "HOPE-16.0LM-A1", qty: 1, discount: 15000 };

describe("database rules (no application in between)", () => {
  it("refuses a 7.25% line without the owner's approval", async () => {
    await expect(rawOrder(adviser, { lines: [L1, L2, L3] })).rejects.toThrow("DISCOUNT_NEEDS_OWNER_APPROVAL");
  });

  it("refuses an approval written by an adviser in the owner's name", async () => {
    await expect(rawOrder(adviser, { lines: [L1, L2, { ...L3, approvedBy: owner }] })).rejects.toThrow("APPROVAL_ONLY_BY_OWNER");
  });

  it("accepts the same line when the owner, acting as the owner, approves it", async () => {
    const id = await rawOrder(owner, { lines: [L1, L2, { ...L3, approvedBy: owner }] });
    const o = (await client.query("select total_usd_cents, total_sdg_piastres, rate_sdg_per_usd from shamsy.orders where id = $1", [id])).rows[0];
    expect(o).toEqual({ total_usd_cents: 549000, total_sdg_piastres: 4501800000, rate_sdg_per_usd: 8200 });
  });

  it("computes value, percentage, band and total itself, ignoring what the client sent", async () => {
    const id = await rawOrder(adviser, { lines: [L1, L2] });
    const lines = (await client.query("select line_value_usd_cents v, discount_bp bp, band, line_total_usd_cents t from shamsy.order_lines where order_id = $1 order by line_no", [id])).rows;
    expect(lines).toEqual([{ v: 206000, bp: 194, band: "sand", t: 202000 }, { v: 162000, bp: 432, band: "red", t: 155000 }]);
  });

  it("refuses a price that is not the catalogue price", async () => {
    await expect(rawOrder(adviser, { lines: [{ ...L1, price: 40000 }] })).rejects.toThrow("PRICE_IS_FIXED");
  });

  it("refuses a rate below the minimum", async () => {
    await expect(rawOrder(adviser, { rate: 7900, lines: [L1] })).rejects.toThrow("RATE_BELOW_MINIMUM");
  });

  it("refuses totals that are not the sum of the lines", async () => {
    await expect(rawOrder(adviser, { lines: [L1], totalUsd: 100 })).rejects.toThrow("TOTALS_DO_NOT_MATCH");
  });

  it("refuses an adviser saving an order in someone else's name", async () => {
    await expect(rawOrder(adviser, { lines: [L1], adviserId: owner })).rejects.toThrow("NOT_YOUR_ORDER");
  });

  it("refuses any write without a known acting user", async () => {
    await expect(rawOrder(null, { lines: [L1] })).rejects.toThrow("NO_ACTOR");
  });

  it("never lets a saved order change: no update, no delete, no extra lines", async () => {
    const id = await rawOrder(adviser, { lines: [L1] });
    for (const sql of [
      ["update shamsy.orders set rate_sdg_per_usd = 9000 where id = $1", [id]],
      ["update shamsy.order_lines set discount_usd_cents = 0 where order_id = $1", [id]],
      ["delete from shamsy.orders where id = $1", [id]],
    ] as const) {
      await client.query("begin");
      await client.query("select set_config('app.actor_id', $1, true)", [owner]);
      await expect(client.query(sql[0], [...sql[1]])).rejects.toThrow("SAVED_ORDER_IS_IMMUTABLE");
      await client.query("rollback");
    }
    await client.query("begin");
    await client.query("select set_config('app.actor_id', $1, true)", [owner]);
    await expect(client.query(
      `insert into shamsy.order_lines (order_id, line_no, product_id, quantity, unit_price_usd_cents, line_value_usd_cents, discount_usd_cents, discount_bp, band, line_total_usd_cents)
       values ($1, 9, $2, 1, $3, 0, 0, 0, 'none', 0)`, [id, product["SPF-6000-ES-PLUS"].id, product["SPF-6000-ES-PLUS"].price])).rejects.toThrow("SAVED_ORDER_IS_IMMUTABLE");
    await client.query("rollback");
  });

  it("lets only the owner change prices and settings", async () => {
    for (const sql of ["update shamsy.products set price_usd_cents = 1 where sku = 'SPF-6000-ES-PLUS'", "update shamsy.settings set min_rate_sdg_per_usd = 1 where id = 1"]) {
      await client.query("begin");
      await client.query("select set_config('app.actor_id', $1, true)", [adviser]);
      await expect(client.query(sql)).rejects.toThrow("OWNER_ONLY");
      await client.query("rollback");
    }
  });

  it("keeps a saved order's rate when the rate setting changes", async () => {
    const id = await rawOrder(adviser, { lines: [L1, L2] });
    await client.query("begin");
    await client.query("select set_config('app.actor_id', $1, true)", [owner]);
    await client.query("update shamsy.settings set todays_rate_sdg_per_usd = 9000 where id = 1");
    const o = (await client.query("select rate_sdg_per_usd, total_sdg_piastres from shamsy.orders where id = $1", [id])).rows[0];
    await client.query("rollback");
    expect(o).toEqual({ rate_sdg_per_usd: 8200, total_sdg_piastres: 2927400000 });
  });
});
