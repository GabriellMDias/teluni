#!/usr/bin/env bash
# Runs once, when the PostgreSQL volume is first initialized: the Teluni
# database with its owner (migrations) and runtime roles, and Keycloak's
# database. Passwords come from postgres.env and never reach the logs.
set -euo pipefail

: "${TELUNI_DB_OWNER_PASSWORD:?}" "${TELUNI_DB_RUNTIME_PASSWORD:?}" "${KEYCLOAK_DB_PASSWORD:?}"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=owner_password="$TELUNI_DB_OWNER_PASSWORD" \
  --set=runtime_password="$TELUNI_DB_RUNTIME_PASSWORD" \
  --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE ROLE teluni_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE orion_runtime LOGIN PASSWORD :'runtime_password';
CREATE ROLE keycloak LOGIN PASSWORD :'keycloak_password';
CREATE DATABASE teluni OWNER teluni_owner;
CREATE DATABASE keycloak OWNER keycloak;
REVOKE ALL ON DATABASE teluni FROM PUBLIC;
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
GRANT CONNECT ON DATABASE teluni TO orion_runtime;
SQL
