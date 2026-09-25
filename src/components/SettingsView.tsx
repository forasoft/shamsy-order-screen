"use client";

import { useState } from "react";
import { formatRate, formatUsd, parseRate, parseUsdToCents } from "@/lib/money";
import { api } from "@/lib/client/api";
import type { Bootstrap, Product, Settings } from "@/lib/client/types";
import { Banner, Button } from "./ui";

export function SettingsView({ boot, onChanged }: { boot: Bootstrap; onChanged: () => void }) {
  const [todays, setTodays] = useState(formatRate(boot.settings.todaysRateSdgPerUsd));
  const [min, setMin] = useState(formatRate(boot.settings.minRateSdgPerUsd));
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const saveRates = async () => {
    const t = parseRate(todays), m = parseRate(min);
    if (t === null || m === null) return setMsg({ tone: "error", text: "Rates are whole numbers of pounds per dollar." });
    try {
      const { settings } = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: { todaysRateSdgPerUsd: t, minRateSdgPerUsd: m } });
      setMsg({ tone: "ok", text: `Saved: today's rate ${formatRate(settings.todaysRateSdgPerUsd)}, minimum ${formatRate(settings.minRateSdgPerUsd)}. Saved orders keep their own rate.` });
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
  };

  return (
    <div className="space-y-5 p-4" data-testid="settings">
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">Rates (owner)</h2>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-2">Today&apos;s rate — the starting value on new orders</span>
          <input data-testid="set-todays" inputMode="numeric" value={todays} onChange={(e) => setTodays(e.target.value)} className="num min-h-12 w-full rounded-lg border border-line px-3 text-lg font-semibold" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-2">Minimum rate — no order can be saved below it</span>
          <input data-testid="set-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} className="num min-h-12 w-full rounded-lg border border-line px-3 text-lg font-semibold" />
        </label>
        <Button onClick={saveRates} testId="save-rates">Save rates</Button>
        {msg && <Banner tone={msg.tone} testId="settings-msg">{msg.text}</Banner>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">Prices in dollars (owner)</h2>
        <p className="text-xs text-ink-2">Advisers cannot change prices. A new price applies to new orders; saved orders keep the price they were saved with.</p>
        {boot.products.map((p) => <PriceRow key={p.id} product={p} onChanged={onChanged} />)}
      </section>
    </div>
  );
}

function PriceRow({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const [value, setValue] = useState(String(product.priceUsdCents / 100));
  const [state, setState] = useState<string | null>(null);
  const save = async () => {
    const cents = parseUsdToCents(value);
    if (!cents) return setState("Enter a price in dollars.");
    try {
      const { product: p } = await api<{ product: Product }>(`/api/products/${product.id}`, { method: "PUT", body: { priceUsdCents: cents } });
      setState(`Saved: ${formatUsd(p.priceUsdCents)}`);
      onChanged();
    } catch (e) {
      setState((e as Error).message);
    }
  };
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-sm font-semibold">{product.name}</div>
      <div className="mt-2 flex gap-2">
        <div className="flex min-h-11 flex-1 items-center rounded-lg border border-line px-2"><span className="text-ink-2">$</span>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="num w-full px-1 font-semibold outline-none" /></div>
        <Button variant="secondary" onClick={save}>Save price</Button>
      </div>
      {state && <p className="mt-1 text-xs text-ink-2">{state}</p>}
    </div>
  );
}
