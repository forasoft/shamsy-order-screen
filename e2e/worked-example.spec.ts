import { expect, test } from "@playwright/test";
import { addProduct, enterWorkedExample, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("the screen reproduces the worked example exactly, and saves without the blocked line", async ({ page }) => {
  await signIn(page, "adviser");
  await enterWorkedExample(page);

  const expectLine = async (n: number, value: string, pct: string, band: string, total: string) => {
    await expect(page.getByTestId(`value-${n}`)).toHaveText(value);
    await expect(page.getByTestId(`pct-${n}`)).toContainText(pct);
    await expect(page.getByTestId(`line-${n}`)).toHaveAttribute("data-band", band);
    await expect(page.getByTestId(`total-${n}`)).toHaveText(total);
  };
  await expectLine(1, "$2,060", "1.94%", "sand", "$2,020");
  await expectLine(2, "$1,620", "4.32%", "red", "$1,550");
  await expectLine(3, "$2,070", "7.25%", "blocked", "$1,920");

  // blocked: the order cannot be saved
  await expect(page.getByTestId("save")).toBeDisabled();
  await expect(page.getByTestId("blocked-3")).toBeVisible();

  // remove line 3: $3,570 = 29,274,000 SDG, and it saves
  await page.getByTestId("remove-3").click();
  await expect(page.getByTestId("order-usd")).toHaveText("$3,570");
  await expect(page.getByTestId("order-sdg")).toHaveText("29,274,000 SDG");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("saved-banner")).toContainText("saved");
  await expect(page.getByTestId("saved-usd")).toHaveText("$3,570");
  await expect(page.getByTestId("saved-sdg")).toHaveText("29,274,000 SDG");
});

test("a rate of 7,900 is refused and returns to 8,000", async ({ page }) => {
  await signIn(page, "adviser");
  await page.getByTestId("rate").fill("7900");
  await expect(page.getByTestId("rate-error")).toBeVisible();
  await expect(page.getByTestId("add-product")).toBeDisabled();
  await page.getByTestId("rate").blur();
  await expect(page.getByTestId("rate")).toHaveValue("8,000");
  await expect(page.getByTestId("rate-notice")).toContainText("set back to 8,000");
});

test("the owner approves line 3: $5,490 = 45,018,000 SDG; a later rate change does not move it", async ({ browser }) => {
  const phone = { ...(await import("@playwright/test")).devices["Pixel 7"] };
  const adviserCtx = await browser.newContext(phone);
  const a = await adviserCtx.newPage();
  await signIn(a, "adviser");
  await enterWorkedExample(a);
  await a.getByTestId("ask-owner").click();
  await expect(a.getByTestId("requested-banner")).toContainText("not saved until the owner approves");

  const ownerCtx = await browser.newContext(phone);
  const o = await ownerCtx.newPage();
  await signIn(o, "owner");
  await o.getByTestId("tab-approvals").click();
  await o.getByTestId("approval-row").filter({ hasText: "waiting" }).first().click();
  await expect(o.getByTestId("approve-save")).toBeDisabled();
  await o.getByTestId("owner-approve-3").check();
  await o.getByTestId("approve-save").click();
  await expect(o.getByTestId("approved-usd")).toHaveText("$5,490");
  await expect(o.getByTestId("approved-sdg")).toHaveText("45,018,000 SDG");
  await o.getByTestId("approved-view").click();
  const orderUrlNumber = await o.getByTestId("order-number").textContent();

  // change the rate setting to 9,000, reopen the saved order
  await o.getByTestId("tab-settings").click();
  await o.getByTestId("set-todays").fill("9000");
  await o.getByTestId("save-rates").click();
  await expect(o.getByTestId("settings-msg")).toContainText("today's rate 9,000");
  await o.getByTestId("tab-orders").click();
  await o.getByTestId("order-row").filter({ hasText: orderUrlNumber! }).click();
  await expect(o.getByTestId("view-rate")).toHaveText("8,200");
  await expect(o.getByTestId("view-sdg")).toHaveText("45,018,000 SDG");
  await expect(o.getByTestId("view-todays-rate")).toHaveText("9,000");

  // put the setting back for the next runs
  await o.getByTestId("tab-settings").click();
  await o.getByTestId("set-todays").fill("8200");
  await o.getByTestId("save-rates").click();
  await expect(o.getByTestId("settings-msg")).toContainText("today's rate 8,200");
  await adviserCtx.close(); await ownerCtx.close();
});

test("without a connection the order is kept on the phone and saved exactly once when it returns", async ({ page, context, request }) => {
  await signIn(page, "adviser");
  const token = (await (await request.post("/api/auth/login", { data: { email: "adviser@shamsy.test", password: "Adviser-2026" } })).json()).token;
  const count = async () => (await (await request.get("/api/orders", { headers: { authorization: `Bearer ${token}` } })).json()).orders.length;
  const before = await count();

  await page.getByTestId("customer").selectOption({ label: "Nile Solar — Omdurman" });
  await addProduct(page, "SPE 12000 ES");
  await page.getByTestId("discount-1").fill("20");

  await context.setOffline(true);
  await expect(page.getByTestId("connection")).toHaveAttribute("data-online", "false");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("queued-banner")).toBeVisible();

  // the app still opens without a connection, and the queued order is still there
  await page.reload();
  await page.getByTestId("tab-orders").click();
  await expect(page.getByTestId("outbox-item")).toHaveCount(1);
  expect(await count()).toBe(before);

  await context.setOffline(false);
  await expect(page.getByTestId("outbox-item")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(count, { timeout: 10_000 }).toBe(before + 1);
});
