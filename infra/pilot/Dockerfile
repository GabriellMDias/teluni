# syntax=docker/dockerfile:1
# Images of the pilot deployment (docs/project/deployment-design.md). Build
# from the repository root, as infra/pilot/compose.yaml does. Base images are
# pinned by digest.

ARG NODE_IMAGE=docker.io/library/node:24.13.0-trixie-slim@sha256:036dfa7e82a1e867b09248440a2b6635b3f8de557f69e60bac923a10c6e696a8
ARG UBUNTU_IMAGE=docker.io/library/ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
ARG CADDY_IMAGE=docker.io/library/caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.8.1@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b
ARG POSTGRES_IMAGE=docker.io/library/postgres:16.15-trixie@sha256:9e2cf6287f25c3151f4c9421ccce2b17f3e60061c111a29165e0d2cdd9ff0a97
ARG RESTIC_IMAGE=docker.io/restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76

# The workspace installed from the frozen lockfile, with the API and the
# panel built.
# The optional build secret extra-ca adds a CA certificate for networks that
# intercept TLS; it never reaches an image.
FROM ${NODE_IMAGE} AS workspace
ENV CI=true
WORKDIR /repo
COPY . .
RUN --mount=type=secret,id=extra-ca,required=false \
    if [ -s /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi \
 && npm install --global pnpm@11.25.0 \
 && npm cache clean --force \
 && pnpm install --frozen-lockfile \
 && pnpm -C apps/api db:generate \
 && pnpm -C apps/api build \
 && pnpm -C apps/web build \
 && pnpm --filter @teluni/api deploy --prod --legacy /deploy

# The API: Ubuntu's FFmpeg 6.1 (the build CI tests against), Node.js from
# the pinned image, production dependencies only, and an unprivileged user.
FROM ${UBUNTU_IMAGE} AS api
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates ffmpeg tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 teluni \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin teluni \
 && install --directory --owner teluni --group teluni /var/lib/teluni/media
COPY --from=workspace /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=workspace /deploy/package.json ./package.json
COPY --from=workspace /deploy/node_modules ./node_modules
COPY --from=workspace /repo/apps/api/dist ./dist
ENV NODE_ENV=production \
    ORION_ENV=production \
    ORION_API_HOST=0.0.0.0 \
    ORION_API_PORT=3000 \
    TELUNI_MEDIA_STORAGE_PATH=/var/lib/teluni/media \
    TELUNI_MEDIA_FFMPEG_PATH=/usr/bin/ffmpeg \
    TELUNI_MEDIA_FFPROBE_PATH=/usr/bin/ffprobe
USER teluni
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/main.js"]

# Release steps: migrations with the owner role, the runtime role's grants
# and the Keycloak realm (apps/api/scripts/release.ts).
FROM workspace AS release
WORKDIR /repo/apps/api
USER node
ENTRYPOINT ["node", "--import", "tsx", "scripts/release.ts"]
CMD ["database"]

# Keycloak with the teluni login theme, built for PostgreSQL. The files are
# those of teluniThemeFiles() in apps/api/scripts/keycloak.ts.
FROM ${KEYCLOAK_IMAGE} AS keycloak-build
COPY --chown=1000:0 apps/api/keycloak/themes/teluni/login/theme.properties /opt/keycloak/themes/teluni/login/theme.properties
COPY --chown=1000:0 apps/api/keycloak/themes/teluni/login/resources/css/teluni.css /opt/keycloak/themes/teluni/login/resources/css/teluni.css
COPY --chown=1000:0 apps/api/keycloak/themes/teluni/login/login-update-password.ftl /opt/keycloak/themes/teluni/login/login-update-password.ftl
COPY --chown=1000:0 apps/api/keycloak/themes/teluni/login/messages/messages_pt_BR.properties /opt/keycloak/themes/teluni/login/messages/messages_pt_BR.properties
COPY --chown=1000:0 apps/api/keycloak/themes/teluni/login/messages/messages_en.properties /opt/keycloak/themes/teluni/login/messages/messages_en.properties
COPY --chown=1000:0 apps/web/src/assets/brand-mark.svg /opt/keycloak/themes/teluni/login/resources/img/brand-mark.svg
COPY --chown=1000:0 apps/web/public/fonts/plus-jakarta-sans.ttf /opt/keycloak/themes/teluni/login/resources/fonts/plus-jakarta-sans.ttf
COPY --chown=1000:0 apps/web/public/fonts/OFL.txt /opt/keycloak/themes/teluni/login/resources/fonts/OFL.txt
# The path is compiled into Keycloak's optimized server. The pilot keeps /;
# the isolated presentation composition builds the same version at /identity.
ARG KEYCLOAK_HTTP_RELATIVE_PATH=/
ENV KC_HTTP_RELATIVE_PATH=${KEYCLOAK_HTTP_RELATIVE_PATH} \
    KC_DB=postgres \
    KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM ${KEYCLOAK_IMAGE} AS keycloak
COPY --from=keycloak-build /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]

# The reverse proxy with the panel's static build.
FROM ${CADDY_IMAGE} AS proxy
COPY infra/pilot/Caddyfile /etc/caddy/Caddyfile
COPY --from=workspace /repo/apps/web/dist /srv/panel

# Backups: PostgreSQL 16 client tools, restic and the backup script.
FROM ${RESTIC_IMAGE} AS restic

FROM ${POSTGRES_IMAGE} AS backup
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY infra/pilot/backup/teluni-backup.sh /usr/local/bin/teluni-backup
ENTRYPOINT ["/usr/local/bin/teluni-backup"]
CMD ["snapshot"]
