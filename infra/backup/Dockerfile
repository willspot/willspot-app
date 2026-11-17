# Backup / restore-drill image: Postgres client tools + age + AWS CLI (S3-compatible stores).
# Build:  docker build -t willspot-backup infra/backup
# TODO before production: pin by digest (docs/SECURITY.md).
FROM postgres:16-alpine
RUN apk add --no-cache age aws-cli
COPY backup.sh restore-drill.sh /usr/local/bin/
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
