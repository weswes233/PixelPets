ARG CADDY_IMAGE=caddy:2-alpine
FROM ${CADDY_IMAGE}
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# Fail the build when a clean clone has not yet generated its Godot Web export.
COPY dist/web /srv
RUN test -s /srv/index.html && test -s /srv/index.wasm && test -s /srv/index.pck && test -s /srv/bridge.js
