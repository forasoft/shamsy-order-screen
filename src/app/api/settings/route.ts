import { requireOwner } from "@/lib/server/auth";
import { handler, readJson } from "@/lib/server/route";
import { parse, SettingsSchema, updateSettings } from "@/lib/server/orders";

// PUT /api/settings — owner only: today's rate and the minimum rate.
export const PUT = handler(async (req) => {
  const owner = await requireOwner(req);
  return Response.json({ settings: await updateSettings(owner, parse(SettingsSchema, await readJson(req))) });
});
