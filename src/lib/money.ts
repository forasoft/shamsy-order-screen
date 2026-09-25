// Shared order arithmetic — used by the screen for instant feedback and by the server
// before it writes. The database recomputes all of it again and is the final word.
// Whole numbers only: dollars in cents, pounds in piastres, percentages in basis points.

export type Band = "none" | "sand" | "red" | "blocked";

export interface Thresholds {
  sandMaxBp: number; // 300 = 3.00 %
  redMaxBp: number; // 500 = 5.00 %
}

export interface LineInput {
  unitPriceUsdCents: number;
  quantity: number;
  discountUsdCents: number;
  approved?: boolean;
}

export interface LineResult {
  lineValueUsdCents: number;
  discountBp: number; // rounded, for display
  band: Band;
  lineTotalUsdCents: number;
  needsApproval: boolean; // blocked and not approved
  discountTooLarge: boolean;
}

export function discountBand(discountCents: number, valueCents: number, t: Thresholds): Band {
  if (discountCents === 0) return "none";
  if (discountCents * 10000 <= valueCents * t.sandMaxBp) return "sand";
  if (discountCents * 10000 <= valueCents * t.redMaxBp) return "red";
  return "blocked";
}

export function computeLine(line: LineInput, t: Thresholds): LineResult {
  const lineValueUsdCents = line.unitPriceUsdCents * line.quantity;
  const discountTooLarge = line.discountUsdCents > lineValueUsdCents;
  const discountBp = lineValueUsdCents > 0 ? Math.round((line.discountUsdCents * 10000) / lineValueUsdCents) : 0;
  const band = discountBand(line.discountUsdCents, lineValueUsdCents, t);
  return {
    lineValueUsdCents,
    discountBp,
    band,
    lineTotalUsdCents: lineValueUsdCents - line.discountUsdCents,
    needsApproval: band === "blocked" && !line.approved,
    discountTooLarge,
  };
}

export function orderTotals(lineTotalsUsdCents: number[], rateSdgPerUsd: number) {
  const totalUsdCents = lineTotalsUsdCents.reduce((a, b) => a + b, 0);
  // 1 cent = 1/100 USD; 1 piastre = 1/100 SDG  =>  piastres = cents × rate
  return { totalUsdCents, totalSdgPiastres: totalUsdCents * rateSdgPerUsd };
}

// ---------------------------------------------------------------- formatting

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${int.format(dollars)}${rest ? "." + String(rest).padStart(2, "0") : ""}`;
}

export function formatSdg(piastres: number): string {
  const pounds = Math.floor(piastres / 100);
  const rest = piastres % 100;
  return `${int.format(pounds)}${rest ? "." + String(rest).padStart(2, "0") : ""} SDG`;
}

export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

export function formatRate(rate: number): string {
  return int.format(rate);
}

// "40", "40.5", "40.50", "$1,040" -> cents; null when not a valid amount
export function parseUsdToCents(input: string): number | null {
  const s = input.replace(/[$,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

// "8,200" -> 8200; null when not a whole number
export function parseRate(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}
