export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Not signed in.") =>
  new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to that.") =>
  new HttpError(403, "forbidden", message);
/** Deliberately the same shape as forbidden, so probing cannot enumerate hidden nodes. */
export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
