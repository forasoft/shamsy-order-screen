import "server-only";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const STATUS: Record<string, number> = {
  DISCOUNT_NEEDS_OWNER_APPROVAL: 422,
  APPROVAL_ONLY_BY_OWNER: 403,
  RATE_BELOW_MINIMUM: 422,
  PRICE_IS_FIXED: 409,
  UNKNOWN_PRODUCT: 422,
  DISCOUNT_EXCEEDS_LINE: 422,
  ORDER_WITHOUT_LINES: 422,
  TOTALS_DO_NOT_MATCH: 409,
  SAVED_ORDER_IS_IMMUTABLE: 409,
  NOT_YOUR_ORDER: 403,
  OWNER_ONLY: 403,
  REQUEST_ALREADY_DECIDED: 409,
  NO_ACTOR: 401,
};

/** Turns a rule raised by the database into an API error with the same code. */
export function fromDbError(e: unknown): ApiError | null {
  const err = e as { code?: string; message?: string; detail?: string; constraint?: string };
  if (err && err.code === "P0001" && err.message && STATUS[err.message]) {
    return new ApiError(STATUS[err.message], err.message, err.detail ?? err.message, { enforcedBy: "database" });
  }
  if (err && err.code === "23505") return new ApiError(409, "ID_ALREADY_USED", "This id is already used by another record.");
  if (err && err.code === "23503") return new ApiError(422, "UNKNOWN_REFERENCE", "A customer or product in this order does not exist.");
  if (err && err.code === "22P02") return new ApiError(422, "INVALID_INPUT", "A value in this request has the wrong format.");
  return null;
}

export function errorResponse(e: unknown): Response {
  const api = e instanceof ApiError ? e : fromDbError(e);
  if (api) {
    return Response.json({ error: { code: api.code, message: api.message, ...api.extra } }, { status: api.status });
  }
  console.error(e);
  return Response.json({ error: { code: "SERVER_ERROR", message: "Something went wrong on the server." } }, { status: 500 });
}
