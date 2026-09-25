"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      try { localStorage.removeItem("shamsy.bootstrap.v1"); localStorage.removeItem("shamsy.orders.v1"); } catch {}
      window.location.replace("/");
    } catch (err) {
      setError((err as Error).message === "No connection" ? "No connection. Signing in needs one." : (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-brand">
      <div className="mx-auto w-full max-w-sm flex-1 px-5 pt-16">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden><circle cx="24" cy="24" r="9" fill="#C9922E" /><path d="M24 5a19 19 0 0 1 19 19" fill="none" stroke="#E0B45C" strokeWidth="3.5" strokeLinecap="round" /><path d="M24 43A19 19 0 0 1 5 24" fill="none" stroke="#E0B45C" strokeWidth="3.5" strokeLinecap="round" /></svg>
          <div>
            <div className="text-3xl font-extrabold italic text-gold">Shamsy</div>
            <div className="text-xs tracking-[0.2em] text-white/70">SOLAR &amp; ENERGY</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-5 shadow-lg">
          <h1 className="text-lg font-bold">Sign in</h1>
          <input data-testid="email" type="email" autoComplete="username" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-line px-3 text-base" />
          <input data-testid="password" type="password" autoComplete="current-password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-line px-3 text-base" />
          {error && <p role="alert" className="text-sm text-red-fg">{error}</p>}
          <button data-testid="sign-in" disabled={busy} className="min-h-12 w-full rounded-lg bg-brand font-semibold text-white disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
          <div className="rounded-lg bg-panel p-3 text-xs text-ink-2">
            <b>Trial accounts</b><br />
            Adviser: adviser@shamsy.test · Adviser-2026<br />
            Owner: owner@shamsy.test · Owner-2026
          </div>
        </form>
      </div>
    </div>
  );
}
