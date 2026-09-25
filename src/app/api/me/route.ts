import { requireUser } from "@/lib/server/auth";
import { handler } from "@/lib/server/route";

export const GET = handler(async (req) => Response.json({ user: await requireUser(req) }));
