"use client";

import { useEffect, useState } from "react";
import { formatRate, formatSdg, formatUsd } from "@/lib/money";
import { api } from "@/lib/client/api";
import { discard, flush, type OutboxItem } from "@/lib/client/outbox";
import { load, save } from "@/lib/client/storage";
import type { OrderSummary } from "@/lib/client/types";
import { Banner, Button } from "./ui";

export function OrdersList({ outbox, online, meId, onOpen, onEditRefused, refreshKey }: {
  outbox: OutboxItem[]; online: boolean; meId: string; onOpen: (id: string) => void; onEditRefused: (item: OutboxItem) => void; refreshKey: number;
}) {
  const [orders, setOrders] = useState<OrderSummary[]>(() => load<OrderSummary[]>("shamsy.orders.v1", []));
  const [stale, setStale] = useState(false);

  useEffect(() => {
    api<{ orders: OrderSummary[] }>("/api/orders")
      .then(({ orders }) => { setOrders(orders); save("shamsy.orders.v1", orders); setStale(false); })
      .catch(() => setStale(true));
  }, [refreshKey, outbox.length]);

  return (
    <div className="space-y-4 p-4" data-testid="orders">
      {outbox.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">On this phone, not sent yet</h2>
          {outbox.map((i) => (
            <div key={i.payload.id} data-testid="outbox-item" data-status={i.status}
              className={`rounded-lg border p-3 ${i.status === "refused" ? "border-red-edge bg-red-bg" : "border-amber-300 bg-amber-50"}`}>
              <div className="flex justify-between gap-2">
                <b>{i.customerName}</b>
                <span className="text-xs font-semibold uppercase">{i.userId !== meId ? "another user's order" : i.status === "refused" ? "refused by server" : i.status === "sending" ? "sending…" : "waiting for connection"}</span>
              </div>
              <div className="num text-sm">{formatUsd(i.payload.expected.totalUsdCents)} · {formatSdg(i.payload.expected.totalSdgPiastres)} at {formatRate(i.payload.rateSdgPerUsd)}</div>
              {i.error && <p className="mt-1 text-sm text-red-fg">{i.error.message}</p>}
              <div className="mt-2 flex gap-2">
                {i.userId !== meId ? (
                  <p className="text-xs">Sent when the user who saved it signs in on this phone.</p>
                ) : i.status === "refused" ? (
                  <>
                    <Button variant="secondary" onClick={() => onEditRefused(i)}>Fix in editor</Button>
                    <Button variant="danger" onClick={() => discard(i.payload.id)}>Discard</Button>
                  </>
                ) : (
                  <Button variant="secondary" disabled={!online} onClick={() => flush(meId)}>Send now</Button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">Saved orders</h2>
        {stale && <Banner tone="info">No connection — this list is the copy kept on this phone.</Banner>}
        {orders.length === 0 && <p className="text-sm text-ink-2">No saved orders yet.</p>}
        {orders.map((o) => (
          <button key={o.id} data-testid="order-row" onClick={() => onOpen(o.id)}
            className="block w-full rounded-lg border border-line bg-white p-3 text-left hover:bg-panel">
            <div className="flex justify-between gap-2">
              <b>{o.orderNumber}</b>
              <span className="num font-semibold">{formatUsd(o.totalUsdCents)}</span>
            </div>
            <div className="flex justify-between gap-2 text-sm text-ink-2">
              <span>{o.customerName} · {o.adviserName}</span>
              <span className="num">{formatSdg(o.totalSdgPiastres)} at {formatRate(o.rateSdgPerUsd)}</span>
            </div>
          </button>
        ))}
      </section>
    </div>
  );
}
