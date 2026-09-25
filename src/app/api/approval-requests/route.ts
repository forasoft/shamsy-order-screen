import { requireUser } from "@/lib/server/auth";
import { handler, readJson } from "@/lib/server/route";
import { ApprovalRequestSchema, createApprovalRequest, listApprovalRequests, parse } from "@/lib/server/orders";

export const GET = handler(async (req) => Response.json({ requests: await listApprovalRequests(await requireUser(req)) }));

// POST /api/approval-requests — the adviser asks the owner to approve a line above the limit.
// The request is not an order: nothing is saved as an order until the owner approves.
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const r = await createApprovalRequest(user, parse(ApprovalRequestSchema, await readJson(req)));
  return Response.json(r, { status: r.replayed ? 200 : 201 });
});
