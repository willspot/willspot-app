import { SignJWT, importPKCS8 } from "jose";

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}
export interface PushResult {
  token: string;
  ok: boolean;
  /** The token is dead (app uninstalled, token rotated): delete it. */
  unregistered?: boolean;
  error?: string;
}
export interface PushSender {
  readonly name: string;
  send(tokens: string[], msg: PushMessage): Promise<PushResult[]>;
}

/** Records messages instead of sending (development, tests, and until Firebase is set up). */
export class SandboxPushSender implements PushSender {
  readonly name = "sandbox";
  readonly sent: { token: string; msg: PushMessage }[] = [];
  async send(tokens: string[], msg: PushMessage) {
    for (const token of tokens) this.sent.push({ token, msg });
    return tokens.map((token) => ({ token, ok: true }));
  }
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * Firebase Cloud Messaging HTTP v1 (Android, and iOS through FCM's APNs bridge).
 * Checked against firebase.google.com/docs/reference/fcm/rest/v1 (2026-11-17):
 *   POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send  { message: { token, notification, data } }
 *   UNREGISTERED = HTTP 404 → remove the token.
 * Access token: service-account JWT (RS256, aud = token endpoint, ≤ 1 h) exchanged with
 * grant_type urn:ietf:params:oauth:grant-type:jwt-bearer (developers.google.com/identity/protocols/oauth2/service-account).
 */
export class FcmPushSender implements PushSender {
  readonly name = "fcm";
  private cached?: { token: string; exp: number };
  private readonly fcmBase: string;
  private readonly tokenUri: string;

  constructor(
    private readonly sa: ServiceAccount,
    opts: { fcmBase?: string; tokenUri?: string; fetch?: typeof fetch } = {},
  ) {
    this.fcmBase = opts.fcmBase ?? "https://fcm.googleapis.com";
    this.tokenUri = opts.tokenUri ?? sa.token_uri ?? "https://oauth2.googleapis.com/token";
    this.f = opts.fetch ?? fetch;
  }
  private readonly f: typeof fetch;

  static fromJson(json: string, opts?: ConstructorParameters<typeof FcmPushSender>[1]) {
    const sa = JSON.parse(json) as ServiceAccount;
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error("FCM service account JSON is missing project_id, client_email or private_key");
    return new FcmPushSender(sa, opts);
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.exp - 60 > now) return this.cached.token;
    const key = await importPKCS8(this.sa.private_key, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.sa.client_email)
      .setAudience(this.tokenUri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const r = await this.f(this.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) throw new Error(`FCM auth failed (HTTP ${r.status})`);
    this.cached = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
    return j.access_token;
  }

  async send(tokens: string[], msg: PushMessage): Promise<PushResult[]> {
    const bearer = await this.accessToken();
    const url = `${this.fcmBase}/v1/projects/${encodeURIComponent(this.sa.project_id)}/messages:send`;
    return Promise.all(
      tokens.map(async (token): Promise<PushResult> => {
        try {
          const r = await this.f(url, {
            method: "POST",
            headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
            body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: msg.data } }),
            signal: AbortSignal.timeout(10_000),
          });
          if (r.ok) return { token, ok: true };
          const j = (await r.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
          const code = j.error?.details?.find((x) => x.errorCode)?.errorCode ?? j.error?.status ?? `HTTP_${r.status}`;
          return { token, ok: false, unregistered: r.status === 404 || code === "UNREGISTERED", error: code };
        } catch (e) {
          return { token, ok: false, error: (e as Error).name };
        }
      }),
    );
  }
}
