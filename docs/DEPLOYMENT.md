# Deploying WillSpot (phase 4)

Production runs on **any conformant Kubernetes ≥ 1.27** using the Helm chart in [`infra/helm/willspot`](../infra/helm/willspot). Nothing in the chart is tied to one cloud.

**Data residency.** Personal data must stay in Nigeria (ADR-008). That means the cluster, the Postgres databases, the backup bucket and the trace store must all be hosted in-country. Pick the provider with counsel; this is open decision 2 in [PLAN.md](PLAN.md).

> **Status (2026-11-19).** Installed and exercised on a local **kind** cluster (Kubernetes 1.37) with the real images. Results:
> - Install took 39 s, with migrations run by the owner role. All 16 pods ran with 0 restarts, and the smoke test passed 58/58 against the cluster.
> - `helm upgrade` works, including the migration hooks and an image change.
> - Zero-downtime rollouts: two wallet restarts under load, 291,399 requests, 0 errors.
> - NetworkPolicies are enforced: calls that aren't allowed are dropped.
> - The app role can't run DDL or reach another service's database.
> - Gateway rate limits are shared through Redis.
> - The backup CronJob dumped all 9 databases with the read-only role.
>
> Not yet tested: a real cloud cluster, ingress/TLS, HPA scaling (no metrics-server), External Secrets, and the S3 backup upload.

**Ingress controller.** The community **ingress-nginx** controller was retired in March 2026 and gets no more security fixes. Don't use it for production. Pick a maintained controller or a Gateway API implementation your host supports, and set `ingress.className`. The chart's admin IP allow-list annotation is nginx-specific, so check the equivalent for your controller.

## What gets deployed

| Piece | Kind | Notes |
|---|---|---|
| gateway, identity, wallet, trade, config, giftcards, bills, risk, notifications | Deployment + Service + PDB (+ HPA) | Zero-downtime rolling updates (`maxUnavailable: 0`). Replicas are spread across zones and nodes. Pods are non-root with a read-only filesystem, no Linux capabilities and no service-account token. |
| admin | Deployment + Service + PDB | Next.js standalone server. Restrict it to office or VPN ranges with `ingress.admin.allowCidrs`. |
| Ingress | `api.<domain>`, `admin.<domain>` | Only the gateway and the admin site are reachable from outside. |
| NetworkPolicies | default deny + allow-lists | Each service accepts calls only from the services that call it in code (`services.<x>.allowFrom`). The metrics port is open to the monitoring namespace only. |
| Migration Jobs | Helm hooks `pre-install,pre-upgrade` | One per database, run with the schema-owner credentials (`MIGRATOR_DATABASE_URL`). Pods start with `MIGRATE_ON_START=0`. |
| ExternalSecrets (optional) | hooks, weight −10 | One remote JSON secret per service, synced into a Secret named `<release>-<service>`. |
| Backup CronJob (+ restore-drill CronJob) | daily / weekly | See [Backups](#backups-and-restore-drills). |
| ServiceMonitor, PrometheusRule (optional) | Prometheus Operator CRDs | Metrics on port 9464, alert rules from `infra/observability/alerts`. |

**Install these separately:**
- **NATS with JetStream** (the official `nats` Helm chart), then set `config.NATS_URL`.
- **Redis**, needed whenever the gateway runs more than one replica (shared rate limits).
- An **OpenTelemetry Collector** (`config.OTEL_EXPORTER_OTLP_ENDPOINT`).
- **ingress-nginx** (or your own ingress class) and **cert-manager**.
- **External Secrets Operator**, if you use a secret manager.

## Secrets per service (least privilege)

Each service reads **only** its own Secret. Every key can also be supplied as `KEY_FILE=/path` (Vault agent, the CSI secrets driver).

| Secret | Keys |
|---|---|
| `<release>-identity` | `IDENTITY_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `IDENTITY_FIELD_KEY`, `SERVICE_TOKEN_IDENTITY`, `SERVICE_TOKEN_WALLET`, `SERVICE_TOKEN_TRADE`, `SERVICE_TOKEN_GIFTCARDS`, `SERVICE_TOKEN_BILLS`, `SERVICE_TOKEN_RISK`, `TERMII_*`, `DOJAH_*`; optionally `ADMIN_EMAIL`/`ADMIN_PASSWORD` for the first admin (remove after first start) |
| `<release>-wallet` | `WALLET_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `SERVICE_TOKEN_WALLET`, `SERVICE_TOKEN_TRADE`, `SERVICE_TOKEN_GIFTCARDS`, `SERVICE_TOKEN_BILLS`, `DEPOSIT_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`, `OPS_ALERT_WEBHOOK_URL`; optional `REFERRAL_REWARD_NGN`, `REFERRAL_MIN_DEPOSIT_NGN`, `REFERRAL_MONTHLY_CAP` |
| `<release>-trade` | `TRADE_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `SERVICE_TOKEN_TRADE`, `OPS_ALERT_WEBHOOK_URL` |
| `<release>-config` | `CONFIG_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `SERVICE_TOKEN_*` of every caller |
| `<release>-giftcards` | `GIFTCARDS_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `SERVICE_TOKEN_GIFTCARDS`, `GIFTCARD_CODE_KEY` |
| `<release>-bills` | `BILLS_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `SERVICE_TOKEN_BILLS`, `VTPASS_*` |
| `<release>-risk` | `RISK_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `SERVICE_TOKEN_RISK`, `SERVICE_TOKEN_*` of callers |
| `<release>-notifications` | `NOTIFICATIONS_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `FCM_SERVICE_ACCOUNT_JSON`, `NATS_TOKEN` |
| `<release>-support` | `SUPPORT_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `JWT_PUBLIC_KEY`, `SERVICE_TOKEN_SUPPORT` (identity and config also need `SERVICE_TOKEN_SUPPORT` to accept its calls) |
| `<release>-gateway` (optional) | `REDIS_URL` if it carries a password |
| `<release>-backup` | `<SERVICE>_DATABASE_URL` for each database (read-only backup role), `BACKUP_DEST`, `BACKUP_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `age-recipients.txt` |
| `<release>-backup-drill` | `DRILL_ADMIN_URL` (scratch server), `BACKUP_SOURCE`, S3 keys, `age-identity.txt` |

**Database roles.** Use one Postgres role per service for the app: it may read and write rows but cannot run DDL. Use a separate owner role for the migration Job, and a read-only role for backups. Each service gets its own database, and ideally its own managed instance for the money services (wallet, trade).

## First install

1. Create the namespace and the Secrets above, or the ClusterSecretStore if you use External Secrets.
2. Create the NATS, Redis and collector services.
3. Write a values file (keep it outside git if it holds anything sensitive):
   ```yaml
   image: { registry: ghcr.io/<owner>, tag: "0.4.0" }
   config: { CORS_ORIGINS: "https://www.example.ng", NATS_URL: "nats://nats.nats:4222", REDIS_URL: "redis://redis:6379", OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.observability:4318" }
   ingress: { api: { host: api.example.ng }, admin: { host: admin.example.ng, allowCidrs: "203.0.113.0/24" } }
   externalSecrets: { enabled: true }
   monitoring: { serviceMonitor: true, prometheusRule: true }
   ```
4. Build and push the images: tag `<service>-v0.4.0` for each service, plus `admin-v0.4.0` and `backup-v0.4.0`. The `release` workflow does this.
5. Run the **deploy** workflow (`environment: staging`, `version: 0.4.0`). It does a server-side dry run, then `helm upgrade --install --rollback-on-failure --wait`, then checks `https://<api>/readyz`.
6. Sign in to the admin site with the first admin. Turn on 2FA, then create the real staff under **Staff & roles** (each gets a one-time setup link) and remove `ADMIN_PASSWORD` from the identity secret.

## Local cluster (kind)

Needs Docker Desktop, kind, kubectl and helm. These commands install the chart exactly as production would, apart from sandbox providers and dev settings ([values-kind.yaml](../infra/kind/values-kind.yaml)):
```bash
for s in gateway identity wallet trade config giftcards bills risk notifications support; do docker build --build-arg SERVICE=$s -f backend/Dockerfile -t willspot-$s:dev .; done
docker build -f web/admin/Dockerfile -t willspot-admin:dev . && docker build -t willspot-backup:dev infra/backup
```
```bash
kind create cluster --config infra/kind/kind.yaml
kind load docker-image --name willspot willspot-{gateway,identity,wallet,trade,config,giftcards,bills,risk,notifications,support,admin,backup}:dev
kubectl create namespace willspot
age-keygen -o /tmp/age-identity.txt && age-keygen -y /tmp/age-identity.txt > /tmp/age-recipients.txt
python3 -I infra/kind/make_secrets.py willspot ws /tmp/age-recipients.txt
kubectl -n willspot apply -f infra/kind/deps.yaml
helm install ws infra/helm/willspot -n willspot -f infra/kind/values-kind.yaml --wait
kubectl -n willspot port-forward svc/ws-gateway 18080:8080
```
Then `API=http://localhost:18080 npx tsx scripts/smoke.ts` (from `backend/`, with `.env` loaded). Remove the cluster with `kind delete cluster --name willspot`.

The local Postgres creates three roles per service, which is the model to copy in production:
- `<svc>_owner` owns the database and runs migrations;
- `<svc>_app` can only read and write rows;
- `<svc>_backup` can only read.

See [deps.yaml](../infra/kind/deps.yaml).

## Releases and rollbacks

- **Migrations must be backward compatible.** Old pods keep serving while the Job runs, so expand the schema first and contract it in a later release.
- A failed migration fails the upgrade, and Helm rolls back automatically (`--rollback-on-failure`).
- Manual rollback: `helm rollback willspot <revision> -n willspot`. Migrations are not rolled back; write a forward fix.
- Every pod drains for 5 s after SIGTERM: `/readyz` returns 503, `/healthz` stays 200, and responses carry `Connection: close` so keep-alive clients move to live pods. It then finishes in-flight requests, closes its database and NATS connections, flushes traces, and exits.
- The gateway retries GET, HEAD and OPTIONS on a dropped upstream connection (never POST).
- The first cluster test found 2 failed requests in 150,820 during a rollout. With these two fixes it was 0 in 291,399.

## Observability

- **Logs:** JSON (pino) on stdout, each line with `service`, `trace_id`, `span_id` and the request id. Authorization, cookie, step-up and service-token headers are redacted.
- **Traces:** W3C `traceparent` across gateway → service → internal calls. Spans go over OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT`, and background jobs get their own spans. The gateway ignores client-sent trace headers. Verified with a fake collector: one crypto buy forms a single trace across gateway, trade, identity, risk and wallet.
- **Metrics:** Prometheus on port 9464, which is never routed publicly:
  - `http_server_request_duration_seconds` (by route template, never raw ids);
  - `willspot_job_runs_total`, `willspot_events_published_total`, `willspot_events_handled_total`, `willspot_push_messages_total`;
  - Node process metrics.
- **Alerts** ([rules](../infra/observability/alerts/willspot.rules.yml)):
  - high 5xx rate, slow p95, service down;
  - outbox relay failing, background jobs failing;
  - push failure rate, event-handler errors.

  Ledger drift and stuck payouts still alert through `OPS_ALERT_WEBHOOK_URL` (phase 3). Thresholds are starting points.
- **Local stack:** `docker compose -f infra/docker-compose.yml --profile observability up` adds the Collector, Tempo, Prometheus and Grafana (on 127.0.0.1:3300, with a "WillSpot overview" dashboard). The compose file validates; **it was not run**, because Docker wasn't running.

## Background jobs on many replicas

Each periodic job takes a Postgres advisory lock (`singleton()`), so only one replica runs it per tick. The others count as `skipped` in `willspot_job_runs_total`. The jobs are:
- payout verification;
- ledger reconciliation;
- trade settlement retry;
- bill requery;
- each outbox relay and outbox pruning.

## Backups and restore drills

**Backups.** `infra/backup/backup.sh` runs daily as the backup CronJob, at 01:15 UTC (02:15 Lagos).
- It dumps every database with `pg_dump -Fc` and encrypts each dump with **age** to public keys only. The private key stays offline, so the job can't read its own backups.
- It uploads the dumps to an S3-compatible bucket in-country, with a manifest of sizes and SHA-256 hashes, and moves the `LATEST` pointer last.
- It refuses to write unencrypted backups unless `BACKUP_ALLOW_UNENCRYPTED=1`.

**Restore drill.** `infra/backup/restore-drill.sh` runs weekly against a **scratch** server, never production.
- It checks the hashes, decrypts and restores every database into a `drill_*` database, and checks the migrations are present.
- For the wallet it also checks that **every asset nets to zero, every journal balances, and every stored balance equals its postings**.
- It prints a JSON report with timings (your restore time), then drops the drill databases. It exits non-zero on any failure, so alert on failed Jobs.

**Verified locally (2026-11-17)** against the dev databases:
- An age-encrypted backup of 8 databases, then a drill on it: `"ok":true`, 69 wallet journals, 0 drift, 0 mismatched balances.
- A tampered file was caught (`checksum mismatch`, exit 1).
- A backup without an encryption key was refused (exit 2).
- **Not verified:** the S3 upload path (`aws s3 cp`) and the container image (Docker wasn't running).

**Targets to agree with the business (UNVERIFIED defaults):**
- RPO 24 h with daily dumps. For less data loss, add your managed Postgres's point-in-time recovery (WAL archiving).
- RTO under 1 h for the money services. Measure it from the drill's `totalSeconds` on production-sized data.

**Disaster restore**, in order: wallet, then identity, then the rest.
1. Scale the services to 0.
2. Restore the latest set into new databases (`DRILL_KEEP=1` on the drill script does exactly this).
3. Run the drill checks.
4. Point the Secrets at the new databases.
5. Scale back up.

Events still in a service's outbox are re-sent after the restore. Notifications dedupe by event id, so nobody gets an alert twice.

## Push notifications

The backend sends push through **Firebase Cloud Messaging HTTP v1**: Android directly, iOS through FCM's APNs bridge (`PUSH_PROVIDER=fcm`, `FCM_SERVICE_ACCOUNT_JSON`). Owner steps:

1. Create a Firebase project and add the Android app (`com.willspot.willspot`) and the iOS app.
2. **iOS:** in Xcode, add the Push Notifications capability and the Background Modes → Remote notifications capability (this needs your Apple team). Upload an APNs auth key to Firebase.
3. Create a service account with the *Firebase Cloud Messaging API Admin* role and put its JSON in the notifications Secret.
4. Build the apps with the Firebase settings (no Firebase files in the repo):
   ```bash
   flutter build appbundle --dart-define=FIREBASE_PROJECT_ID=… --dart-define=FIREBASE_API_KEY=… --dart-define=FIREBASE_SENDER_ID=… --dart-define=FIREBASE_ANDROID_APP_ID=… --dart-define=FIREBASE_IOS_APP_ID=…
   ```

Without them, push stays off and the in-app inbox still works.

**UNVERIFIED:** real delivery to a device. FCM was tested against a fake server built from Google's documented contract, and the app was built with the Firebase SDK but no Firebase project.

## Store submissions (owner checklist, not done)

- **Google Play:**
  - developer account;
  - app signing key kept in Play App Signing;
  - Data safety form matching [SECURITY.md](SECURITY.md): what is collected (name, phone, email, BVN, ID images, device signals), encrypted in transit, deletion supported in-app;
  - financial-features declaration;
  - target the current API level.
- **App Store:**
  - developer account;
  - privacy nutrition labels;
  - export-compliance answer (standard HTTPS only);
  - an account-deletion path (already in Profile → Close account);
  - a demo account for review.
- Both stores ask for licences for financial and crypto features in Nigeria. This is blocked on counsel ([BENNYBIT_ANALYSIS §6](BENNYBIT_ANALYSIS.md)).
