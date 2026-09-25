import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query } from "./db";
import { ApiError } from "./errors";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: "owner" | "adviser";
  orderPrefix: string | null;
}

export const SESSION_COOKIE = "shamsy_session";
const TTL_SECONDS = 60 * 60 * 24 * 14;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return s;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signToken(userId: string): string {
  const payload = b64(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }));
  const sig = b64(createHmac("sha256", secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof sub !== "string" || typeof exp !== "number" || exp < Date.now() / 1000) return null;
    return sub;
  } catch {
    return null;
  }
}

type Row = { id: string; email: string; full_name: string; role: "owner" | "adviser"; order_prefix: string | null };
const toUser = (r: Row): User => ({ id: r.id, email: r.email, fullName: r.full_name, role: r.role, orderPrefix: r.order_prefix });

export async function login(email: string, password: string): Promise<User | null> {
  const rows = await query<Row>(
    `select id, email, full_name, role, order_prefix from shamsy.users
      where lower(email) = lower($1) and password_hash = extensions.crypt($2, password_hash)`,
    [email, password],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

/** The signed-in user, from the session cookie or an `Authorization: Bearer` token. Role is always read from the database. */
export async function currentUser(req?: Request): Promise<User | null> {
  let token: string | undefined;
  const auth = req?.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) token = auth.slice(7).trim();
  if (!token) token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = verifyToken(token);
  if (!id) return null;
  const rows = await query<Row>(`select id, email, full_name, role, order_prefix from shamsy.users where id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function requireUser(req: Request): Promise<User> {
  const u = await currentUser(req);
  if (!u) throw new ApiError(401, "NOT_SIGNED_IN", "Sign in first.");
  return u;
}

export async function requireOwner(req: Request): Promise<User> {
  const u = await requireUser(req);
  if (u.role !== "owner") throw new ApiError(403, "OWNER_ONLY", "Only the owner can do this.");
  return u;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TTL_SECONDS,
};
