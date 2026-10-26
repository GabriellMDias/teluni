#!/usr/bin/env bash
# Disposable qualification only: exercises the same bootstrap CLI used on a
# host, without DNS, external accounts or credentials. Its EXIT trap deletes
# ONLY this generated project's volumes, unlike the durable CLI down command.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repository="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
configuration="$work/config"
cli="$repository/tooling/deployment/presentation.mjs"
host=present.teluni.test
port=18443
project=""

compose() {
  docker compose --project-directory "$here" --file "$here/compose.yaml" \
    --env-file "$configuration/compose.env" --project-name "$project" "$@"
}
cleanup() {
  local status=$?
  set +e
  if [ -n "$project" ]; then
    if [ "$status" -ne 0 ]; then
      compose logs --no-color --tail 60 api keycloak mailpit proxy 2>/dev/null
    fi
    compose down --volumes --remove-orphans >/dev/null 2>&1
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
https() {
  curl --silent --show-error --noproxy '*' \
    --cacert "$configuration/certificates/origin-ca.crt" \
    --connect-to "$host:443:127.0.0.1:$port" "$@"
}
expect_status() {
  local expected="$1" path="$2" actual
  actual="$(https --output /dev/null --write-out '%{http_code}' "https://$host$path")"
  if [ "$actual" != "$expected" ]; then
    printf '[presentation] %s answered %s; expected %s\n' "$path" "$actual" "$expected" >&2
    exit 1
  fi
}
node "$cli" init "$configuration" "https://$host" "$port" rehearsal
project="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1])).project)' "$configuration/installation.json")"
node "$cli" up "$configuration"
expect_status 200 /
expect_status 200 /companies/any/deep-link
expect_status 200 /identity/realms/teluni/.well-known/openid-configuration
for path in /api/health /api/health/ready /identity/admin/ /identity/realms/master/.well-known/openid-configuration; do
  expect_status 404 "$path"
done
# The issuing CA must be explicitly trusted; system defaults cannot validate
# this disposable origin. No curl request ever disables TLS verification.
if curl --silent --noproxy '*' --connect-to "$host:443:127.0.0.1:$port" "https://$host/" >/dev/null 2>&1; then
  printf '[presentation] Origin unexpectedly trusted without its CA\n' >&2
  exit 1
fi
node "$cli" check "$configuration"
# The host connector's edge address controls the limiter. Forged XFF values
# cannot change it, whereas a different edge client receives a separate bucket.
for attempt in $(seq 1 21); do
  expected=400
  [ "$attempt" -eq 21 ] && expected=429
  actual="$(https --output /dev/null --write-out '%{http_code}' \
    --header 'CF-Connecting-IP: 198.51.100.100' \
    --header "X-Forwarded-For: 203.0.113.$attempt" \
    --header 'Content-Type: application/json' --data '{}' "https://$host/api/device-enrollments")"
  [ "$actual" = "$expected" ] || { printf '[presentation] Edge limiter failed: %s\n' "$actual" >&2; exit 1; }
done
actual="$(https --output /dev/null --write-out '%{http_code}' \
  --header 'CF-Connecting-IP: 198.51.100.101' \
  --header 'Content-Type: application/json' --data '{}' "https://$host/api/device-enrollments")"
[ "$actual" = 400 ] || { printf '[presentation] Distinct edge client was not preserved\n' >&2; exit 1; }
# Re-running the installation must preserve credentials, CA, the account and
# its provider credentials. The second login uses the originally generated file.
sha256sum "$configuration/operator.env" "$configuration/installation.json" \
  "$configuration/certificates/origin-ca.crt" >"$work/before.sha256"
node "$cli" down "$configuration"
node "$cli" up "$configuration"
sha256sum --check --status "$work/before.sha256"
node "$cli" check "$configuration"
node "$cli" tunnel "$configuration" >"$work/route.json"
node --input-type=module - "$work/route.json" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const route = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(route.service, "https://localhost:18443");
assert.equal(route.originRequest.originServerName, "present.teluni.test");
assert.equal(route.originRequest.noTLSVerify, false);
assert.match(readFileSync(route.originRequest.caPool, "utf8"), /BEGIN CERTIFICATE/);
JS
printf '[presentation] Verified TLS, login/logout, SMTP, proxy limits and durable restart passed\n'
