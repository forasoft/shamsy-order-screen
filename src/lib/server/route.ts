import "server-only";
import { errorResponse, ApiError } from "./errors";

/** Wraps a route handler: JSON body parsing and error mapping in one place. */
export function handler<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
}
