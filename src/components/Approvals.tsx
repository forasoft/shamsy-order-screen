"use client";

import { useEffect, useState } from "react";
import { computeLine, formatBp, formatRate, formatSdg, formatUsd, orderTotals } from "@/lib/money";
import { api, NetworkError } from "@/lib/client/api";
import type { ApprovalRequest, Bootstrap, SavedOrder } from "@/lib/client/types";
import { BandBadge, Banner, Button, Row, bandEdge } from "./ui";

export function Approvals({ boot, onOpenOrder, onChanged }: { boot: Bootstrap; onOpenOrder: (id: string) => void; onChanged: () => void }) {
  const isOwner = boot.me.role === "owner";
  const [requests, setRequests] = useState<ApprovalRequest[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api<{ requests: ApprovalRequest[] }>("/api/approval-requests")
      .then(({ requests }) => { setRequests(requests); setError(null); })
      .catch((e) => setError(e instanceof NetworkError ? "Approvals need a connection." : e.message));
  }, [tick]);

  const open = requests?.find((r) => r.id === openId);
  if (open) return <ApprovalDetail boot={boot} request={open} onBack={() => { setOpenId(null); setTick(tick + 1); }} onOpenOrder={onOpenOrder} onChanged={onChanged} />;

  return (
    <div className="space-y-3 p-4" data-testid="approvals">
      <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">{isOwner ? "Discounts waiting for your approval" : "My approval requests"}</h2>
      {error && <Banner tone="info">{error}</Banner>}
      {requests?.length === 0 && <p className="text-sm text-ink-2">Nothing here.</p>}
      {requests?.map((r) => {
        const total = orderTotals(r.lines.map((l) => computeLine(l, boot.settings).lineTotalUsdCents), r.rateSdgPerUsd);
        return (
          <button key={r.id} data-testid="approval-row" data-status={r.status}
            onClick={() => (r.status === "approved" && r.orderId ? onOpenOrder(r.orderId) : isOwner ? setOpenId(r.id) : undefined)}
            className="block w-full rounded-lg border border-line bg-white p-3 text-left hover:bg-panel">
            <div className="flex justify-between gap-2">
              <b>{r.customerName}</b>
              <span className={`text-xs font-bold uppercase ${r.status === "pending" ? "text-amber-700" : "text-emerald-700"}`}>{r.status === "pending" ? "waiting" : "approved · saved"}</span>
            </div>
            <div className="num text-sm text-ink-2">{r.requestedByName} · {r.lines.length} lines · {formatUsd(total.totalUsdCents)} with every line approved · rate {formatRate(r.rateSdgPerUsd)}</div>
          </button>
        );
      })}
    </div>
  );
}

function ApprovalDetail({ boot, request, onBack, onOpenOrder, onChanged }: {
  boot: Bootstrap; request: ApprovalRequest; onBack: () => void; onOpenOrder: (id: string) => void; onChanged: () => void;
}) {
  const [approved, setApproved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedOrder | null>(null);
  const product = new Map(boot.products.map((p) => [p.id, p]));
  const lines = request.lines.map((l, i) => {
    const lineNo = i + 1;
    return { ...l, lineNo, name: product.get(l.productId)?.name ?? "Unknown product", ...computeLine({ ...l, approved: approved.includes(lineNo) }, boot.settings) };
  });
  const blocked = lines.filter((l) => l.band === "blocked").map((l) => l.lineNo);
  const allApproved = blocked.every((n) => approved.includes(n));
  const totals = orderTotals(lines.map((l) => l.lineTotalUsdCents), request.rateSdgPerUsd);

  const approve = async () => {
    setBusy(true); setError(null);
    try {
      const { order } = await api<{ order: SavedOrder }>(`/api/approval-requests/${request.id}/approve`, { body: { approveLineNos: approved } });
      setSaved(order);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="space-y-3 p-4">
        <Banner tone="ok" testId="approved-banner">
          <div className="text-base font-bold">Approved — order {saved.orderNumber} saved</div>
          <div className="num">{saved.customer.name} · <b data-testid="approved-usd">{formatUsd(saved.totalUsdCents)}</b> · <b data-testid="approved-sdg">{formatSdg(saved.totalSdgPiastres)}</b> at {formatRate(saved.rateSdgPerUsd)}</div>
        </Banner>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>← Approvals</Button>
          <Button onClick={() => onOpenOrder(saved.id)} testId="approved-view">View order</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4" data-testid="approval-detail">
      <Button variant="secondary" onClick={onBack}>← Approvals</Button>
      <div>
        <h2 className="text-xl font-bold">{request.customerName}</h2>
        <div className="text-sm text-ink-2">Asked by {request.requestedByName} · rate on the order {formatRate(request.rateSdgPerUsd)} SDG per USD</div>
      </div>
      {lines.map((l) => (
        <div key={l.lineNo} className={`rounded-lg border border-line border-l-4 p-3 ${bandEdge(l.band, approved.includes(l.lineNo))}`}>
          <div className="text-xs font-semibold text-ink-2">Line {l.lineNo}</div>
          <div className="font-semibold">{l.name}</div>
          <div className="mt-2 space-y-1">
            <Row label="Quantity × price">{l.quantity} × {formatUsd(l.unitPriceUsdCents)}</Row>
            <Row label="Discount"><span className="inline-flex items-center gap-2">{formatUsd(l.discountUsdCents)} <BandBadge band={l.band} bp={l.discountBp} approved={approved.includes(l.lineNo)} /></span></Row>
            <Row label="Line total" strong>{formatUsd(l.lineTotalUsdCents)}</Row>
          </div>
          {l.band === "blocked" && (
            <label className="mt-3 flex min-h-11 items-center gap-3 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5" data-testid={`owner-approve-${l.lineNo}`} checked={approved.includes(l.lineNo)}
                onChange={(e) => setApproved(e.target.checked ? [...approved, l.lineNo] : approved.filter((n) => n !== l.lineNo))} />
              Approve this {formatBp(l.discountBp)} discount
            </label>
          )}
        </div>
      ))}
      <div className="rounded-lg border-2 border-brand p-3">
        <Row label="Order total" strong>{formatUsd(totals.totalUsdCents)}</Row>
        <Row label={`In pounds at ${formatRate(request.rateSdgPerUsd)}`} strong>{formatSdg(totals.totalSdgPiastres)}</Row>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      <Button className="w-full" testId="approve-save" disabled={busy || !allApproved} onClick={approve}>
        {allApproved ? "Approve and save the order" : `Tick line ${blocked.join(", ")} to approve`}
      </Button>
    </div>
  );
}
