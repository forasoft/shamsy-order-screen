"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, NetworkError } from "@/lib/client/api";
import { flush, items as outboxItems, subscribe, type OutboxItem, discard } from "@/lib/client/outbox";
import { load, save } from "@/lib/client/storage";
import type { Bootstrap } from "@/lib/client/types";
import { formatRate } from "@/lib/money";
import { OrderEditor, loadPayloadIntoDraft } from "./OrderEditor";
import { OrderView } from "./OrderView";
import { OrdersList } from "./OrdersList";
import { Approvals } from "./Approvals";
import { SettingsView } from "./SettingsView";
import { Banner } from "./ui";

type View = { name: "new" } | { name: "orders" } | { name: "order"; id: string } | { name: "approvals" } | { name: "settings" };
const BOOT_KEY = "shamsy.bootstrap.v1";
export const SHELL_CACHE = "shamsy-shell-v1";

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [view, setView] = useState<View>({ name: "new" });
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorKey, setEditorKey] = useState(0);

  const refreshBoot = useCallback(async () => {
    try {
      const b = await api<Bootstrap>("/api/bootstrap");
      setBoot(b); save(BOOT_KEY, b); setOnline(true); setBootError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { window.location.replace("/login"); return; }
      if (e instanceof NetworkError) {
        setOnline(false);
        const cached = load<Bootstrap | null>(BOOT_KEY, null);
        if (cached) setBoot(cached);
        else setBootError("No connection, and this phone has not signed in before. Connect once to start.");
      }
    }
  }, []);

  useEffect(() => {
    // Phone storage is read after hydration so the server-rendered shell and the first client render match.
    const cached = load<Bootstrap | null>(BOOT_KEY, null);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (cached) setBoot(cached);
    setOnline(navigator.onLine);
    setOutbox(outboxItems());
    /* eslint-enable react-hooks/set-state-in-effect */
    refreshBoot().then(() => { const b = load<Bootstrap | null>(BOOT_KEY, null); if (b) flush(b.me.id); });
    const unsub = subscribe(setOutbox);
    const me = () => load<Bootstrap | null>(BOOT_KEY, null)?.me.id;
    const up = () => { setOnline(true); refreshBoot(); const id = me(); if (id) flush(id).then(() => setRefreshKey((k) => k + 1)); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = setInterval(() => {
      const id = me();
      if (id && navigator.onLine && outboxItems().some((i) => i.status === "queued" && i.userId === id)) flush(id).then(() => setRefreshKey((k) => k + 1));
    }, 10000);

    // keep the app shell on the phone so the screen opens without a connection
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").then(async () => {
        try {
          const urls = performance.getEntriesByType("resource").map((e) => e.name)
            .filter((u) => u.startsWith(location.origin) && u.includes("/_next/static/"));
          const cache = await caches.open(SHELL_CACHE);
          await cache.addAll(["/", ...new Set(urls)]);
        } catch { /* best effort */ }
      }).catch(() => {});
    }
    return () => { unsub(); window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(timer); };
  }, [refreshBoot]);

  if (!boot) {
    return <div className="p-6">{bootError ? <Banner tone="error">{bootError}</Banner> : <p className="text-ink-2">Loading…</p>}</div>;
  }

  const isOwner = boot.me.role === "owner";
  const queued = outbox.filter((i) => i.status !== "refused").length;
  const refused = outbox.filter((i) => i.status === "refused").length;
  const changed = () => { setRefreshKey((k) => k + 1); refreshBoot(); };
  const logout = async () => { await api("/api/auth/logout", { body: {} }).catch(() => {}); window.location.replace("/login"); };

  const tabs: { key: View["name"]; label: string; badge?: number }[] = [
    { key: "new", label: "New order" },
    { key: "orders", label: "Orders", badge: queued + refused || undefined },
    { key: "approvals", label: "Approvals" },
    ...(isOwner ? [{ key: "settings" as const, label: "Settings" }] : []),
  ];

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-white">
      <header className="sticky top-0 z-20 border-b-4 border-gold bg-brand px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 48 48" className="h-8 w-8" aria-hidden><circle cx="24" cy="24" r="9" fill="#C9922E" /><path d="M24 5a19 19 0 0 1 19 19" fill="none" stroke="#E0B45C" strokeWidth="3.5" strokeLinecap="round" /><path d="M24 43A19 19 0 0 1 5 24" fill="none" stroke="#E0B45C" strokeWidth="3.5" strokeLinecap="round" /></svg>
            <div>
              <div className="text-lg font-extrabold italic leading-none text-gold">Shamsy</div>
              <div className="text-[11px] opacity-80" data-testid="who">{boot.me.fullName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span data-testid="connection" data-online={online}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${online ? "bg-emerald-600/30 text-emerald-100" : "bg-amber-400 text-brand"}`}>
              {online ? "Online" : "Offline"}{queued ? ` · ${queued} to send` : ""}
            </span>
            <button onClick={logout} className="rounded-md px-2 py-1 text-xs underline opacity-80">Sign out</button>
          </div>
        </div>
        <div className="mt-1 text-[11px] opacity-80 num">Today&apos;s rate {formatRate(boot.settings.todaysRateSdgPerUsd)} · minimum {formatRate(boot.settings.minRateSdgPerUsd)} SDG per USD</div>
      </header>

      {!online && view.name === "new" && (
        <div className="px-4 pt-3"><Banner tone="warn" testId="offline-banner">No connection. You can keep working: the order is saved on this phone and sent when the connection returns.</Banner></div>
      )}

      <main className="pb-20">
        {view.name === "new" && <OrderEditor key={editorKey} boot={boot} online={online} onOpenOrder={(id) => setView({ name: "order", id })} onChanged={changed} />}
        {view.name === "orders" && (
          <OrdersList outbox={outbox} online={online} meId={boot.me.id} refreshKey={refreshKey} onOpen={(id) => setView({ name: "order", id })}
            onEditRefused={(item) => { loadPayloadIntoDraft(item.payload, boot.me.id); discard(item.payload.id); setEditorKey((k) => k + 1); setView({ name: "new" }); }} />
        )}
        {view.name === "order" && <OrderView id={view.id} settings={boot.settings} onBack={() => setView({ name: "orders" })} />}
        {view.name === "approvals" && <Approvals boot={boot} onOpenOrder={(id) => setView({ name: "order", id })} onChanged={changed} />}
        {view.name === "settings" && isOwner && <SettingsView boot={boot} onChanged={changed} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white">
        <div className="mx-auto flex max-w-2xl">
          {tabs.map((t) => (
            <button key={t.key} data-testid={`tab-${t.key}`} onClick={() => { if (t.key === "new") setEditorKey((k) => k); setView({ name: t.key } as View); }}
              className={`relative h-16 flex-1 text-sm font-semibold ${view.name === t.key || (t.key === "orders" && view.name === "order") ? "text-brand" : "text-ink-2"}`}>
              {t.label}
              {t.badge ? <span className="absolute right-3 top-2 rounded-full bg-gold px-1.5 text-[11px] text-brand">{t.badge}</span> : null}
              {(view.name === t.key || (t.key === "orders" && view.name === "order")) && <span className="absolute inset-x-6 bottom-0 h-1 rounded-t bg-gold" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
