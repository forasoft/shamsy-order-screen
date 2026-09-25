// The server refuses what the rules forbid, whoever calls it and however.
// Runs against APP_URL (default http://localhost:3000), e.g. APP_URL=https://<deployment> npm run test:api
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
const login = async (email: string, password: string) => (await call("POST", "/api/auth/login", undefined, { email, password })).body.token as string;

let adviser: string, owner: string, customerId: string;
let P: Record<string, { id: string; priceUsdCents: number }>;
const line = (sku: string, quantity: number, discountUsdCents: number, extra: Json = {}): Json =>
  ({ productId: P[sku].id, quantity, unitPriceUsdCents: P[sku].priceUsdCents, discountUsdCents, ...extra });
const worked = () => [line("SPF-6000-ES-PLUS", 4, 4000), line("HOPE-5.0L-B1", 2, 7000), line("HOPE-16.0LM-A1", 1, 15000)];

beforeAll(async () => {
  adviser = await login("adviser@shamsy.test", "Adviser-2026");
  owner = await login("owner@shamsy.test", "Owner-2026");
  const boot = (await call("GET", "/api/bootstrap", adviser)).body;
  P = Object.fromEntries(boot.products.map((p: Json) => [p.sku, p]));
  customerId = boot.customers.find((c: Json) => c.name === "Ahmed Trading").id;
});

describe("direct calls to the server, as the adviser", () => {
  it("refuses a 7.25% discount without approval, and saves nothing", async () => {
    const id = randomUUID();
    const r = await call("POST", "/api/orders", adviser, { id, customerId, rateSdgPerUsd: 8200, lines: worked() });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("DISCOUNT_NEEDS_OWNER_APPROVAL");
    expect(r.body.error.message).toContain("7.25%");
    expect((await call("GET", `/api/orders/${id}`, adviser)).status).toBe(404);
  });

  it("refuses the same call with an approval flag the adviser set herself", async () => {
    const lines = worked(); lines[2] = { ...lines[2], approve: true };
    const r = await call("POST", "/api/orders", adviser, { id: randomUUID(), customerId, rateSdgPerUsd: 8200, lines });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("APPROVAL_ONLY_BY_OWNER");
  });

  it("refuses a price the adviser changed", async () => {
    const r = await call("POST", "/api/orders", adviser, { id: randomUUID(), customerId, rateSdgPerUsd: 8200, lines: [{ ...line("SPF-6000-ES-PLUS", 4, 0), unitPriceUsdCents: 40000 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PRICE_IS_FIXED");
  });

  it("refuses a rate of 7,900", async () => {
    const r = await call("POST", "/api/orders", adviser, { id: randomUUID(), customerId, rateSdgPerUsd: 7900, lines: worked().slice(0, 2) });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("RATE_BELOW_MINIMUM");
  });

  it("refuses a call without a signed-in user", async () => {
    const r = await call("POST", "/api/orders", undefined, { id: randomUUID(), customerId, rateSdgPerUsd: 8200, lines: worked().slice(0, 2) });
    expect(r.status).toBe(401);
  });

  it("refuses setting changes, price changes and approvals by the adviser", async () => {
    expect((await call("PUT", "/api/settings", adviser, { todaysRateSdgPerUsd: 9000, minRateSdgPerUsd: 7000 })).status).toBe(403);
    expect((await call("PUT", `/api/products/${P["SPF-6000-ES-PLUS"].id}`, adviser, { priceUsdCents: 100 })).status).toBe(403);
  });
});

describe("the worked example, end to end", () => {
  let savedId: string;

  it("without the third line: $3,570 = 29,274,000 SDG, saved", async () => {
    savedId = randomUUID();
    const r = await call("POST", "/api/orders", adviser, {
      id: savedId, customerId, rateSdgPerUsd: 8200, lines: worked().slice(0, 2),
      expected: { totalUsdCents: 357000, totalSdgPiastres: 2927400000 },
    });
    expect(r.status).toBe(201);
    expect(r.body.order.totalUsdCents).toBe(357000);
    expect(r.body.order.totalSdgPiastres).toBe(2927400000); // 29,274,000.00 SDG
    expect(r.body.order.lines.map((l: Json) => [l.discountBp, l.band, l.lineTotalUsdCents])).toEqual([[194, "sand", 202000], [432, "red", 155000]]);
  });

  it("saving the same order again returns the first save, not a second order", async () => {
    const before = (await call("GET", "/api/orders", adviser)).body.orders.length;
    const r = await call("POST", "/api/orders", adviser, { id: savedId, customerId, rateSdgPerUsd: 8200, lines: worked().slice(0, 2) });
    expect(r.status).toBe(200);
    expect(r.body.replayed).toBe(true);
    expect((await call("GET", "/api/orders", adviser)).body.orders.length).toBe(before);
  });

  it("with the third line approved by the owner: $5,490 = 45,018,000 SDG", async () => {
    const reqId = randomUUID();
    expect((await call("POST", "/api/approval-requests", adviser, { id: reqId, customerId, rateSdgPerUsd: 8200, lines: worked() })).status).toBe(201);
    expect((await call("POST", `/api/approval-requests/${reqId}/approve`, adviser, { approveLineNos: [3] })).status).toBe(403);
    const r = await call("POST", `/api/approval-requests/${reqId}/approve`, owner, { approveLineNos: [3] });
    expect(r.status).toBe(201);
    expect(r.body.order.totalUsdCents).toBe(549000);
    expect(r.body.order.totalSdgPiastres).toBe(4501800000); // 45,018,000.00 SDG
    expect(r.body.order.lines[2].approvedByName).toBeTruthy();
    savedId = r.body.order.id;
  });

  it("change the rate setting to 9,000: the saved order still shows 8,200 and 45,018,000 SDG", async () => {
    const settings = (await call("GET", "/api/bootstrap", owner)).body.settings;
    expect((await call("PUT", "/api/settings", owner, { todaysRateSdgPerUsd: 9000, minRateSdgPerUsd: settings.minRateSdgPerUsd })).status).toBe(200);
    const o = (await call("GET", `/api/orders/${savedId}`, adviser)).body.order;
    await call("PUT", "/api/settings", owner, { todaysRateSdgPerUsd: settings.todaysRateSdgPerUsd, minRateSdgPerUsd: settings.minRateSdgPerUsd });
    expect([o.rateSdgPerUsd, o.totalSdgPiastres]).toEqual([8200, 4501800000]);
  });
});
