// Orders saved on the phone while the connection is down.
//
// Each order carries the id generated when the draft was started. The server stores an
// order once per id and answers a repeat with the first save, so a retry after a lost
// response can never create a second order. The server re-checks every rule on sync;
// an order it refuses stays here, marked, until the adviser fixes it.

import { api, ApiError, NetworkError } from "./api";
import { load, save } from "./storage";
import type { OrderPayload, SavedOrder } from "./types";

export interface OutboxItem {
  payload: OrderPayload;
  customerName: string;
  userId: string; // only this user's session sends it: an order never changes hands on a shared phone
  status: "queued" | "sending" | "refused";
  error?: { code: string; message: string };
  queuedAt: string;
  attempts: number;
}

const KEY = "shamsy.outbox.v1";
const SYNCED_KEY = "shamsy.synced.v1";
type Listener = (items: OutboxItem[]) => void;
const listeners = new Set<Listener>();
let flushing: Promise<void> | null = null;

export function items(): OutboxItem[] {
  return load<OutboxItem[]>(KEY, []);
}

function write(next: OutboxItem[]) {
  save(KEY, next);
  listeners.forEach((l) => l(next));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function enqueue(payload: OrderPayload, customerName: string, userId: string) {
  const list = items().filter((i) => i.payload.id !== payload.id);
  list.push({ payload, customerName, userId, status: "queued", queuedAt: new Date().toISOString(), attempts: 0 });
  write(list);
}

export function discard(id: string) {
  write(items().filter((i) => i.payload.id !== id));
}

/** Orders that reached the server from the queue, so the screen can say which ones went through. */
export function recentlySynced(): { id: string; orderNumber: string; at: string }[] {
  return load(SYNCED_KEY, []);
}

/** Sends the signed-in user's queued orders, one at a time, in the order they were saved. Safe to call repeatedly. */
export function flush(userId: string): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      for (const item of items()) {
        if (item.status === "refused" || item.userId !== userId) continue;
        update(item.payload.id, { status: "sending", attempts: item.attempts + 1 });
        try {
          const { order } = await api<{ order: SavedOrder; replayed: boolean }>("/api/orders", { body: item.payload });
          write(items().filter((i) => i.payload.id !== item.payload.id));
          save(SYNCED_KEY, [{ id: order.id, orderNumber: order.orderNumber, at: new Date().toISOString() }, ...recentlySynced()].slice(0, 20));
        } catch (e) {
          if (e instanceof NetworkError) {
            update(item.payload.id, { status: "queued" });
            return; // still offline: try again later
          }
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429) {
            update(item.payload.id, { status: "refused", error: { code: e.code, message: e.message } });
            continue;
          }
          update(item.payload.id, { status: "queued" });
          return; // server trouble or signed out: keep it and retry later
        }
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function update(id: string, patch: Partial<OutboxItem>) {
  write(items().map((i) => (i.payload.id === id ? { ...i, ...patch } : i)));
}
