"use client";

import { useEffect, useState } from "react";
import { formatRate, formatSdg, formatUsd } from "@/lib/money";
import { api, NetworkError } from "@/lib/client/api";
import { load, save } from "@/lib/client/storage";
import type { SavedOrder, Settings } from "@/lib/client/types";
import { BandBadge, Banner, Button, Row, bandEdge } from "./ui";

export function OrderView({ id, settings, onBack }: { id: string; settings: Settings; onBack: () => void }) {
  const [order, setOrder] = useState<SavedOrder | null>(() => load<SavedOrder | null>(`shamsy.order.${id}`, null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ order: SavedOrder }>(`/api/orders/${id}`)
      .then(({ order }) => { setOrder(order); save(`shamsy.order.${id}`, order); })
      .catch((e) => setError(e instanceof NetworkError ? "No connection — showing the copy kept on this phone." : e.message));
  }, [id]);

  return (
    <div className="space-y-4 p-4" data-testid="order-view">
      <Button variant="secondary" onClick={onBack}>← Orders</Button>
      {error && <Banner tone={order ? "info" : "error"}>{error}</Banner>}
      {order && (
        <>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Saved order</div>
            <h2 className="text-2xl font-bold" data-testid="order-number">{order.orderNumber}</h2>
            <div className="text-sm text-ink-2">{order.customer.name} — {order.customer.city} · by {order.adviserName}
              {order.savedByName !== order.adviserName ? ` · saved by ${order.savedByName}` : ""} · {new Date(order.savedAt).toLocaleString("en-GB")}</div>
          </div>

          <div className="rounded-lg border border-line bg-panel p-3">
            <Row label="Rate stored on this order"><b data-testid="view-rate">{formatRate(order.rateSdgPerUsd)}</b> SDG per USD</Row>
            <Row label="Today's rate setting (not used by this order)"><span data-testid="view-todays-rate">{formatRate(settings.todaysRateSdgPerUsd)}</span></Row>
          </div>

          <div className="space-y-3">
            {order.lines.map((l) => (
              <div key={l.lineNo} data-testid={`view-line-${l.lineNo}`} className={`rounded-lg border border-line border-l-4 p-3 ${bandEdge(l.band, !!l.approvedByName)}`}>
                <div className="text-xs font-semibold text-ink-2">Line {l.lineNo}</div>
                <div className="font-semibold">{l.product.name}</div>
                <div className="mt-2 space-y-1">
                  <Row label="Quantity × price">{l.quantity} × {formatUsd(l.unitPriceUsdCents)}</Row>
                  <Row label="Line value">{formatUsd(l.lineValueUsdCents)}</Row>
                  <Row label="Discount"><span className="inline-flex items-center gap-2">{formatUsd(l.discountUsdCents)} <BandBadge band={l.band} bp={l.discountBp} approved={!!l.approvedByName} /></span></Row>
                  <Row label="Line total" strong>{formatUsd(l.lineTotalUsdCents)}</Row>
                  {l.approvedByName && <p className="text-xs text-emerald-800">Approved by {l.approvedByName}{l.approvedAt ? `, ${new Date(l.approvedAt).toLocaleString("en-GB")}` : ""}</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border-2 border-brand p-3">
            <Row label="Order total" strong><span data-testid="view-usd">{formatUsd(order.totalUsdCents)}</span></Row>
            <Row label={`In pounds at ${formatRate(order.rateSdgPerUsd)}`} strong><span data-testid="view-sdg">{formatSdg(order.totalSdgPiastres)}</span></Row>
          </div>
          <p className="text-xs text-ink-2">A saved order never changes: its rate, prices and discounts are stored with it and are not recalculated when a setting changes.</p>
        </>
      )}
    </div>
  );
}
