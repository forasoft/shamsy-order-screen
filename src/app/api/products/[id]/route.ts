import { z } from "zod";
import { requireOwner } from "@/lib/server/auth";
import { handler, readJson } from "@/lib/server/route";
import { parse, updateProductPrice } from "@/lib/server/orders";

const Body = z.object({ priceUsdCents: z.number().int().positive() });

// PUT /api/products/:id — owner only: change a catalogue price. Saved orders keep the price they were saved with.
export const PUT = handler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const owner = await requireOwner(req);
  const { id } = await params;
  const { priceUsdCents } = parse(Body, await readJson(req));
  return Response.json({ product: await updateProductPrice(owner, id, priceUsdCents) });
});
