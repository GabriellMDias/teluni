#!/usr/bin/env bash
# Rehearses the pilot deployment on this machine
# (docs/project/deployment-design.md#delivery-increments): builds the images,
# starts the stack with generated secrets and Caddy's local CA, provisions the
# realm, checks the routing through the proxy, writes data, takes a snapshot,
# then restores it into a second project from nothing and checks it again.
# Needs Docker with Compose, curl, openssl and free loopback ports 80 and 443.
# Nothing here uses real accounts or leaves state behind.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
source_project=teluni-rehearsal
restored_project=teluni-restored

export TELUNI_CONFIG_DIR="$work/config"
export TELUNI_APP_HOST=app.teluni.test
export TELUNI_AUTH_HOST=auth.teluni.test
export TELUNI_APEX_HOST=teluni.test
export TELUNI_ACME_EMAIL=ops@teluni.test
export TELUNI_CADDY_OPTIONS=local_certs
export TELUNI_RELEASE=rehearsal
export TELUNI_HTTP_BIND=127.0.0.1:80
export TELUNI_HTTPS_BIND=127.0.0.1:443

log() { printf '[rehearsal] %s\n' "$*"; }
fail() { printf '[rehearsal] FAILED: %s\n' "$*" >&2; exit 1; }

compose() {
  local project="$1"
  shift
  docker compose --project-name "$project" --project-directory "$here" \
    --file "$here/compose.yaml" --file "$work/rehearsal.yaml" "$@"
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    for project in "$source_project" "$restored_project"; do
      compose "$project" --profile tools logs --no-color --tail 80 2>/dev/null || true
    done
  fi
  for project in "$source_project" "$restored_project"; do
    compose "$project" --profile tools down --volumes --remove-orphans >/dev/null 2>&1 || true
  done
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

secret() { openssl rand -base64 32 | tr -d '=+/\n' | cut -c1-32; }
key_ring() { printf '%s:%s' "$1" "$(openssl rand 32 | basenc --base64url | tr -d '=\n')"; }
signing_ring() {
  printf '%s:%s' "$1" "$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 2>/dev/null \
    | openssl pkcs8 -topk8 -nocrypt -outform DER | basenc --base64url | tr -d '=\n')"
}

write_config() {
  mkdir -p "$TELUNI_CONFIG_DIR" "$work/repository" "$work/ca"
  chmod 700 "$TELUNI_CONFIG_DIR"
  local postgres_password owner_password runtime_password keycloak_db_password
  local admin_password web_secret provisioner_secret
  postgres_password="$(secret)"
  owner_password="$(secret)"
  runtime_password="$(secret)"
  keycloak_db_password="$(secret)"
  admin_password="$(secret)"
  web_secret="$(secret)"
  provisioner_secret="$(secret)"
  cat >"$TELUNI_CONFIG_DIR/postgres.env" <<ENV
POSTGRES_PASSWORD=$postgres_password
TELUNI_DB_OWNER_PASSWORD=$owner_password
TELUNI_DB_RUNTIME_PASSWORD=$runtime_password
KEYCLOAK_DB_PASSWORD=$keycloak_db_password
ENV
  cat >"$TELUNI_CONFIG_DIR/release.env" <<ENV
ORION_MIGRATION_DATABASE_URL=postgresql://teluni_owner:$owner_password@postgres:5432/teluni
TELUNI_KEYCLOAK_ADMIN_URL=http://keycloak:8080
TELUNI_KEYCLOAK_ADMIN_USERNAME=bootstrap-admin
TELUNI_KEYCLOAK_ADMIN_PASSWORD=$admin_password
TELUNI_PUBLIC_ORIGIN=https://$TELUNI_APP_HOST
ORION_TOKEN_AUDIENCE=teluni-api
TELUNI_OIDC_CLIENT_SECRET=$web_secret
TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET=$provisioner_secret
ENV
  cat >"$TELUNI_CONFIG_DIR/keycloak.env" <<ENV
KC_DB_PASSWORD=$keycloak_db_password
KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap-admin
KC_BOOTSTRAP_ADMIN_PASSWORD=$admin_password
ENV
  cat >"$TELUNI_CONFIG_DIR/api.env" <<ENV
ORION_DATABASE_URL=postgresql://orion_runtime:$runtime_password@postgres:5432/teluni
ORION_TOKEN_ISSUER=https://$TELUNI_AUTH_HOST/realms/teluni
ORION_TOKEN_AUDIENCE=teluni-api
ORION_TOKEN_JWKS_URL=https://$TELUNI_AUTH_HOST/realms/teluni/protocol/openid-connect/certs
TELUNI_PUBLIC_ORIGIN=https://$TELUNI_APP_HOST
TELUNI_OIDC_CLIENT_ID=teluni-web
TELUNI_OIDC_CLIENT_SECRET=$web_secret
TELUNI_IDENTITY_PROVISIONER_CLIENT_ID=teluni-provisioner
TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET=$provisioner_secret
TELUNI_SESSION_KEYS=$(key_ring s1)
TELUNI_MAIL_SMTP_HOST=mail.teluni.test
TELUNI_MAIL_SMTP_PORT=465
TELUNI_MAIL_SMTP_SECURITY=tls
TELUNI_MAIL_FROM=no-reply@notify.teluni.test
TELUNI_MAIL_KEYS=$(key_ring m1)
TELUNI_DEVICE_CODE_KEYS=$(key_ring d1)
TELUNI_SYNC_SIGNING_KEYS=$(signing_ring k1)
ENV
  cat >"$TELUNI_CONFIG_DIR/backup.env" <<ENV
PGPASSWORD=$postgres_password
RESTIC_REPOSITORY=/repository
RESTIC_PASSWORD=$(secret)
ENV
  # The rehearsal's only differences from production: the API trusts Caddy's
  # local CA, and the off-host bucket is a directory on this machine.
  cat >"$work/rehearsal.yaml" <<YAML
services:
  api:
    environment:
      NODE_EXTRA_CA_CERTS: /rehearsal-ca/root.crt
    volumes:
      - $work/ca:/rehearsal-ca:ro
  backup:
    volumes:
      - $work/repository:/repository
YAML
}

wait_healthy() {
  local project="$1" service="$2"
  for _ in $(seq 1 90); do
    local id state
    id="$(compose "$project" ps --quiet "$service")"
    state="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || true)"
    [ "$state" = healthy ] && return 0
    sleep 2
  done
  fail "$service in $project did not become healthy"
}

https() {
  curl --silent --show-error --noproxy '*' --cacert "$work/ca/root.crt" \
    --resolve "$TELUNI_APP_HOST:443:127.0.0.1" \
    --resolve "$TELUNI_AUTH_HOST:443:127.0.0.1" \
    --resolve "$TELUNI_APEX_HOST:443:127.0.0.1" "$@"
}

expect_status() {
  local expected="$1" url="$2" actual
  actual="$(https --output /dev/null --write-out '%{http_code}' "$url")"
  [ "$actual" = "$expected" ] || fail "$url answered $actual, expected $expected"
}

start_stack() {
  local project="$1"
  compose "$project" up --detach --wait --wait-timeout 300
  compose "$project" cp proxy:/data/caddy/pki/authorities/local/root.crt "$work/ca/root.crt"
  chmod 644 "$work/ca/root.crt"
  # The API started before the proxy created its CA; restart it to trust it.
  compose "$project" restart api >/dev/null
  wait_healthy "$project" api
}

check_routing() {
  expect_status 200 "https://$TELUNI_APP_HOST/"
  https "https://$TELUNI_APP_HOST/" | grep -q '<div id="root"' || fail "panel index not served"
  expect_status 200 "https://$TELUNI_APP_HOST/companies/any/deep-link"
  expect_status 404 "https://$TELUNI_APP_HOST/api/health/ready"
  expect_status 301 "https://$TELUNI_APEX_HOST/"
  expect_status 200 "https://$TELUNI_AUTH_HOST/realms/teluni/.well-known/openid-configuration"
  expect_status 404 "https://$TELUNI_AUTH_HOST/admin/"
  expect_status 404 "https://$TELUNI_AUTH_HOST/realms/master/.well-known/openid-configuration"
  # The API discovers the realm through the proxy and redirects to it.
  local location
  location="$(https --output /dev/null --write-out '%{redirect_url}' "https://$TELUNI_APP_HOST/api/auth/login")"
  case "$location" in
    "https://$TELUNI_AUTH_HOST/realms/teluni/protocol/openid-connect/auth?"*) ;;
    *) fail "login did not redirect to the realm: $location" ;;
  esac
}

company=00000000-0000-4000-8000-0000000000c1
seed_data() {
  local project="$1" file="$work/object.bin" sha size
  openssl rand 4096 >"$file"
  sha="$(sha256sum "$file" | cut -d' ' -f1)"
  size="$(stat --format=%s "$file")"
  compose "$project" exec -T postgres psql --username postgres --dbname teluni \
    --set=ON_ERROR_STOP=1 --set=sha="$sha" --set=size="$size" --quiet <<SQL
INSERT INTO principals (id, issuer, subject)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'https://$TELUNI_AUTH_HOST/realms/teluni', 'rehearsal');
INSERT INTO companies (id, display_name, default_locale, time_zone, created_by_principal_id,
    creation_key, creation_fingerprint)
  VALUES ('$company', 'Rehearsal', 'pt-BR', 'America/Sao_Paulo',
    '00000000-0000-4000-8000-0000000000a1', 'rehearsal', repeat('0', 64));
INSERT INTO media_objects (company_id, sha256, byte_size, content_type)
  VALUES ('$company', decode(:'sha', 'hex'), :size, 'image/png');
SQL
  compose "$project" exec -T api sh -c \
    "mkdir -p /var/lib/teluni/media/objects/$company/${sha:0:2} && cat >/var/lib/teluni/media/objects/$company/${sha:0:2}/$sha" <"$file"
}

counts() {
  compose "$1" exec -T postgres psql --username postgres --dbname teluni --tuples-only --no-align \
    --command "SELECT (SELECT count(*) FROM companies) || '/' || (SELECT count(*) FROM media_objects)"
}

log "building images"
write_config
compose "$source_project" --profile tools build

log "starting the stack"
compose "$source_project" up --detach --wait --wait-timeout 300 postgres keycloak
compose "$source_project" run --rm release realm >/dev/null
start_stack "$source_project"

log "checking routing, TLS and discovery through the proxy"
check_routing

log "writing data and taking a snapshot"
seed_data "$source_project"
compose "$source_project" run --rm backup verify --hash
expected="$(counts "$source_project")"
compose "$source_project" run --rm backup snapshot
compose "$source_project" --profile tools down --volumes --remove-orphans >/dev/null

log "restoring into a new project"
compose "$restored_project" up --detach --wait --wait-timeout 300 postgres
compose "$restored_project" run --rm backup restore
compose "$restored_project" run --rm backup verify --hash
start_stack "$restored_project"
compose "$restored_project" run --rm release end-sessions >/dev/null

log "checking the restored stack"
[ "$(counts "$restored_project")" = "$expected" ] || fail "restored counts differ from $expected"
check_routing
log "rehearsal passed"
