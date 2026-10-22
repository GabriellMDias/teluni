#!/usr/bin/env bash
# Backups of the pilot deployment (docs/project/deployment-design.md#backups-and-restore).
#
#   snapshot          dump both databases, then snapshot the dumps and the
#                     media objects, then apply the retention policy
#   maintain          prune expired data and read a 5% sample of the repository
#   restore [ID]      restore a snapshot (default: latest) into this project's
#                     empty databases and media volume, then verify it
#   verify            check that every stored media object exists with its size
#                     (and, with --hash, its SHA-256)
#   snapshots         list snapshots
#
# Settings (backup.env): RESTIC_REPOSITORY, RESTIC_PASSWORD and the bucket's
# credentials; PGPASSWORD for the postgres superuser. Secrets are never printed.
set -euo pipefail

media="${TELUNI_MEDIA_DIR:?}"
work=/tmp/teluni-backup
dumps="$work/dumps"
databases=(teluni keycloak)

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

ensure_repository() {
  if ! restic cat config >/dev/null 2>&1; then
    log "initializing repository"
    restic init >/dev/null
  fi
}

snapshot() {
  ensure_repository
  rm -rf "$work"
  mkdir -p "$dumps" "$media/objects"
  # Dumps first: objects are write-once and purged at least 30 days after
  # deletion, so the objects copied afterwards include every one they name.
  for database in "${databases[@]}"; do
    pg_dump --format=custom --dbname "$database" --file "$dumps/$database.dump"
  done
  date -u +%Y-%m-%dT%H:%M:%SZ >"$dumps/taken-at"
  printf '%s\n' "${TELUNI_RELEASE:-unknown}" >"$dumps/release"
  restic backup --quiet --tag teluni --host teluni "$dumps" "$media/objects"
  restic forget --quiet --tag teluni --host teluni \
    --keep-last 8 --keep-daily 14 --keep-weekly 5
  rm -rf "$work"
  log "snapshot_complete"
}

maintain() {
  ensure_repository
  restic forget --quiet --tag teluni --host teluni \
    --keep-last 8 --keep-daily 14 --keep-weekly 5 --prune
  restic check --read-data-subset=5%
  log "maintenance_complete"
}

empty_database() {
  [ "$(psql --dbname "$1" --tuples-only --no-align --command \
    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" = "0" ]
}

restore() {
  local id="${1:-latest}"
  for database in "${databases[@]}"; do
    if ! empty_database "$database"; then
      log "refusing to restore: database $database is not empty"
      exit 1
    fi
  done
  if [ -n "$(ls -A "$media/objects" 2>/dev/null)" ]; then
    log "refusing to restore: the media volume already holds objects"
    exit 1
  fi
  rm -rf "$work"
  mkdir -p "$work/restore"
  restic restore "$id" --tag teluni --host teluni --target "$work/restore" >/dev/null
  for database in "${databases[@]}"; do
    pg_restore --exit-on-error --dbname "$database" "$work/restore$dumps/$database.dump"
  done
  # Sessions taken before the backup are not trusted after a restore: people
  # sign in again (Keycloak's sessions end with the release image's
  # end-sessions step).
  psql --dbname teluni --quiet --command \
    "DELETE FROM human_sessions; DELETE FROM oidc_login_attempts;"
  mkdir -p "$media/objects"
  if [ -d "$work/restore$media/objects" ]; then
    cp -a "$work/restore$media/objects/." "$media/objects/"
  fi
  # The API runs as uid 10001 (infra/pilot/Dockerfile).
  chown -R 10001:10001 "$media"
  log "restored snapshot $id taken at $(cat "$work/restore$dumps/taken-at")"
  rm -rf "$work"
  verify
}

verify() {
  local hash=false missing=0 checked=0
  [ "${1:-}" = "--hash" ] && hash=true
  while IFS='|' read -r company sha size; do
    [ -n "$company" ] || continue
    checked=$((checked + 1))
    local path="$media/objects/$company/${sha:0:2}/$sha"
    if [ ! -f "$path" ] || [ "$(stat --format=%s "$path")" != "$size" ]; then
      log "object_missing company=$company sha256=$sha"
      missing=$((missing + 1))
    elif $hash && [ "$(sha256sum "$path" | cut -d' ' -f1)" != "$sha" ]; then
      log "object_corrupt company=$company sha256=$sha"
      missing=$((missing + 1))
    fi
  done < <(psql --dbname teluni --tuples-only --no-align --field-separator='|' \
    --command "SELECT company_id, encode(sha256, 'hex'), byte_size FROM media_objects")
  log "verify objects=$checked problems=$missing"
  [ "$missing" -eq 0 ]
}

command="${1:-snapshot}"
shift || true
case "$command" in
  snapshot) snapshot ;;
  maintain) maintain ;;
  restore) restore "$@" ;;
  verify) verify "$@" ;;
  snapshots) restic snapshots --tag teluni ;;
  *)
    echo "Usage: teluni-backup snapshot | maintain | restore [ID] | verify [--hash] | snapshots" >&2
    exit 2
    ;;
esac
