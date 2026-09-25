"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeLine, orderTotals, formatUsd, formatSdg, formatRate, formatBp, parseRate, parseUsdToCents,
} from "@/lib/money";
import { api, ApiError, NetworkError } from "@/lib/client/api";
import { enqueue } from "@/lib/client/outbox";
import { load, save } from "@/lib/client/storage";
import type { Bootstrap, OrderPayload, SavedOrder } from "@/lib/client/types";
import { BandBadge, Banner, Button, Row, bandEdge, newId } from "./ui";

interface DraftLine { key: string; productId: string; quantity: number; discountInput: string; approve: boolean }
interface Draft { id: string; userId: string; customerId: string; rateInput: string; lines: DraftLine[]; startedAt: string }

const DRAFT_KEY = "shamsy.draft.v1";

function freshDraft(boot: Bootstrap): Draft {
  return { id: newId(), userId: boot.me.id, customerId: "", rateInput: formatRate(boot.settings.todaysRateSdgPerUsd), lines: [], startedAt: new Date().toISOString() };
}

type Outcome =
  | { kind: "saved"; order: SavedOrder }
  | { kind: "queued"; customerName: string; totalUsdCents: number; totalSdgPiastres: number; rate: number }
  | { kind: "requested"; customerName: string; blockedLines: number[] };

export function OrderEditor({ boot, online, onOpenOrder, onChanged }: {
  boot: Bootstrap; online: boolean; onOpenOrder: (id: string) => void; onChanged: () => void;
}) {
  const { settings, products, customers, me } = boot;
  const isOwner = me.role === "owner";
  // the draft lives on the phone, so a reload or a dropped connection never loses it
  const [draft, setDraft] = useState<Draft | null>(() => {
    const saved = load<Draft | null>(DRAFT_KEY, null);
    return saved && saved.lines && saved.userId === boot.me.id ? saved : freshDraft(boot);
  });
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const addRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (draft) save(DRAFT_KEY, draft);
  }, [draft]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const min = settings.minRateSdgPerUsd;

  const calc = useMemo(() => {
    if (!draft) return null;
    const rate = parseRate(draft.rateInput);
    const rateOk = rate !== null && rate >= min;
    const lines = draft.lines.map((l, i) => {
      const p = productById.get(l.productId);
      const discount = parseUsdToCents(l.discountInput);
      const r = computeLine({
        unitPriceUsdCents: p?.priceUsdCents ?? 0, quantity: l.quantity, discountUsdCents: discount ?? 0,
        approved: isOwner && l.approve,
      }, settings);
      return { ...l, lineNo: i + 1, product: p, discount, ...r };
    });
    const totals = orderTotals(lines.map((l) => l.lineTotalUsdCents), rate ?? 0);
    const blocked = lines.filter((l) => l.needsApproval).map((l) => l.lineNo);
    const problems: string[] = [];
    if (!draft.customerId) problems.push("Pick a dealer.");
    if (!lines.length) problems.push("Add at least one product.");
    if (!rateOk) problems.push(`The rate must be at least ${formatRate(min)} SDG per USD.`);
    lines.forEach((l) => {
      if (!l.product) problems.push(`Line ${l.lineNo}: this product is no longer in the catalogue.`);
      if (l.discount === null) problems.push(`Line ${l.lineNo}: enter the discount as an amount in dollars, like 40 or 40.50.`);
      else if (l.discountTooLarge) problems.push(`Line ${l.lineNo}: the discount is larger than the line value.`);
    });
    if (blocked.length) {
      problems.push(isOwner
        ? `Line ${blocked.join(", ")}: approve the discount above ${formatBp(settings.redMaxBp)} to save.`
        : `Line ${blocked.join(", ")}: a discount above ${formatBp(settings.redMaxBp)} needs the owner's approval. Lower it, remove the line, or ask the owner.`);
    }
    return { rate, rateOk, lines, totals, blocked, problems };
  }, [draft, productById, settings, min, isOwner]);

  if (!draft || !calc) return null;
  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setError(null); };
  const setLine = (key: string, patch: Partial<DraftLine>) =>
    set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const onRateBlur = () => {
    const r = parseRate(draft.rateInput);
    if (r === null || r < min) {
      setRateNotice(`${draft.rateInput || "An empty rate"} is below the minimum. The rate was set back to ${formatRate(min)}.`);
      set({ rateInput: formatRate(min) });
    } else {
      setRateNotice(null);
      set({ rateInput: formatRate(r) });
    }
  };

  const addProduct = (productId: string) => {
    if (!productId) return;
    set({ lines: [...draft.lines, { key: newId(), productId, quantity: 1, discountInput: "", approve: false }] });
    if (addRef.current) addRef.current.value = "";
  };

  const payload = (): OrderPayload => ({
    id: draft.id,
    customerId: draft.customerId,
    rateSdgPerUsd: calc.rate!,
    lines: calc.lines.map((l) => ({
      productId: l.productId, quantity: l.quantity, unitPriceUsdCents: l.product!.priceUsdCents,
      discountUsdCents: l.discount ?? 0, ...(isOwner && l.band === "blocked" && l.approve ? { approve: true } : {}),
    })),
    expected: calc.totals,
    createdOnDeviceAt: draft.startedAt,
  });
  const customerName = customers.find((c) => c.id === draft.customerId)?.name ?? "";

  const newOrder = () => { setOutcome(null); setError(null); setRateNotice(null); setDraft(freshDraft(boot)); };

  const saveOrder = async () => {
    setBusy(true); setError(null);
    const body = payload();
    try {
      if (!online) throw new NetworkError("offline");
      const { order } = await api<{ order: SavedOrder }>("/api/orders", { body });
      setOutcome({ kind: "saved", order });
      setDraft(freshDraft(boot));
    } catch (e) {
      if (e instanceof NetworkError) {
        enqueue(body, customerName, me.id);
        setOutcome({ kind: "queued", customerName, totalUsdCents: calc.totals.totalUsdCents, totalSdgPiastres: calc.totals.totalSdgPiastres, rate: calc.rate! });
        setDraft(freshDraft(boot));
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Something went wrong. The order is still here; try again.");
      }
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const requestApproval = async () => {
    setBusy(true); setError(null);
    const body = payload();
    try {
      await api("/api/approval-requests", { body: { id: body.id, customerId: body.customerId, rateSdgPerUsd: body.rateSdgPerUsd, lines: body.lines } });
      setOutcome({ kind: "requested", customerName, blockedLines: calc.blocked });
      setDraft(freshDraft(boot));
    } catch (e) {
      setError(e instanceof NetworkError ? "Asking the owner needs a connection. The order is kept here." : (e as Error).message);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  if (outcome) {
    return (
      <div className="space-y-4 p-4" data-testid="outcome">
        {outcome.kind === "saved" && (
          <Banner tone="ok" testId="saved-banner">
            <div className="text-base font-bold">Order {outcome.order.orderNumber} saved</div>
            <div className="num mt-1">{outcome.order.customer.name} · <b data-testid="saved-usd">{formatUsd(outcome.order.totalUsdCents)}</b> ·{" "}
              <b data-testid="saved-sdg">{formatSdg(outcome.order.totalSdgPiastres)}</b> at {formatRate(outcome.order.rateSdgPerUsd)}</div>
          </Banner>
        )}
        {outcome.kind === "queued" && (
          <Banner tone="warn" testId="queued-banner">
            <div className="text-base font-bold">Saved on this phone — not sent yet</div>
            <div className="num mt-1">{outcome.customerName} · {formatUsd(outcome.totalUsdCents)} · {formatSdg(outcome.totalSdgPiastres)} at {formatRate(outcome.rate)}.
              It is sent automatically when the connection returns, exactly once. Orders shows its status.</div>
          </Banner>
        )}
        {outcome.kind === "requested" && (
          <Banner tone="info" testId="requested-banner">
            <div className="text-base font-bold">Sent to the owner for approval</div>
            <div className="mt-1">{outcome.customerName}: line {outcome.blockedLines.join(", ")} needs approval. The order is not saved until the owner approves it.</div>
          </Banner>
        )}
        <div className="flex gap-2">
          {outcome.kind === "saved" && <Button variant="secondary" onClick={() => onOpenOrder(outcome.order.id)} testId="view-saved">View order</Button>}
          <Button onClick={newOrder} testId="new-order">New order</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-56">
      <div className="space-y-4 p-4">
        {/* dealer */}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-2">Dealer</span>
          <select data-testid="customer" value={draft.customerId} onChange={(e) => set({ customerId: e.target.value })}
            className="min-h-12 w-full rounded-lg border border-line bg-white px-3 text-base">
            <option value="">Pick a dealer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.city}</option>)}
          </select>
        </label>

        {/* rate: one for the whole order, never below the minimum */}
        <div>
          <label htmlFor="rate" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-2">Today&apos;s rate for this order</label>
          <div className={`flex min-h-12 items-center rounded-lg border bg-white px-3 ${!calc.rateOk ? "border-red-edge ring-2 ring-red-edge/40" : "border-line"}`}>
            <input id="rate" data-testid="rate" inputMode="numeric" autoComplete="off" value={draft.rateInput}
              onFocus={(e) => e.currentTarget.select()} onBlur={onRateBlur}
              onChange={(e) => { setRateNotice(null); set({ rateInput: e.target.value }); }}
              className="num w-full bg-transparent text-lg font-semibold outline-none" />
            <span className="shrink-0 text-sm text-ink-2">SDG per USD</span>
          </div>
          {!calc.rateOk && <p data-testid="rate-error" className="mt-1 text-sm font-medium text-red-fg">Minimum is {formatRate(min)} SDG per USD — a lower rate is refused.</p>}
          {rateNotice && calc.rateOk && <p data-testid="rate-notice" className="mt-1 text-sm text-red-fg">{rateNotice}</p>}
        </div>

        {/* lines */}
        <div className="space-y-3" data-testid="lines">
          {calc.lines.map((l) => (
            <div key={l.key} data-testid={`line-${l.lineNo}`} data-band={l.band}
              className={`rounded-lg border border-line border-l-4 p-3 ${bandEdge(l.band, isOwner && l.approve)}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-ink-2">Line {l.lineNo}</div>
                  <div className="font-semibold leading-snug">{l.product?.name ?? "Unknown product"}</div>
                  <div className="num text-sm text-ink-2" title="Prices are fixed; only the owner can change them">
                    <span data-testid="unit-price">{formatUsd(l.product?.priceUsdCents ?? 0)}</span> each · 🔒 fixed price
                  </div>
                </div>
                <button aria-label={`Remove line ${l.lineNo}`} data-testid={`remove-${l.lineNo}`}
                  onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })}
                  className="min-h-10 min-w-10 rounded-lg text-xl leading-none text-ink-2 hover:bg-panel">×</button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 block text-xs text-ink-2">Quantity</span>
                  <div className="flex h-11 items-center rounded-lg border border-line bg-white">
                    <button className="h-full w-11 text-lg" aria-label="Less" onClick={() => setLine(l.key, { quantity: Math.max(1, l.quantity - 1) })}>−</button>
                    <input data-testid={`qty-${l.lineNo}`} inputMode="numeric" value={l.quantity}
                      onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, "") || "1", 10); setLine(l.key, { quantity: Math.min(100000, Math.max(1, n)) }); }}
                      className="num w-full min-w-0 bg-transparent text-center text-base font-semibold outline-none" />
                    <button className="h-full w-11 text-lg" aria-label="More" onClick={() => setLine(l.key, { quantity: l.quantity + 1 })}>+</button>
                  </div>
                </div>
                <label>
                  <span className="mb-1 block text-xs text-ink-2">Discount on this line</span>
                  <div className={`flex h-11 items-center rounded-lg border bg-white px-2 ${l.discount === null || l.discountTooLarge ? "border-red-edge" : "border-line"}`}>
                    <span className="text-ink-2">$</span>
                    <input data-testid={`discount-${l.lineNo}`} inputMode="decimal" placeholder="0" value={l.discountInput}
                      onChange={(e) => setLine(l.key, { discountInput: e.target.value, approve: false })}
                      className="num w-full min-w-0 bg-transparent px-1 text-base font-semibold outline-none" />
                  </div>
                </label>
              </div>

              <div className="mt-3 space-y-1 border-t border-line/70 pt-2">
                <Row label="Quantity × price"><span className="num">{l.quantity} × {formatUsd(l.product?.priceUsdCents ?? 0)}</span></Row>
                <Row label="Line value"><span data-testid={`value-${l.lineNo}`}>{formatUsd(l.lineValueUsdCents)}</span></Row>
                <Row label="Discount">
                  <span className="inline-flex items-center gap-2"><span data-testid={`discount-usd-${l.lineNo}`}>{formatUsd(l.discount ?? 0)}</span>
                    <span data-testid={`pct-${l.lineNo}`}><BandBadge band={l.band} bp={l.discountBp} approved={isOwner && l.approve} /></span></span>
                </Row>
                <Row label="Line total" strong><span data-testid={`total-${l.lineNo}`}>{formatUsd(l.lineTotalUsdCents)}</span></Row>
              </div>

              {l.band === "blocked" && (
                isOwner ? (
                  <label className="mt-3 flex min-h-11 items-center gap-3 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-semibold">
                    <input type="checkbox" data-testid={`approve-${l.lineNo}`} checked={l.approve} onChange={(e) => setLine(l.key, { approve: e.target.checked })} className="h-5 w-5" />
                    Approve this {formatBp(l.discountBp)} discount (owner)
                  </label>
                ) : (
                  <p data-testid={`blocked-${l.lineNo}`} className="mt-3 rounded-md bg-blocked-bg px-3 py-2 text-sm font-semibold text-white">
                    Above {formatBp(settings.redMaxBp)}: cannot be saved unless the owner approves this line.
                  </p>
                )
              )}
            </div>
          ))}
        </div>

        <label className="block">
          <span className="sr-only">Add product</span>
          <select ref={addRef} data-testid="add-product" defaultValue="" disabled={!calc.rateOk}
            onChange={(e) => addProduct(e.target.value)}
            className="min-h-12 w-full rounded-lg border-2 border-dashed border-brand/40 bg-panel px-3 text-base font-semibold text-brand disabled:opacity-50">
            <option value="">+ Add product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatUsd(p.priceUsdCents)}</option>)}
          </select>
          {!calc.rateOk && <span className="mt-1 block text-xs text-red-fg">Fix the rate before adding products.</span>}
        </label>
      </div>

      {/* totals and save, always in reach of the thumb */}
      <div className="fixed inset-x-0 bottom-16 z-10 border-t border-line bg-white/95 px-4 pb-3 pt-2 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-ink-2">Order total</div>
              <div className="num text-2xl font-bold leading-tight" data-testid="order-usd">{formatUsd(calc.totals.totalUsdCents)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink-2">at {calc.rateOk ? formatRate(calc.rate!) : "—"} SDG per USD</div>
              <div className="num text-lg font-semibold" data-testid="order-sdg">{calc.rateOk ? formatSdg(calc.totals.totalSdgPiastres) : "—"}</div>
            </div>
          </div>
          {calc.blocked.length > 0 && !isOwner && (
            <p className="mt-1 text-xs text-ink-2" data-testid="total-note">This total includes line {calc.blocked.join(", ")}, which is not approved yet.</p>
          )}
          {error && <div className="mt-2"><Banner tone="error" testId="save-error">{error}</Banner></div>}
          {calc.problems.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-fg" data-testid="problems">
              {calc.problems.map((p) => <li key={p}>• {p}</li>)}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            {!isOwner && calc.blocked.length > 0 && (
              <Button variant="gold" className="flex-1" testId="ask-owner" disabled={busy || !online || !draft.customerId || !calc.rateOk}
                onClick={requestApproval}>{online ? "Ask owner to approve" : "Ask owner (needs connection)"}</Button>
            )}
            <Button className="flex-1" testId="save" disabled={busy || calc.problems.length > 0} onClick={saveOrder}>
              {busy ? "Saving…" : online ? "Save order" : "Save on this phone"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Puts an order the server refused back into the editor, keeping its id so a later save is still idempotent. */
export function loadPayloadIntoDraft(p: OrderPayload, userId: string) {
  const cents = (c: number) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
  const d: Draft = {
    id: p.id,
    userId,
    customerId: p.customerId,
    rateInput: formatRate(p.rateSdgPerUsd),
    lines: p.lines.map((l) => ({ key: newId(), productId: l.productId, quantity: l.quantity, discountInput: l.discountUsdCents ? cents(l.discountUsdCents) : "", approve: !!l.approve })),
    startedAt: p.createdOnDeviceAt,
  };
  save(DRAFT_KEY, d);
}
