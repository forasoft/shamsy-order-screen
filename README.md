# Shamsy — order screen (trial task)

An adviser picks a dealer, adds products at fixed dollar prices, gives a discount per line, enters today's rate, and saves. Built on the project's stack: Next.js with TypeScript, PostgreSQL (Supabase), Tailwind, on Vercel.

**Live:** https://shamsy-forasoft.vercel.app — open it on a phone.

| Account | Email | Password |
|---|---|---|
| Sales adviser | `adviser@shamsy.test` | `Adviser-2026` |
| Owner | `owner@shamsy.test` | `Owner-2026` |

A 100-second screen recording of the worked example is attached to the delivery (`shamsy-order-screen-walkthrough.mp4`); `npm run video` records it again.

## The rules, and where each one is enforced

Every rule is checked three times: on the screen for instant feedback, on the server with a message the adviser can act on, and in the database, which is the final word. A client — the screen, `curl`, or a SQL session — cannot get past the database.

| Rule | Screen | Server (`src/lib/server/orders.ts`) | Database (`db/migrations/001_schema.sql`) |
|---|---|---|---|
| Prices are fixed in dollars; only the owner changes them | price shown locked | unit price must equal the catalogue price → `409 PRICE_IS_FIXED` | trigger refuses any other price; only an owner may update a product |
| Discount per line, measured against the line's value: ≤ 3 % sand, ≤ 5 % red, above 5 % blocked | colour per line, save disabled while blocked | `422 DISCOUNT_NEEDS_OWNER_APPROVAL` | trigger computes the band itself and refuses a blocked line without an approval |
| Only the owner can approve a blocked line | approval tick shown to the owner only | adviser sending `approve: true` → `403 APPROVAL_ONLY_BY_OWNER` | the approver must be an owner **and** the user acting in that transaction |
| One rate per order, never below 8,000 | field turns red, products cannot be added, value snaps back to 8,000 on leaving the field | `422 RATE_BELOW_MINIMUM` | trigger compares with the minimum in the settings |
| A saved order keeps its own rate | the order view shows the stored rate next to today's setting | the rate is stored on the order | orders and lines cannot be updated or deleted; lines cannot be added later |
| Money in whole numbers | — | cents and piastres, integer arithmetic | `bigint` columns; totals are checked at commit to be exactly the sum of the lines |

The thresholds (3 %, 5 %) and both rates are settings, not constants in code.

## How the server refusal was proved

1. **The call you will make.** `bash scripts/prove-server-refusal.sh` signs in as the adviser with a bearer token (no browser) and posts the worked example with line 3 at 7.25 % and no approval, then the same with `"approve": true` set by the adviser, a lowered price, and a rate of 7,900. Against the live deployment:

   ```
   == 1. The worked example with line 3 at 7.25% and no approval — must be refused
   HTTP 422
   {"error":{"code":"DISCOUNT_NEEDS_OWNER_APPROVAL","message":"Line 3: a discount of 7.25% is above the 5.00% limit and needs the owner's approval.","lineNo":3,"discountBp":725,"enforcedBy":"server"}}
   == 2. The same, with "approve": true written by the adviser herself — must be refused
   HTTP 403
   {"error":{"code":"APPROVAL_ONLY_BY_OWNER","message":"Line 3: only the owner can approve a discount.","lineNo":3}}
   ...
   == PASS: every call was refused and no order was saved
   ```

2. **Past the server, straight into the database.** `tests/db-rules.test.ts` writes orders directly into the tables as a hostile client would — derived columns filled with nonsense, a forged approval, a changed price, a rate of 7,900, wrong totals, updates to a saved order — and every one is refused by the database. The same insert was run on the live Supabase database:

   ```
   ERROR:  P0001: DISCOUNT_NEEDS_OWNER_APPROVAL
   DETAIL: Line 1: a discount of 7.25% is above the limit and needs the owner's approval.
   ```

3. **Automated tests** (all passing locally and against the live URL):
   - `tests/money.test.ts` — the worked example to the cent, and the exact band edges (3.00 % sand, 3.001 % red).
   - `tests/api.test.ts` — the refusals above over HTTP, idempotent saves, the owner's approval giving $5,490 = 45,018,000 SDG, and a saved order unchanged after the rate setting moves to 9,000.
   - `e2e/worked-example.spec.ts` — the screen on a phone viewport: every number of the worked example, the blocked line, 7,900 → 8,000, the owner's approval, and an order saved with no connection that syncs exactly once.

## Without a connection (the bonus)

- The draft is kept on the phone as it is typed; a reload or a dropped connection does not lose it.
- The app shell is cached by a service worker, so the screen opens with no connection.
- **Save** with no connection keeps the order on the phone and says so. It is sent when the connection returns.
- Every order carries an id generated on the phone. The server stores an order once per id and answers a repeat with the first save, so a retry after a lost response never creates a second order.
- On sync the server checks every rule again. If the owner changed a price or raised the minimum rate in the meantime, the order is refused with the reason and waits in **Orders** for the adviser to fix it.
- Asking the owner for an approval needs a connection.

## Run it locally

```bash
cp .env.example .env.local           # set DATABASE_URL and SESSION_SECRET
npm install
npm run db:setup                     # schema + trial data (npm run db:reset to start over)
npm run dev                          # http://localhost:3000
```

Tests: `npm test` (arithmetic + database rules), `npm run test:api` (HTTP; `APP_URL=` for another server), `npm run test:e2e` (Playwright, against `APP_URL`, default `http://localhost:3100` — `npm run build && npx next start -p 3100`), `npm run prove`.

## Deploy

1. Supabase: create a project and run `db/migrations/001_schema.sql` then `db/seed.sql` in the SQL editor (or `DATABASE_URL=… npm run db:setup`). The tables live in a `shamsy` schema that the public REST roles cannot reach.
2. Vercel: import the repository, set `DATABASE_URL` (the transaction-pooler connection string) and `SESSION_SECRET` (`openssl rand -hex 32`). Functions run in `fra1`, next to the database in `eu-central-1`.

## Layout

```
db/migrations/001_schema.sql   tables, and every rule as a trigger
db/seed.sql                    two users, three dealers, four products
src/lib/money.ts               shared arithmetic: bands, totals, formatting, parsing
src/lib/server/                database access, sessions, order service, error mapping
src/app/api/                   route handlers
src/components/                order screen, order view, approvals, settings
src/lib/client/outbox.ts       orders saved without a connection
public/sw.js                   app shell for offline use
tests/, e2e/                   unit, database, HTTP and Playwright tests
scripts/prove-server-refusal.sh
```
