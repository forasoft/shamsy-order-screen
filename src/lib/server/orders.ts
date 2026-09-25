import "server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import { query, withActor } from "./db";
import { ApiError } from "./errors";
import type { User } from "./auth";
import { computeLine, orderTotals, formatBp, formatUsd, type Thresholds } from "@/lib/money";

// ---------------------------------------------------------------- input

const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(1_000_000_000_00);

export const LineSchema = z.object({
  productId: uuid,
  quantity: z.number().int().min(1).max(100000),
  // What the screen showed. Prices are fixed, so this must match the catalogue — it is checked, never used.
  unitPriceUsdCents: cents,
  discountUsdCents: cents,
  approve: z.boolean().optional(), // owner only
});

export const OrderSchema = z.object({
  id: uuid, // generated on the phone; saving the same id twice returns the first save
  customerId: uuid,
  rateSdgPerUsd: z.number().int().positive(),
  lines: z.array(LineSchema).min(1).max(200),
  expected: z.object({ totalUsdCents: cents, totalSdgPiastres: z.number().int().min(0) }).optional(),
  createdOnDeviceAt: z.string().datetime().optional(),
});

export type OrderInput = z.infer<typeof OrderSchema>;

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ApiError(400, "INVALID_INPUT", `${first.path.join(".") || "body"}: ${first.message}`);
  }
  return r.data;
}

// ---------------------------------------------------------------- reference data

export interface Settings extends Thresholds {
  todaysRateSdgPerUsd: number;
  minRateSdgPerUsd: number;
  updatedAt: string;
}

async function loadSettings(c?: PoolClient): Promise<Settings> {
  const sql = `select todays_rate_sdg_per_usd, min_rate_sdg_per_usd, sand_max_bp, red_max_bp, updated_at from shamsy.settings where id = 1`;
  const rows = c ? (await c.query(sql)).rows : await query(sql);
  const r = rows[0] as Record<string, never>;
  return {
    todaysRateSdgPerUsd: r.todays_rate_sdg_per_usd,
    minRateSdgPerUsd: r.min_rate_sdg_per_usd,
    sandMaxBp: r.sand_max_bp,
    redMaxBp: r.red_max_bp,
    updatedAt: r.updated_at,
  };
}

export async function bootstrap(user: User) {
  const [settings, products, customers] = await Promise.all([
    loadSettings(),
    query(`select id, sku, name, price_usd_cents as "priceUsdCents" from shamsy.products where active order by price_usd_cents`),
    query(`select id, name, city from shamsy.customers order by name`),
  ]);
  return { me: user, settings, products, customers };
}

// ---------------------------------------------------------------- building an order

interface BuiltLine {
  lineNo: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceUsdCents: number;
  discountUsdCents: number;
  lineTotalUsdCents: number;
  approvedBy: string | null;
}

/**
 * Checks an order against the rules before it goes to the database, with messages
 * the adviser can act on. The database checks the same rules again on insert.
 */
async function buildOrder(c: PoolClient, user: User, input: OrderInput) {
  const settings = await loadSettings(c);

  if (input.rateSdgPerUsd < settings.minRateSdgPerUsd) {
    throw new ApiError(422, "RATE_BELOW_MINIMUM",
      `The rate ${input.rateSdgPerUsd.toLocaleString("en-US")} is below the minimum of ${settings.minRateSdgPerUsd.toLocaleString("en-US")} SDG per USD.`);
  }

  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const { rows: products } = await c.query(
    `select id, name, price_usd_cents from shamsy.products where active and id = any($1::uuid[])`, [ids]);
  const byId = new Map(products.map((p) => [p.id as string, p as { id: string; name: string; price_usd_cents: number }]));

  const lines: BuiltLine[] = input.lines.map((l, i) => {
    const lineNo = i + 1;
    const p = byId.get(l.productId);
    if (!p) throw new ApiError(422, "UNKNOWN_PRODUCT", `Line ${lineNo}: this product is not in the catalogue.`);
    if (l.unitPriceUsdCents !== p.price_usd_cents) {
      throw new ApiError(409, "PRICE_IS_FIXED",
        `Line ${lineNo}: ${p.name} costs ${formatUsd(p.price_usd_cents)}, not ${formatUsd(l.unitPriceUsdCents)}. Prices are fixed; only the owner can change them.`,
        { lineNo, catalogueUnitPriceUsdCents: p.price_usd_cents });
    }
    if (l.approve && user.role !== "owner") {
      throw new ApiError(403, "APPROVAL_ONLY_BY_OWNER", `Line ${lineNo}: only the owner can approve a discount.`, { lineNo });
    }
    const r = computeLine({ unitPriceUsdCents: p.price_usd_cents, quantity: l.quantity, discountUsdCents: l.discountUsdCents, approved: !!l.approve }, settings);
    if (r.discountTooLarge) {
      throw new ApiError(422, "DISCOUNT_EXCEEDS_LINE", `Line ${lineNo}: the discount is larger than the line value.`, { lineNo });
    }
    if (r.needsApproval) {
      throw new ApiError(422, "DISCOUNT_NEEDS_OWNER_APPROVAL",
        `Line ${lineNo}: a discount of ${formatBp(r.discountBp)} is above the ${formatBp(settings.redMaxBp)} limit and needs the owner's approval.`,
        { lineNo, discountBp: r.discountBp, enforcedBy: "server" });
    }
    return {
      lineNo,
      productId: p.id,
      productName: p.name,
      quantity: l.quantity,
      unitPriceUsdCents: p.price_usd_cents,
      discountUsdCents: l.discountUsdCents,
      lineTotalUsdCents: r.lineTotalUsdCents,
      approvedBy: r.band === "blocked" && l.approve ? user.id : null,
    };
  });

  const totals = orderTotals(lines.map((l) => l.lineTotalUsdCents), input.rateSdgPerUsd);
  if (input.expected &&
      (input.expected.totalUsdCents !== totals.totalUsdCents || input.expected.totalSdgPiastres !== totals.totalSdgPiastres)) {
    throw new ApiError(409, "TOTALS_DO_NOT_MATCH",
      `The screen showed ${formatUsd(input.expected.totalUsdCents)}, the rules give ${formatUsd(totals.totalUsdCents)}. Nothing was saved.`);
  }
  return { lines, totals };
}

async function insertOrder(c: PoolClient, opts: {
  id: string; adviser: { id: string; prefix: string }; customerId: string; rate: number;
  lines: BuiltLine[]; totals: { totalUsdCents: number; totalSdgPiastres: number }; createdOnDeviceAt?: string | null;
}) {
  const { rows } = await c.query(`select shamsy.next_order_number($1) as n`, [opts.adviser.prefix]);
  await c.query(
    `insert into shamsy.orders (id, order_number, customer_id, adviser_id, saved_by, rate_sdg_per_usd,
                                total_usd_cents, total_sdg_piastres, created_on_device_at)
     values ($1, $2, $3, $4, $4, $5, $6, $7, $8)`,
    [opts.id, rows[0].n, opts.customerId, opts.adviser.id, opts.rate, opts.totals.totalUsdCents, opts.totals.totalSdgPiastres, opts.createdOnDeviceAt ?? null],
  );
  for (const l of opts.lines) {
    // line value, discount %, band and line total are computed by the database trigger
    await c.query(
      `insert into shamsy.order_lines (order_id, line_no, product_id, quantity, unit_price_usd_cents,
                                       line_value_usd_cents, discount_usd_cents, discount_bp, band, line_total_usd_cents, approved_by)
       values ($1, $2, $3, $4, $5, 0, $6, 0, 'none', 0, $7)`,
      [opts.id, l.lineNo, l.productId, l.quantity, l.unitPriceUsdCents, l.discountUsdCents, l.approvedBy],
    );
  }
}

// ---------------------------------------------------------------- orders

export async function saveOrder(user: User, input: OrderInput) {
  const existing = await getOrderOrNull(user, input.id);
  if (existing) return { order: existing, replayed: true };
  try {
    await withActor(user.id, async (c) => {
      const { lines, totals } = await buildOrder(c, user, input);
      await insertOrder(c, {
        id: input.id,
        adviser: { id: user.id, prefix: user.orderPrefix ?? "OR" },
        customerId: input.customerId, rate: input.rateSdgPerUsd, lines, totals,
        createdOnDeviceAt: input.createdOnDeviceAt,
      });
    });
  } catch (e) {
    // the same order arriving twice at once (a retry racing the first attempt)
    if ((e as { code?: string }).code === "23505") {
      const again = await getOrderOrNull(user, input.id);
      if (again) return { order: again, replayed: true };
    }
    throw e;
  }
  return { order: (await getOrderOrNull(user, input.id))!, replayed: false };
}

export async function getOrderOrNull(user: User, id: string) {
  const rows = await query(
    `select o.id, o.order_number, o.rate_sdg_per_usd, o.total_usd_cents, o.total_sdg_piastres, o.saved_at,
            o.created_on_device_at, o.adviser_id,
            c.id as customer_id, c.name as customer_name, c.city as customer_city,
            a.full_name as adviser_name, s.full_name as saved_by_name
       from shamsy.orders o
       join shamsy.customers c on c.id = o.customer_id
       join shamsy.users a on a.id = o.adviser_id
       join shamsy.users s on s.id = o.saved_by
      where o.id = $1`, [id]);
  const o = rows[0] as Record<string, never> | undefined;
  if (!o) return null;
  if (user.role !== "owner" && o.adviser_id !== user.id) return null;
  const lines = await query(
    `select l.line_no, l.quantity, l.unit_price_usd_cents, l.line_value_usd_cents, l.discount_usd_cents,
            l.discount_bp, l.band, l.line_total_usd_cents, l.approved_at,
            p.id as product_id, p.sku, p.name as product_name, u.full_name as approved_by_name
       from shamsy.order_lines l
       join shamsy.products p on p.id = l.product_id
       left join shamsy.users u on u.id = l.approved_by
      where l.order_id = $1 order by l.line_no`, [id]);
  return {
    id: o.id as string,
    orderNumber: o.order_number as string,
    customer: { id: o.customer_id, name: o.customer_name, city: o.customer_city },
    adviserName: o.adviser_name,
    savedByName: o.saved_by_name,
    rateSdgPerUsd: o.rate_sdg_per_usd as number,
    totalUsdCents: o.total_usd_cents as number,
    totalSdgPiastres: o.total_sdg_piastres as number,
    savedAt: o.saved_at,
    createdOnDeviceAt: o.created_on_device_at,
    lines: (lines as Record<string, never>[]).map((l) => ({
      lineNo: l.line_no,
      product: { id: l.product_id, sku: l.sku, name: l.product_name },
      quantity: l.quantity,
      unitPriceUsdCents: l.unit_price_usd_cents,
      lineValueUsdCents: l.line_value_usd_cents,
      discountUsdCents: l.discount_usd_cents,
      discountBp: l.discount_bp,
      band: l.band,
      lineTotalUsdCents: l.line_total_usd_cents,
      approvedByName: l.approved_by_name,
      approvedAt: l.approved_at,
    })),
  };
}

export async function listOrders(user: User) {
  return query(
    `select o.id, o.order_number as "orderNumber", c.name as "customerName", o.rate_sdg_per_usd as "rateSdgPerUsd",
            o.total_usd_cents as "totalUsdCents", o.total_sdg_piastres as "totalSdgPiastres", o.saved_at as "savedAt",
            a.full_name as "adviserName"
       from shamsy.orders o
       join shamsy.customers c on c.id = o.customer_id
       join shamsy.users a on a.id = o.adviser_id
      where $1 = 'owner' or o.adviser_id = $2
      order by o.saved_at desc limit 50`, [user.role, user.id]);
}

// ---------------------------------------------------------------- approval requests

export const ApprovalRequestSchema = OrderSchema.omit({ expected: true, createdOnDeviceAt: true });

export async function createApprovalRequest(user: User, input: z.infer<typeof ApprovalRequestSchema>) {
  const found = await query(`select id from shamsy.approval_requests where id = $1`, [input.id]);
  if (found[0]) return { id: input.id, replayed: true };
  await withActor(user.id, async (c) => {
    const settings = await loadSettings(c);
    if (input.rateSdgPerUsd < settings.minRateSdgPerUsd) {
      throw new ApiError(422, "RATE_BELOW_MINIMUM", `The rate is below the minimum of ${settings.minRateSdgPerUsd.toLocaleString("en-US")} SDG per USD.`);
    }
    // same price check as an order: the request carries what the adviser saw
    const { rows: products } = await c.query(`select id, price_usd_cents from shamsy.products where active and id = any($1::uuid[])`,
      [input.lines.map((l) => l.productId)]);
    const price = new Map(products.map((p) => [p.id as string, p.price_usd_cents as number]));
    let blocked = 0;
    input.lines.forEach((l, i) => {
      if (price.get(l.productId) !== l.unitPriceUsdCents) {
        throw new ApiError(409, "PRICE_IS_FIXED", `Line ${i + 1}: the price does not match the catalogue.`);
      }
      const r = computeLine(l, settings);
      if (r.discountTooLarge) throw new ApiError(422, "DISCOUNT_EXCEEDS_LINE", `Line ${i + 1}: the discount is larger than the line value.`);
      if (r.band === "blocked") blocked++;
    });
    if (!blocked) throw new ApiError(422, "NO_APPROVAL_NEEDED", "No line needs the owner's approval; save the order instead.");
    await c.query(
      `insert into shamsy.approval_requests (id, requested_by, customer_id, rate_sdg_per_usd, lines) values ($1, $2, $3, $4, $5)`,
      [input.id, user.id, input.customerId, input.rateSdgPerUsd,
       JSON.stringify(input.lines.map(({ productId, quantity, unitPriceUsdCents, discountUsdCents }) => ({ productId, quantity, unitPriceUsdCents, discountUsdCents })))],
    );
  });
  return { id: input.id, replayed: false };
}

export async function listApprovalRequests(user: User) {
  const rows = await query(
    `select r.id, r.status, r.rate_sdg_per_usd as "rateSdgPerUsd", r.lines, r.created_at as "createdAt",
            r.order_id as "orderId", c.id as "customerId", c.name as "customerName", u.full_name as "requestedByName"
       from shamsy.approval_requests r
       join shamsy.customers c on c.id = r.customer_id
       join shamsy.users u on u.id = r.requested_by
      where ($1 = 'owner' or r.requested_by = $2)
      order by (r.status = 'pending') desc, r.created_at desc limit 50`, [user.role, user.id]);
  return rows;
}

export async function approveRequest(owner: User, requestId: string, approveLineNos: number[]) {
  const orderId = await withActor(owner.id, async (c) => {
    const { rows } = await c.query(
      `select r.*, u.order_prefix from shamsy.approval_requests r join shamsy.users u on u.id = r.requested_by
        where r.id = $1 for update`, [requestId]);
    const r = rows[0];
    if (!r) throw new ApiError(404, "NOT_FOUND", "No such approval request.");
    if (r.status !== "pending") throw new ApiError(409, "REQUEST_ALREADY_DECIDED", "This request has already been decided.");
    const input: OrderInput = {
      id: r.id,
      customerId: r.customer_id,
      rateSdgPerUsd: r.rate_sdg_per_usd,
      lines: (r.lines as OrderInput["lines"]).map((l, i) => ({ ...l, approve: approveLineNos.includes(i + 1) })),
    };
    const { lines, totals } = await buildOrder(c, owner, input);
    await insertOrder(c, {
      id: r.id, adviser: { id: r.requested_by, prefix: r.order_prefix ?? "OR" },
      customerId: r.customer_id, rate: r.rate_sdg_per_usd, lines, totals,
    });
    await c.query(`update shamsy.approval_requests set status = 'approved', order_id = $2 where id = $1`, [requestId, r.id]);
    return r.id as string;
  });
  return getOrderOrNull(owner, orderId);
}

// ---------------------------------------------------------------- owner settings

export const SettingsSchema = z.object({
  todaysRateSdgPerUsd: z.number().int().positive(),
  minRateSdgPerUsd: z.number().int().positive(),
});

export async function updateSettings(owner: User, s: z.infer<typeof SettingsSchema>) {
  if (s.todaysRateSdgPerUsd < s.minRateSdgPerUsd) {
    throw new ApiError(422, "RATE_BELOW_MINIMUM", "Today's rate cannot be below the minimum rate.");
  }
  await withActor(owner.id, (c) =>
    c.query(`update shamsy.settings set todays_rate_sdg_per_usd = $1, min_rate_sdg_per_usd = $2 where id = 1`,
      [s.todaysRateSdgPerUsd, s.minRateSdgPerUsd]));
  return loadSettings();
}

export async function updateProductPrice(owner: User, productId: string, priceUsdCents: number) {
  await withActor(owner.id, (c) =>
    c.query(`update shamsy.products set price_usd_cents = $2 where id = $1`, [productId, priceUsdCents]));
  const rows = await query(`select id, sku, name, price_usd_cents as "priceUsdCents" from shamsy.products where id = $1`, [productId]);
  if (!rows[0]) throw new ApiError(404, "NOT_FOUND", "No such product.");
  return rows[0];
}
