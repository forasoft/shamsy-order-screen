import { requireUser } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { handler } from "@/lib/server/route";
import { getOrderOrNull } from "@/lib/server/orders";

export const GET = handler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "NOT_FOUND", "No such order.");
  const order = await getOrderOrNull(user, id);
  if (!order) throw new ApiError(404, "NOT_FOUND", "No such order.");
  return Response.json({ order });
});
