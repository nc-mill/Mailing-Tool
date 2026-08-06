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
# Výměna libvips za vlastní sestavení. NENÍ to volitelné pohodlí, je to druhá
# licenční povinnost LGPL-3.0: `@img/sharp-libvips` se s image distribuuje
# a příjemce musí mít reálnou cestu, jak si tu knihovnu nahradit svou.
#
# Musí to být ARG a ENV právě TADY, ve fázi node-deps a PŘED `pnpm install`:
# proměnnou čte instalační skript balíčku sharp, tedy se musí projevit ve chvíli
# instalace závislostí. Později už je pozdě a dřív ji fáze nevidí (ARG před FROM
# je ve fázích neviditelný, dokud ho fáze nezopakuje).
#
# Dokumentace tenhle postup popisovala dřív, než tady ARG existoval. Nepřevzatý
# `--build-arg` Docker jen odvaruje na stderr a build normálně doběhne
# s přibalenou knihovnou, takže výměna TIŠE neproběhla a vypadalo to, že
# proběhla. Hlídá to `apps/web/test/ci/license-obligations.test.ts`, a hlídá
# tenhle řádek, ne větu v dokumentaci.
#
# Výchozí 0 = chování beze změny, tedy přibalená knihovna z npm.
ARG SHARP_FORCE_GLOBAL_LIBVIPS=0
ENV SHARP_FORCE_GLOBAL_LIBVIPS=${SHARP_FORCE_GLOBAL_LIBVIPS}
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

# Mapy zdrojů se do image NEKOPÍRUJÍ.
#
# `apps/{worker,cli}/build.mjs` mají `sourcemap: true`, takže vedle svazku
# vzniká `main.js.map`. V kontejneru je nikdo nečte: běží tam produkční proces
# bez připojeného debuggeru a chybové výpisy jdou do logu. Naměřeno v hotové
# image:
#
#   /app/apps/cli/dist/main.js.map      5,1 MB
#   /app/apps/worker/dist/main.js.map   4,0 MB
#   dohromady                           9,0 MB
#
# Image měla 253,1 MB proti limitu 250 MB, tedy o 3,1 MB víc. Devět megabajtů
# map je trojnásobek toho přebytku.
#
# Maže se TADY, ve fázi builderu, ne v runtime vrstvě. Vrstvy jsou přírůstkové:
# smazání souboru v pozdější vrstvě ho z image NEODSTRANÍ, jen ho skryje, a
# velikost by zůstala stejná. Musí se tedy zařídit, aby se do `COPY` nedostaly.
#
# Lokální `pnpm build` mapy dál vyrábí, takže se ladit dá; ořezává se jen to,
# co se distribuuje.
RUN find /app/apps -name '*.js.map' -type f -delete

# Nativní modul pro runtime vrstvu.
#
# `@node-rs/argon2` je v buildu workeru i CLI označený jako `external`, tedy se
# do svazku NEBALÍ a musí se za běhu najít v `node_modules`. Runtime vrstva
# ale kopíruje jen `dist` adresáře, takže balíček v image nebyl vůbec a kontejner
# skončil v restartové smyčce na
#
#   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@node-rs/argon2'
#     imported from /app/apps/cli/dist/main.js
#
# Externalizace bez doručení balíčku je jen přesunutí pádu z buildu do prvního
# spuštění. Balíčky tedy musí do image přijet zvlášť.
#
# Sběr dělá `docker/collect-runtime-deps.mjs`, ne příkaz na tomhle řádku.
# Důvod je v tom souboru popsaný: víceřádkový skript uvnitř `RUN node -e "…"`
# prochází shellem, který ve dvojitých uvozovkách provede všechno ve zpětných
# apostrofech, takže se komentář se jmény balíčků tiše vykoná jako příkaz.
#
# Fáze builderu i runtime stojí na `node:24.18.1-alpine`, takže je to táž
# platforma a varianty pro musl sedí.
COPY docker/collect-runtime-deps.mjs /tmp/collect-runtime-deps.mjs
RUN set -eux; \
    mkdir -p /runtime-deps/node_modules; \
    node /tmp/collect-runtime-deps.mjs; \
    rm /tmp/collect-runtime-deps.mjs; \
    node -e "const a=require('/runtime-deps/node_modules/@node-rs/argon2'); if (typeof a.hashSync !== 'function') { throw new Error('argon2 se nacetl, ale nema hashSync'); } console.log('argon2 overen:', a.hashSync('x').slice(0, 12));"; \
    node -e "const s=require('/runtime-deps/node_modules/sharp'); if (typeof s !== 'function') { throw new Error('sharp se nacetl, ale neni funkce'); } console.log('sharp overen, verze libvips:', s.versions.vips);"
# Oba moduly se SKUTEČNĚ načtou a zavolají, tedy provede se i načtení nativní
# knihovny. Bez toho by se chyba projevila až v běžícím kontejneru, což je
# přesně to, co tahle vrstva řeší. U sharpu se čte verze libvips, protože ta
# pochází z nativní části; samotné `typeof === function` by prošlo i tehdy,
# kdyby knihovna chyběla.

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
# Nativní modul, který si `dist` adresáře výš NENESOU: v jejich buildu je
# `@node-rs/argon2` označený jako `external`, takže se do svazku nezabalil
# a musí se za běhu najít v `node_modules`. Připravuje ho fáze `node-builder`.
#
# TENHLE ŘÁDEK MUSÍ BÝT AŽ ZA `.next/standalone`. Standalone si nese vlastní
# `node_modules` a kdyby přišel po tomhle, přepsal by ho. V tomhle pořadí
# Docker obsah adresáře sloučí a `@node-rs` se jen přidá vedle.
#
# Bez něj se `/runtime-deps` v builderu připraví, ověří a zahodí spolu
# s mezivrstvou, takže kontejner skončí v restartové smyčce na
# `ERR_MODULE_NOT_FOUND: Cannot find package '@node-rs/argon2'` hned při
# `mlain migrate` z entrypointu. Ověřeno, přesně tak se to stalo.
COPY --from=node-builder --chown=root:root /runtime-deps/node_modules ./node_modules
# Migrace. Adresář zakládá úkol 5 souborem .gitkeep, právě aby tenhle řádek mohl
# být tady od začátku a nemusel se předávat jako požadavek na P03. Bez migrací
# v image by MIGRATE_ON_START=true nemělo co aplikovat a první instalace by
# skončila s prázdným schématem, aniž by cokoliv selhalo.
COPY --from=node-builder --chown=root:root /app/packages/db/migrations ./packages/db/migrations
COPY --from=sender-builder --chown=root:root /out/ml-sender /usr/local/bin/ml-sender
# Plné texty licencí, které se musí distribuovat spolu s programem.
#
# Není to formalita: `@img/sharp-libvips` je pod LGPL-3.0 a ta ukládá přiložit
# text licence ke každé distribuci. Image JE distribuce. Bez tohohle řádku
# porušuje licenci každý, kdo ji někam nasadí, a nemá jak to zjistit.
#
# Postup, jak knihovnu vyměnit za vlastní sestavení (druhá povinnost LGPL),
# je v `docs/operations/third-party-licenses.md`. Hlídá to
# `apps/web/test/ci/license-obligations.test.ts`.
COPY --chown=root:root LICENSES /app/LICENSES
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=root:root docker/mlain /usr/local/bin/mlain
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/mlain

# Kontrola HOTOVÉ image, ne mezivrstvy. Načte nativní modul přesně tak, jak ho
# načte CLI za běhu, a zavolá ho.
#
# Fáze `node-builder` sice `@node-rs/argon2` ověřuje taky, jenže ověřovala ho
# v `/runtime-deps`, který se do runtime vrstvy zapomněl zkopírovat. Modul se
# tedy připravil, ověřil a zahodil, build byl zelený a kontejner skončil
# v restartové smyčce na `ERR_MODULE_NOT_FOUND` až při `mlain migrate`.
#
# Kontrola v té vrstvě, KDE SE VĚC POUŽÍVÁ, je jediná, která tuhle třídu chyby
# chytí. Ověření v mezivrstvě dokládá jen to, že mezivrstva byla v pořádku.
RUN node -e "const a = require('/app/node_modules/@node-rs/argon2'); const h = a.hashSync('kontrola'); if (!a.verifySync(h, 'kontrola')) { throw new Error('argon2 v runtime vrstvě nehashuje správně'); } console.log('argon2 v runtime vrstvě funguje');"

# Data se zapisují jen do /data, aplikační soubory jsou pro běžícího uživatele
# jen ke čtení. Kontejner tedy jde spustit s read-only rootfs (kritérium 8).
RUN mkdir -p /data/uploads /data/backups && chown -R 10001:10001 /data
VOLUME ["/data"]

# Health porty jsou rozdělené per proces SCHVÁLNĚ. Při MODE=all běží worker
# i sender jako potomci v jednom kontejneru se SDÍLENÝM prostředím, takže jedna
# společná proměnná HEALTH_PORT znamená, že druhý z nich spadne na obsazeném
# portu, a to hned ve výchozí konfiguraci MVP 0. Kritérium 8c.
# HOSTNAME=0.0.0.0 SE ODSUD NESMÍ SMAZAT, i když vypadá zbytečně.
#
# `server.js` z Next standalone se váže na `process.env.HOSTNAME || '0.0.0.0'`.
# Docker přitom do KAŽDÉHO kontejneru nastavuje `HOSTNAME` sám, a to na jeho ID.
# Next si to vezme jako adresu k navázání a poslouchá jedině na IP kontejneru.
#
# Zvenčí to funguje, protože mapování portu míří právě na tu IP, takže se vada
# neprojeví ničím, co by šlo vidět zvenku. Zevnitř ale loopback nikam nevede:
#
#   HOSTNAME=12fdfa58ad13
#   pres hostname kontejneru:  HTTP 200
#   pres loopback:             ECONNREFUSED
#
# Rozbije to všechna volání aplikace do vlastního API ze serverových akcí, tedy
# například dokončení průvodce prvním spuštěním. Jediná stopa je řádek ve
# startovacím logu, kterého si nikdo nevšimne:
#
#   - Local:  http://12fdfa58ad13:3000     (místo http://localhost:3000)
#
# Je to proměnná, kterou nikdo nehledá, protože ji nikdo nezapsal. Tenhle řádek
# ji přebíjí, aby se Next navázal na všechna rozhraní včetně loopbacku.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
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
