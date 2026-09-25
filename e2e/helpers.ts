import { expect, type Page, type BrowserContext } from "@playwright/test";

export async function signIn(page: Page, who: "adviser" | "owner") {
  await page.goto("/login");
  await page.getByTestId("email").fill(`${who}@shamsy.test`);
  await page.getByTestId("password").fill(who === "adviser" ? "Adviser-2026" : "Owner-2026");
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("tab-new")).toBeVisible();
}

export async function addProduct(page: Page, name: string) {
  const select = page.getByTestId("add-product");
  const value = await select.locator("option", { hasText: name }).getAttribute("value");
  await select.selectOption(value!);
}

/** Enters the brief's worked example: 4 × SPF 6000 ($40 off), 2 × Hope 5.0L ($70 off), 1 × Hope 16.0LM ($150 off). */
export async function enterWorkedExample(page: Page) {
  await page.getByTestId("customer").selectOption({ label: "Ahmed Trading — Khartoum" });
  await page.getByTestId("rate").fill("8200");
  await page.getByTestId("rate").blur();
  await addProduct(page, "SPF 6000 ES Plus");
  await addProduct(page, "Hope 5.0L-B1");
  await addProduct(page, "Hope 16.0LM-A1");
  await page.getByTestId("qty-1").fill("4");
  await page.getByTestId("discount-1").fill("40");
  await page.getByTestId("qty-2").fill("2");
  await page.getByTestId("discount-2").fill("70");
  await page.getByTestId("discount-3").fill("150");
}

export async function resetDraft(context: BrowserContext) {
  await context.clearCookies();
}
