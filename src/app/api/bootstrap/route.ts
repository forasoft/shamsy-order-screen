import { requireUser } from "@/lib/server/auth";
import { handler } from "@/lib/server/route";
import { bootstrap } from "@/lib/server/orders";

// Everything the order screen needs, cached on the phone for use without a connection.
export const GET = handler(async (req) => Response.json(await bootstrap(await requireUser(req))));
