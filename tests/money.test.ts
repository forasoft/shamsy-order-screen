import { describe, expect, it } from "vitest";
import { computeLine, orderTotals, formatUsd, formatSdg, formatBp, parseUsdToCents, parseRate } from "@/lib/money";

const t = { sandMaxBp: 300, redMaxBp: 500 };

describe("the brief's worked example, at a rate of 8,200", () => {
  const l1 = computeLine({ unitPriceUsdCents: 51500, quantity: 4, discountUsdCents: 4000 }, t);
  const l2 = computeLine({ unitPriceUsdCents: 81000, quantity: 2, discountUsdCents: 7000 }, t);
  const l3 = computeLine({ unitPriceUsdCents: 207000, quantity: 1, discountUsdCents: 15000 }, t);

  it("line 1: 4 × $515 with $40 discount -> 1.94%, sand, $2,020", () => {
    expect([formatUsd(l1.lineValueUsdCents), formatBp(l1.discountBp), l1.band, formatUsd(l1.lineTotalUsdCents)]).toEqual(["$2,060", "1.94%", "sand", "$2,020"]);
  });
  it("line 2: 2 × $810 with $70 discount -> 4.32%, red, $1,550", () => {
    expect([formatUsd(l2.lineValueUsdCents), formatBp(l2.discountBp), l2.band, formatUsd(l2.lineTotalUsdCents)]).toEqual(["$1,620", "4.32%", "red", "$1,550"]);
  });
  it("line 3: 1 × $2,070 with $150 discount -> 7.25%, blocked, $1,920", () => {
    expect([formatUsd(l3.lineValueUsdCents), formatBp(l3.discountBp), l3.band, formatUsd(l3.lineTotalUsdCents)]).toEqual(["$2,070", "7.25%", "blocked", "$1,920"]);
    expect(l3.needsApproval).toBe(true);
    expect(computeLine({ unitPriceUsdCents: 207000, quantity: 1, discountUsdCents: 15000, approved: true }, t).needsApproval).toBe(false);
  });
  it("without the third line: $3,570 = 29,274,000 SDG", () => {
    const o = orderTotals([l1.lineTotalUsdCents, l2.lineTotalUsdCents], 8200);
    expect([formatUsd(o.totalUsdCents), formatSdg(o.totalSdgPiastres)]).toEqual(["$3,570", "29,274,000 SDG"]);
  });
  it("with the third line approved: $5,490 = 45,018,000 SDG", () => {
    const o = orderTotals([l1.lineTotalUsdCents, l2.lineTotalUsdCents, l3.lineTotalUsdCents], 8200);
    expect([formatUsd(o.totalUsdCents), formatSdg(o.totalSdgPiastres)]).toEqual(["$5,490", "45,018,000 SDG"]);
  });
});

describe("band edges are exact, not rounded", () => {
  // $1,000 line: 3.00% = $30 is still sand; one cent more is red. 5.00% = $50 is red; one cent more is blocked.
  const band = (d: number) => computeLine({ unitPriceUsdCents: 100000, quantity: 1, discountUsdCents: d }, t).band;
  it("0 -> none", () => expect(band(0)).toBe("none"));
  it("3.00% -> sand, 3.001% -> red", () => { expect(band(3000)).toBe("sand"); expect(band(3001)).toBe("red"); });
  it("5.00% -> red, 5.001% -> blocked", () => { expect(band(5000)).toBe("red"); expect(band(5001)).toBe("blocked"); });
  it("a discount larger than the line is flagged", () => {
    expect(computeLine({ unitPriceUsdCents: 1000, quantity: 1, discountUsdCents: 1001 }, t).discountTooLarge).toBe(true);
  });
});

describe("input parsing", () => {
  it("dollars to cents without floating point", () => {
    expect(parseUsdToCents("40")).toBe(4000);
    expect(parseUsdToCents("40.5")).toBe(4050);
    expect(parseUsdToCents("$1,040.25")).toBe(104025);
    expect(parseUsdToCents("0.1")).toBe(10);
    expect(parseUsdToCents("40.555")).toBeNull();
    expect(parseUsdToCents("4O")).toBeNull();
  });
  it("rates are whole numbers; thousands separators are fine", () => {
    expect(parseRate("8,200")).toBe(8200);
    expect(parseRate("8200.5")).toBeNull();
    expect(parseRate("")).toBeNull();
  });
});
