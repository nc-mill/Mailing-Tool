# syntax=docker/dockerfile:1.9

# Verze image. Deklaruje se PŘED prvním FROM (globální ARG) a znovu v každé fázi,
# která ji používá: ARG před FROM je ve fázích neviditelný, dokud ho fáze
# nezopakuje, a nedeklarovaná ${...} se v Dockerfile rozvine na PRÁZDNÝ ŘETĚZEC,
# tiše a bez varování. Binárka by pak neměla verzi a /api/health by ji neměl
# odkud vzít. Název je shodný s konfigurační proměnnou IMAGE_VERSION z 4.9.
ARG IMAGE_VERSION=0.0.0-dev

# --- 1) Go builder: staticky slinkovaný sender -------------------------------
FROM golang:1.26-alpine AS sender-builder
ARG IMAGE_VERSION
WORKDIR /src
# Nejdřív jen manifesty, aby se cache modulů neinvalidovala každou změnou kódu.
COPY apps/sender/go.mod apps/sender/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/sender/ ./
# ŽÁDNÝ COPY fixtures. Dřívější znění mělo řádek
#   COPY packages/contracts/fixtures*/ /src/testdata/fixtures/
# s poznámkou, že se wildcard na prázdné množině chová jako no-op. NECHOVÁ.
# Ověřeno spuštěním: `docker build` skončí na
#   ERROR: failed to solve: lstat /packages/contracts: no such file or directory
# tedy hned první build image neprojde. Wildcard v Dockerfile nepokrývá chybějící
# adresář o úroveň výš.
#
# Ten řádek tu navíc nemá co dělat: `go build ./cmd/sender` fixtures nepotřebuje,
# používají je jen `go test`, a ty v image neběží. Symlink apps/sender/testdata,
# který zakládá P02, se zkopíruje spolu s adresářem a v téhle fázi zůstane visící;
# Go adresáře jménem testdata ignoruje a build tím neutrpí. Také ověřeno buildem.
# CGO_ENABLED=0 => žádná libc závislost, binárka běží i ve scratch.
# -trimpath a -ldflags "-s -w" zmenší binárku a odstraní absolutní cesty.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.version_=${IMAGE_VERSION}" \
      -o /out/ml-sender ./cmd/sender

# --- 2) Pruner: minimální podstrom monorepa pro instalaci --------------------
# turbo prune --docker vyrobí out/json (JEN manifesty, se ZACHOVANOU strukturou
# adresářů, včetně lockfilu) a out/full (zdrojáky). Musí to udělat turbo, ne glob:
# `COPY packages/*/package.json ./packages/` Docker vyhodnotí jako "zkopíruj
# nalezené soubory do cílového adresáře BEZ mezilehlých adresářů", takže se
# všech devět manifestů přepíše přes sebe do jediného souboru ./packages/package.json.
# pnpm pak workspace nenajde, `pnpm install --frozen-lockfile` spadne a povinný
# artefakt (job build-image) neprojde. Akceptační kritérium 7d.
FROM node:24.18.1-alpine AS pruner
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.10.7 prune @mlain/web @mlain/worker @mlain/cli --docker

# --- 3) Node deps: jen instalace, sdílená vrstva ------------------------------
FROM node:24.18.1-alpine AS node-deps
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile

# --- 4) Node builder: build Next.js standalone, workeru a CLI -----------------
FROM node-deps AS node-builder
ARG IMAGE_VERSION
ENV IMAGE_VERSION=${IMAGE_VERSION}
COPY --from=pruner /app/out/full/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@mlain/web --filter=@mlain/worker --filter=@mlain/cli
# Next standalone vyrobí .next/standalone se zabaleným node_modules podmnožinou.

# --- 5) Runtime --------------------------------------------------------------
FROM node:24.18.1-alpine AS runtime
ARG IMAGE_VERSION
# tini se stará o reaping zombie procesů a o předání signálů, když MODE=all
# spouští tři potomky. Bez něj SIGTERM nedojde k dětem a shutdown není graceful.
RUN apk add --no-cache tini postgresql18-client ca-certificates tzdata \
 && addgroup -g 10001 -S mlain \
 && adduser  -u 10001 -S mlain -G mlain
WORKDIR /app

COPY --from=node-builder --chown=root:root /app/apps/web/.next/standalone ./
COPY --from=node-builder --chown=root:root /app/apps/web/.next/static ./apps/web/.next/static
# apps/web/public zakládá úkol 13 souborem .gitkeep. Next standalone tenhle
# adresář sám nezabaluje, takže COPY je nutný, a na neexistující cestě by build
# spadl na `lstat: no such file or directory`.
COPY --from=node-builder --chown=root:root /app/apps/web/public ./apps/web/public
COPY --from=node-builder --chown=root:root /app/apps/worker/dist ./apps/worker/dist
COPY --from=node-builder --chown=root:root /app/apps/cli/dist ./apps/cli/dist
# Migrace. Adresář zakládá úkol 5 souborem .gitkeep, právě aby tenhle řádek mohl
# být tady od začátku a nemusel se předávat jako požadavek na P03. Bez migrací
# v image by MIGRATE_ON_START=true nemělo co aplikovat a první instalace by
# skončila s prázdným schématem, aniž by cokoliv selhalo.
COPY --from=node-builder --chown=root:root /app/packages/db/migrations ./packages/db/migrations
COPY --from=sender-builder --chown=root:root /out/ml-sender /usr/local/bin/ml-sender
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=root:root docker/mlain /usr/local/bin/mlain
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/mlain

# Data se zapisují jen do /data, aplikační soubory jsou pro běžícího uživatele
# jen ke čtení. Kontejner tedy jde spustit s read-only rootfs (kritérium 8).
RUN mkdir -p /data/uploads /data/backups && chown -R 10001:10001 /data
VOLUME ["/data"]

# Health porty jsou rozdělené per proces SCHVÁLNĚ. Při MODE=all běží worker
# i sender jako potomci v jednom kontejneru se SDÍLENÝM prostředím, takže jedna
# společná proměnná HEALTH_PORT znamená, že druhý z nich spadne na obsazeném
# portu, a to hned ve výchozí konfiguraci MVP 0. Kritérium 8c.
ENV NODE_ENV=production \
    MODE=all \
    PORT=3000 \
    WORKER_HEALTH_PORT=3001 \
    SENDER_HEALTH_PORT=3002 \
    DATA_DIR=/data \
    IMAGE_VERSION=${IMAGE_VERSION}
EXPOSE 3000
USER 10001:10001

# Readiness, ne liveness: kontroluje i dostupnost databáze a shodu schématu.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/usr/local/bin/mlain", "healthcheck"]

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
