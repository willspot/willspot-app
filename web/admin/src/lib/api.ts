"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Calls the dashboard's own /api routes; tokens stay in httpOnly cookies. */
export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path.startsWith("/api/") ? path : `/api/gw${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-admin-csrf": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) location.href = "/login";
  if (!r.ok) throw new ApiError(r.status, j.error?.code ?? "error", j.error?.message ?? "Request failed");
  return j as T;
}

export const naira = (v: string | number) => `₦${Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (v: string) => new Date(v).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
