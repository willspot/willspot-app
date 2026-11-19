#!/usr/bin/env python3
"""Creates the Kubernetes Secrets for the LOCAL kind test from backend/.env.

Each service gets only the keys it needs (least privilege, see docs/DEPLOYMENT.md), with a
row-only database role for the app and an owner role for migrations. Prints key NAMES only.

  python3 infra/kind/make_secrets.py <namespace> <release> <age-recipients-file>
"""
import base64
import hashlib
import os
import secrets
import subprocess
import sys

ns, release, recipients = sys.argv[1], sys.argv[2], sys.argv[3]
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = {}
for line in open(os.path.join(root, "backend", ".env")):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v[1:-1] if v.startswith('"') and v.endswith('"') else v
env.setdefault("SERVICE_TOKEN_SUPPORT", secrets.token_urlsafe(32))


def apply(name, data, files=None):
    args = ["kubectl", "-n", ns, "create", "secret", "generic", name, "--dry-run=client", "-o", "json"]
    for k, v in data.items():
        args.append(f"--from-literal={k}={v}")
    for k, path in (files or {}).items():
        args.append(f"--from-file={k}={path}")
    manifest = subprocess.run(args, check=True, capture_output=True, text=True).stdout
    subprocess.run(["kubectl", "apply", "-f", "-"], input=manifest, check=True, capture_output=True, text=True)
    print(f"secret {name}: {', '.join(sorted(list(data) + list(files or {})))}")


pw = {k: secrets.token_urlsafe(24) for k in ("POSTGRES_PASSWORD", "OWNER_PASSWORD", "APP_PASSWORD", "BACKUP_PASSWORD")}
apply("deps", pw)


def db(svc, role):
    p = {"app": pw["APP_PASSWORD"], "owner": pw["OWNER_PASSWORD"], "backup": pw["BACKUP_PASSWORD"]}[role]
    return f"postgres://{svc}_{role}:{p}@postgres:5432/willspot_{svc}"


def tok(*names):
    return {f"SERVICE_TOKEN_{n.upper()}": env[f"SERVICE_TOKEN_{n.upper()}"] for n in names}


pub = {"JWT_PUBLIC_KEY": env["JWT_PUBLIC_KEY"]}
per_service = {
    "identity": {**pub, "JWT_PRIVATE_KEY": env["JWT_PRIVATE_KEY"], "IDENTITY_FIELD_KEY": env["IDENTITY_FIELD_KEY"],
                 # Older .env files predate the PIN pepper: derive the same stable dev-only value as scripts/dev.ts.
                 "IDENTITY_PIN_PEPPER": env.get("IDENTITY_PIN_PEPPER") or base64.b64encode(hashlib.sha256((env["JWT_PRIVATE_KEY"] + ":pin-pepper").encode()).digest()).decode(),
                 **tok("identity", "wallet", "trade", "giftcards", "bills", "risk", "support"),
                 "ADMIN_EMAIL": env["ADMIN_EMAIL"], "ADMIN_PASSWORD": env["ADMIN_PASSWORD"]},
    "wallet": {**pub, **tok("wallet", "trade", "giftcards", "bills"), "DEPOSIT_WEBHOOK_SECRET": env["DEPOSIT_WEBHOOK_SECRET"]},
    "trade": {**pub, **tok("trade")},
    "config": {**pub, **tok("identity", "wallet", "trade", "giftcards", "bills", "support")},
    "giftcards": {**pub, **tok("giftcards"), "GIFTCARD_CODE_KEY": env["GIFTCARD_CODE_KEY"]},
    "bills": {**pub, **tok("bills")},
    "risk": {**pub, **tok("risk", "wallet", "trade", "giftcards", "bills")},
    "notifications": {**pub},
    "support": {**pub, **tok("support")},
}
for svc, data in per_service.items():
    apply(f"{release}-{svc}", {**data, f"{svc.upper()}_DATABASE_URL": db(svc, "app"), "MIGRATOR_DATABASE_URL": db(svc, "owner")})

apply(
    f"{release}-backup",
    {**{f"{s.upper()}_DATABASE_URL": db(s, "backup") for s in per_service}, "BACKUP_DEST": "file:///tmp/backups"},
    {"age-recipients.txt": recipients},
)
