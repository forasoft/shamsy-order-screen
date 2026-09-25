// Screen recording of the worked example, with captions. Run: npm run video
import { expect, test, type Page } from "@playwright/test";
import { addProduct, enterWorkedExample } from "./helpers";

async function caption(page: Page, text: string, ms = 2600) {
  await page.evaluate((t) => {
    let el = document.getElementById("__caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__caption";
      el.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:9999;background:rgba(17,24,39,.92);color:#fff;font:600 15px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:pre-wrap;pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await page.waitForTimeout(ms);
}
const hideCaption = (page: Page) => page.evaluate(() => document.getElementById("__caption")?.remove());

async function signInAs(page: Page, who: "adviser" | "owner") {
  if (!page.url().endsWith("/login")) await page.goto("/login");
  await caption(page, who === "adviser" ? "Signing in as the sales adviser (on a phone)." : "Signing in as the owner.", 1800);
  await page.getByTestId("email").fill(`${who}@shamsy.test`);
  await page.getByTestId("password").fill(who === "adviser" ? "Adviser-2026" : "Owner-2026");
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("tab-new")).toBeVisible();
}

test("walkthrough of the worked example", async ({ page, context }) => {
  test.setTimeout(290_000);
  await page.goto("/login");
  await caption(page, "Shamsy trial — the order screen.\nThe brief's worked example at a rate of 8,200, then the owner's approval, a rate change, a direct server call and a dropped connection.", 4500);

  await signInAs(page, "adviser");
  await caption(page, "Pick the dealer and enter today's rate. Prices are fixed in dollars — the adviser cannot change them.", 2500);
  await enterWorkedExample(page);
  await hideCaption(page);
  await page.getByTestId("line-1").scrollIntoViewIfNeeded();
  await caption(page, "Line 1: 4 × $515 = $2,060, $40 off → 1.94%, sand → $2,020", 3000);
  await page.getByTestId("line-2").scrollIntoViewIfNeeded();
  await caption(page, "Line 2: 2 × $810 = $1,620, $70 off → 4.32%, red → $1,550", 3000);
  await page.getByTestId("line-3").scrollIntoViewIfNeeded();
  await caption(page, "Line 3: 1 × $2,070, $150 off → 7.25%, blocked → $1,920.\nSave is disabled: the adviser can lower it, remove it, or ask the owner.", 4000);

  await caption(page, "Asking the owner to approve line 3. This is a request, not a saved order.", 2200);
  await page.getByTestId("ask-owner").click();
  await expect(page.getByTestId("requested-banner")).toBeVisible();
  await page.waitForTimeout(1500);

  await page.getByTestId("new-order").click();
  await caption(page, "Same order again — this time the adviser removes line 3.", 2000);
  await enterWorkedExample(page);
  await page.getByTestId("remove-3").click();
  await expect(page.getByTestId("order-sdg")).toHaveText("29,274,000 SDG");
  await caption(page, "Without line 3: $3,570 = 29,274,000 SDG, and it saves.", 3000);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("saved-banner")).toBeVisible();
  await page.waitForTimeout(2000);

  await page.getByTestId("new-order").click();
  await caption(page, "The minimum rate is 8,000. Typing 7,900…", 1500);
  await page.getByTestId("rate").fill("7900");
  await caption(page, "…turns the field red, and products cannot be added.", 2500);
  await page.getByTestId("customer").focus();
  await expect(page.getByTestId("rate")).toHaveValue("8,000");
  await caption(page, "Leaving the field puts it back to 8,000. The server and the database refuse 7,900 as well.", 3500);

  await caption(page, "Calling the server directly, as the adviser, with 7.25% and no approval:", 2500);
  const direct = await page.evaluate(async () => {
    const boot = await (await fetch("/api/bootstrap")).json();
    const p = (sku: string) => boot.products.find((x: { sku: string }) => x.sku === sku);
    const body = {
      id: crypto.randomUUID(), customerId: boot.customers[0].id, rateSdgPerUsd: 8200,
      lines: [
        { productId: p("SPF-6000-ES-PLUS").id, quantity: 4, unitPriceUsdCents: 51500, discountUsdCents: 4000 },
        { productId: p("HOPE-5.0L-B1").id, quantity: 2, unitPriceUsdCents: 81000, discountUsdCents: 7000 },
        { productId: p("HOPE-16.0LM-A1").id, quantity: 1, unitPriceUsdCents: 207000, discountUsdCents: 15000 },
      ],
    };
    const r = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return `POST /api/orders → HTTP ${r.status}\n${JSON.stringify(await r.json(), null, 1)}`;
  });
  await caption(page, direct + "\n\nRefused on the server. The database refuses it too (see tests/db-rules.test.ts).", 7000);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await signInAs(page, "owner");
  await page.getByTestId("tab-approvals").click();
  await page.getByTestId("approval-row").filter({ hasText: "waiting" }).first().click();
  await caption(page, "The owner opens the request. Line 3 needs a tick.", 2500);
  await page.getByTestId("owner-approve-3").check();
  await page.getByTestId("approve-save").click();
  await expect(page.getByTestId("approved-sdg")).toHaveText("45,018,000 SDG");
  await caption(page, "Approved and saved: $5,490 = 45,018,000 SDG. The approval is recorded with the owner's name.", 3500);
  await page.getByTestId("approved-view").click();
  const number = await page.getByTestId("order-number").textContent();

  await page.getByTestId("tab-settings").click();
  await caption(page, "Now the owner changes today's rate to 9,000…", 1800);
  await page.getByTestId("set-todays").fill("9000");
  await page.getByTestId("save-rates").click();
  await page.waitForTimeout(1200);
  await page.getByTestId("tab-orders").click();
  await page.getByTestId("order-row").filter({ hasText: number! }).click();
  await expect(page.getByTestId("view-rate")).toHaveText("8,200");
  await caption(page, `…and reopens ${number}: it still shows 8,200 and 45,018,000 SDG. A saved order never moves.`, 4500);
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("set-todays").fill("8200");
  await page.getByTestId("save-rates").click();
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await signInAs(page, "adviser");
  await caption(page, "Bonus: the connection drops.", 1800);
  await page.getByTestId("customer").selectOption({ label: "Dongola Power — Dongola" });
  await addProduct(page, "SPE 12000 ES");
  await page.getByTestId("discount-1").fill("25");
  await context.setOffline(true);
  await caption(page, "Offline. The adviser saves anyway — the order is kept on the phone.", 2500);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("queued-banner")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.reload();
  await page.getByTestId("tab-orders").click();
  await caption(page, "Even after reloading without a connection, the app opens and the order waits to be sent.", 3500);
  await context.setOffline(false);
  await caption(page, "The connection returns: it is sent once, keyed on its id, so a retry can never make a second order.", 2000);
  await expect(page.getByTestId("outbox-item")).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await caption(page, "Done. Money in cents, the rate stored on every order, and every rule enforced on the server and in the database.", 4000);
});
