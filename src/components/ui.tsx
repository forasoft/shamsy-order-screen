"use client";

import type { Band } from "@/lib/money";
import { formatBp } from "@/lib/money";

export function BandBadge({ band, bp, approved }: { band: Band; bp: number; approved?: boolean }) {
  if (band === "none") return <span className="text-xs text-ink-2">no discount</span>;
  const label = band === "blocked" ? (approved ? "approved" : "blocked") : band;
  const cls =
    band === "sand"
      ? "bg-sand-bg text-sand-fg border-sand-edge"
      : band === "red"
        ? "bg-red-bg text-red-fg border-red-edge"
        : approved
          ? "bg-emerald-50 text-emerald-800 border-emerald-300"
          : "bg-blocked-bg text-white border-blocked-bg";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="num text-sm font-semibold">{formatBp(bp)}</span>
      <span data-testid="band" data-band={band} className={`rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>
        {band === "blocked" && !approved ? "🔒 " : ""}
        {label}
      </span>
    </span>
  );
}

export function bandEdge(band: Band, approved?: boolean) {
  if (band === "sand") return "border-l-sand-edge bg-sand-bg/40";
  if (band === "red") return "border-l-red-edge bg-red-bg/40";
  if (band === "blocked") return approved ? "border-l-emerald-500 bg-emerald-50/50" : "border-l-blocked-bg bg-red-bg/60";
  return "border-l-line bg-white";
}

export function Banner({ tone, children, testId }: { tone: "ok" | "warn" | "error" | "info"; children: React.ReactNode; testId?: string }) {
  const cls = {
    ok: "bg-emerald-50 border-emerald-300 text-emerald-900",
    warn: "bg-amber-50 border-amber-300 text-amber-900",
    error: "bg-red-bg border-red-edge text-red-fg",
    info: "bg-panel border-line text-ink",
  }[tone];
  return (
    <div data-testid={testId} role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2.5 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function Button({
  children, onClick, disabled, variant = "primary", testId, type = "button", className = "",
}: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" | "gold";
  testId?: string; type?: "button" | "submit"; className?: string;
}) {
  const v = {
    primary: "bg-brand text-white hover:bg-brand-2 disabled:bg-gray-300 disabled:text-gray-500",
    secondary: "bg-white text-ink border border-line hover:bg-panel disabled:text-gray-400",
    danger: "bg-white text-red-fg border border-red-edge hover:bg-red-bg",
    gold: "bg-gold text-brand hover:bg-gold-l disabled:bg-gray-300 disabled:text-gray-500",
  }[variant];
  return (
    <button type={type} data-testid={testId} onClick={onClick} disabled={disabled}
      className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-2">{label}</span>
      <span className={`num text-right ${strong ? "text-base font-bold" : "text-sm"}`}>{children}</span>
    </div>
  );
}

export function newId(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
