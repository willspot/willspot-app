# Load test and server sizing

**Date:** 2026-11-19. **Tool:** `backend/scripts/load.ts` (our own script; k6 was ruled out because it is AGPL-3.0).
**Raw results:** [load-report-2026-11-19.json](load-report-2026-11-19.json).

## What was run

All ten services, Postgres and NATS ran on one MacBook (`npm run dev`, sandbox providers), with the gateway rate limits raised so a single client IP isn't throttled:

```bash
cd backend
RATE_LIMIT_GENERAL=10000000 RATE_LIMIT_STRICT=10000000 LOG_LEVEL=warn npm run dev
```

```bash
cd backend && API=http://localhost:8080 USERS=60 CONCURRENCY=30 DURATION=90 npx tsx scripts/load.ts
```

The script works in two stages:

1. **Account setup.** It creates real accounts through the gateway: sign-up, OTP, PIN, BVN, deposit account and a first deposit.
2. **Mixed workload.** It then runs a workload shaped like a busy evening. About 60% of requests are reads (balances, history, notifications, config, markets). The rest move money: quote, PIN and buy; deposits; PIN and withdrawal; and statements in JSON and PDF.

The script refuses URLs that look like production.

## Results

### Run 1: before the fix

**Overall:** 96 req/s and no errors, but slow.

**PIN check:** p50 1,165 ms, p95 1,890 ms. Every buy and withdrawal waited on it.

**Identity service:** averaged **4.07 CPU cores** and 691 MB.

**Root cause.** Transaction PINs were hashed with scrypt at N=2^17, the same setting as passwords. Each check cost about 262 ms of CPU and 128 MB of memory. Node runs scrypt on its 4-thread worker pool, so the checks queued behind each other.

**Fix (ADR-036).** PINs are now HMAC-SHA256 hashes keyed with a server-side pepper (`IDENTITY_PIN_PEPPER`). Slow hashing barely protects a 4-digit PIN, because there are only 10,000 values. A pepper kept outside the database means a stolen database alone can't be used to test any PIN. Online guessing is still stopped by the PIN lockout. Old scrypt PIN hashes are upgraded the next time the user enters the right PIN.

### Run 2: after the fix

60 users, 30 parallel clients, 90 s.

**Overall:**
- 143,094 requests at **1,590 req/s**.
- 707 errors (0.49%). All were `422 limit_exceeded` on withdrawals: test users hitting their daily withdrawal limit, which is correct business behaviour.
- No 5xx errors and no timeouts.

| Endpoint | req/s | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| withdraw | 84 | 58 | 155 | 212 |
| statement (PDF) | 23 | 55 | 148 | 192 |
| deposit | 93 | 40 | 122 | 185 |
| buy | 164 | 40 | 113 | 157 |
| statement (JSON) | 35 | 15 | 80 | 111 |
| transactions | 201 | 8 | 53 | 93 |
| balances | 297 | 6 | 50 | 89 |
| quote | 164 | 2 | 4 | 6 |
| PIN check | 248 | 2 | **4** (was 1,890) | 5 |
| notifications | 117 | 2 | 4 | 5 |
| markets | 70 | 1 | 3 | 5 |
| config | 94 | 1 | 3 | 4 |

Average CPU and memory per service during the mixed load:

| Service | CPU cores | Memory (RSS) |
|---|---:|---:|
| wallet | 1.23 | 466 MB |
| trade | 0.37 | 237 MB |
| gateway | 0.30 | 282 MB |
| identity | 0.24 | 157 MB |
| risk | 0.16 | 136 MB |
| notifications | 0.14 | 141 MB |
| config | 0.04 | 142 MB |
| bills, gift cards, support | ~0 (not in the mix) | ~80 MB |

### Sign-up path

Sign-up p50 is 766 ms and p95 1.4 s, with 20 sign-ups at once. Setting a PIN takes 835 ms at p50.

Both calls hash a **password** with scrypt, which is slow on purpose to resist offline cracking, and that is kept. The latency is the 4-thread pool queueing during a burst.

`UV_THREADPOOL_SIZE` is now set to 8 in the Helm config. Set it to match the identity pod's CPU, and scale identity on CPU, since sign-up waves (for example after a marketing push) are what load it.

## Sizing (what the Helm chart now uses)

From run 2, per 1,000 req/s of this mix:
- wallet ≈ 0.8 cores
- trade ≈ 0.25 cores
- gateway ≈ 0.2 cores
- identity ≈ 0.15 cores, plus about 0.26 core-seconds per sign-up or login

Requests are set so the 70% CPU autoscaling target is reached well before latency degrades.

| Service | Was (request / limit) | Now (request / limit) | Autoscaling |
|---|---|---|---|
| wallet | 100m, 192Mi / 384Mi | **400m, 256Mi / 640Mi** | 2 → **10** |
| trade | 100m, 192Mi / 384Mi | **200m, 192Mi / 512Mi** | 2 → 6 |
| gateway | 100m, 128Mi / 256Mi | **200m, 192Mi / 384Mi** | 3 → 12 |
| others | unchanged | unchanged | unchanged |

Memory limits went up because the dev processes passed the old limits: wallet reached 466 MB against a 384 Mi limit, and gateway 282 MB against 256 Mi. The dev processes run through `tsx`, which adds its compiler caches, so production images should use less. Check real pod memory on staging before tightening the limits again.

**Starting cluster for launch** (UNVERIFIED until the staging test below): 3 nodes of 4 vCPU / 8 GB, plus a managed Postgres with 2 vCPU and 4–8 GB. That covers the default replica counts with room for one node to fail.

## Limits of this test

- **One machine.** The load generator, all services and Postgres shared one laptop's CPU, so the absolute numbers are optimistic for network latency and pessimistic for CPU contention.
- **Postgres CPU and I/O were not measured.** The wallet's ledger writes are the most likely first bottleneck in production. Watch `pg_stat_statements` on staging.
- **Sandbox providers return instantly.** Real Paystack, Dojah and VTpass calls add hundreds of milliseconds and need timeouts and circuit breakers, which are already in place but not load-tested here.
- **One client IP**, with rate limits disabled. Production rate limiting (Redis) was not exercised.
- **Not covered:** gift-card uploads, bill payments and push delivery.

**Next step:** repeat on staging, with the generator on a separate machine, for 30 minutes at 2–3× the expected peak, and watch Postgres. Use the same script with `API=https://staging…` and `METRICS_PORTS` pointing at a port-forward.
