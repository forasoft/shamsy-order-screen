import { z } from "zod";
import { requireOwner } from "@/lib/server/auth";
import { handler, readJson } from "@/lib/server/route";
import { approveRequest, parse } from "@/lib/server/orders";

const Body = z.object({ approveLineNos: z.array(z.number().int().min(1)).min(1) });

// POST /api/approval-requests/:id/approve — owner only; approves the named lines and saves the order.
export const POST = handler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const owner = await requireOwner(req);
  const { id } = await params;
  const { approveLineNos } = parse(Body, await readJson(req));
  const order = await approveRequest(owner, id, approveLineNos);
  return Response.json({ order }, { status: 201 });
});
