import { requireUser } from "@/lib/server/auth";
import { handler, readJson } from "@/lib/server/route";
import { listOrders, OrderSchema, parse, saveOrder } from "@/lib/server/orders";

export const GET = handler(async (req) => Response.json({ orders: await listOrders(await requireUser(req)) }));

// POST /api/orders — save an order. Idempotent on the order id: a retry returns the first save.
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const input = parse(OrderSchema, await readJson(req));
  const { order, replayed } = await saveOrder(user, input);
  return Response.json({ order, replayed }, { status: replayed ? 200 : 201 });
});
