import { cookies } from "next/headers";
import { z } from "zod";
import { login, signToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { handler, readJson } from "@/lib/server/route";
import { parse } from "@/lib/server/orders";

const Body = z.object({ email: z.string().min(3), password: z.string().min(1) });

// POST /api/auth/login  {email, password}  ->  sets the session cookie and returns a bearer token
export const POST = handler(async (req) => {
  const { email, password } = parse(Body, await readJson(req));
  const user = await login(email, password);
  if (!user) throw new ApiError(401, "WRONG_CREDENTIALS", "Wrong email or password.");
  const token = signToken(user.id);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  return Response.json({ user, token });
});
