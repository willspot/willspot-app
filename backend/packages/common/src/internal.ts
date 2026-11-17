import type { FastifyRequest } from "fastify";
import { AppError, unauthorized } from "./errors.js";
import { safeEqual } from "./crypto.js";

/**
 * Service-to-service calls. Internal routes live under /internal and are never
 * routed by the gateway. Callers send x-service-name and x-service-token; each
 * caller has its own token so one can be rotated without touching the others.
 */
export function requireService(allowed: Record<string, string | undefined>) {
  return async (req: FastifyRequest) => {
    const name = req.headers["x-service-name"];
    const token = req.headers["x-service-token"];
    const expected = typeof name === "string" ? allowed[name] : undefined;
    if (!expected || typeof token !== "string" || !safeEqual(token, expected)) throw unauthorized("Unknown service");
  };
}

export interface InternalCall {
  baseUrl: string;
  service: string;
  token: string;
  requestId?: string;
}

export async function callInternal<T>(cfg: InternalCall, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-service-name": cfg.service,
      "x-service-token": cfg.token,
      ...(cfg.requestId ? { "x-request-id": cfg.requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
  if (!res.ok) {
    throw new AppError(res.status >= 500 ? 502 : res.status, json.error?.code ?? "upstream_error", json.error?.message ?? "Upstream error");
  }
  return json as T;
}
