export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const unauthorized = (msg = "Authentication required") => new AppError(401, "unauthorized", msg);
export const forbidden = (msg = "Not allowed") => new AppError(403, "forbidden", msg);
export const notFound = (msg = "Not found") => new AppError(404, "not_found", msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
export const tooMany = (msg = "Too many attempts, try again later") => new AppError(429, "rate_limited", msg);
