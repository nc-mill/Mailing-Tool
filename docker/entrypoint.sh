#!/bin/sh
# Jediný vstupní bod image. Postup je z části 1, kapitoly 3.12.
#
#   1) validace konfigurace (zod), při chybě exit 78 a výpis VŠECH problémů naráz
#   2) vymazání klíčů AI providerů z prostředí
#   3) MIGRATE_ON_START=true a MODE in (web,all) -> mlain migrate
#   4) podle MODE spustit procesy
#
# Běží pod tini jako PID 1, takže reaping zombie procesů a předávání signálů
# řeší tini, ne tenhle skript.
set -eu

MODE="${MODE:-all}"

# --- 0) Doména pro trackovací odkazy -----------------------------------------
# Sender z ní staví odkazy /t/o/, /t/c/ a /u/. Konfigurace v Node si ji umí
# odvodit z APP_URL, jenže sender je binárka v Go a APP_URL nedostává
# (nález K7 plánu P09), takže je pro něj povinná. Bez ní se nespustí:
#
#   konfigurace je neplatná:
#     - TRACKING_DOMAIN: chybí. Sender z ní staví odkazy /t/o/, /t/c/ a /u/.
#
# Při MODE=all to znamená, že celý kontejner skončí v restartové smyčce,
# přestože web i worker naběhly. Naměřeno při stavbě zlaté cesty.
#
# Odvozuje se to TADY, ne v compose: Compose umí jen `${VAR:-výchozí}`, ne
# úpravu řetězce, a `${TRACKING_DOMAIN:-${APP_URL#*://}}` v něm skončí na
# „invalid interpolation format".
#
# Bere se CELÁ adresa VČETNĚ schématu, jen bez koncového lomítka. Přestože se
# proměnná jmenuje „doména", sender z ní skládá odkazy prostým spojením
# (`base() + "/t/o/" + token`), takže z holého hostu by vznikl řetězec, který
# v e-mailu není odkaz. Sender to sám kontroluje:
#
#   TRACKING_DOMAIN: "localhost:4600" není absolutní URL se schématem
#
# Obě strany, TypeScript i Go, jsou na tenhle tvar srovnané.
if [ -z "${TRACKING_DOMAIN:-}" ] && [ -n "${APP_URL:-}" ]; then
  TRACKING_DOMAIN="${APP_URL%/}"
  export TRACKING_DOMAIN
fi

# --- 1) Validace konfigurace -------------------------------------------------
# `mlain config check` vypíše všechny problémy naráz a vrátí 78 (kritéria 2 a 3).
if ! mlain config check; then
  exit 78
fi

# --- 2) Klíče AI providerů se mažou ------------------------------------------
# Vercel AI SDK i SDK providerů sáhnou tiše po proměnné prostředí, když se klíč
# nepředá explicitně. Projekt bez nakonfigurovaného klíče by tím začal utrácet
# peníze provozovatele a zjistilo by se to až na faktuře.
#
# VZOR, ne výčet: výčet zastará s každým novým providerem a selže tiše.
# Vzor *_API_KEY je bezpečný, protože žádná proměnná Mlain Maileru na _API_KEY
# nekončí; hlídá to test v packages/core (akceptační kritérium 7c).
#
# Na sender se mazání NEAPLIKUJE, ten s AI do styku nepřichází. Protože ale
# potomci při MODE=all dědí prostředí, maže se jednotně před spuštěním čehokoliv.
for VARIABLE in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
  case "$VARIABLE" in
    *_API_KEY) unset "$VARIABLE" || true ;;
  esac
done
# Výčet pro ty, které vzoru neodpovídají (tabulka v 3.12).
unset AWS_BEARER_TOKEN_BEDROCK || true
unset GOOGLE_APPLICATION_CREDENTIALS || true
unset GOOGLE_GENAI_USE_VERTEXAI || true
unset AZURE_OPENAI_ENDPOINT || true
unset OLLAMA_HOST || true
unset HF_TOKEN || true

# --- 3) Migrace --------------------------------------------------------------
# Migrace pouští jen web a all, aby při víc replikách neběžely z každého procesu.
# Runner se připojuje přes DATABASE_URL_MIGRATOR, ne přes DATABASE_URL:
# DATABASE_URL je role mlain_app, která schéma nevlastní a migrovat nemůže.
#
# EXIT 69 SE TOLERUJE. `mlain migrate` dodává až plán P03; do té doby vrací
# registr CLI exit 69 (EX_UNAVAILABLE, "příkaz existuje, ale nikdo nedodal jeho
# tělo"). Protože MIGRATE_ON_START je ve výchozím stavu true a skript běží pod
# `set -e`, ukončil by se kontejner hned při startu kódem 69 a akceptační
# kritérium 1 (odpověď 200 na /api/health/ready do 60 s) by nešlo splnit dřív
# než po P03. Každý JINÝ nenulový kód je fatální: 3 selhaná migrace,
# 4 přeskočená major verze, 5 schema_version_ahead, 75 timeout zámku.
if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  case "$MODE" in
    web|all)
      set +e
      mlain migrate
      MIGRATE_EXIT=$?
      set -e
      if [ "$MIGRATE_EXIT" -eq 69 ]; then
        echo "entrypoint: mlain migrate v tomhle buildu není implementovaný (exit 69, dodá plán P03). Pokračuji bez migrací." >&2
      elif [ "$MIGRATE_EXIT" -ne 0 ]; then
        echo "entrypoint: mlain migrate selhal s kódem ${MIGRATE_EXIT}, kontejner nestartuje." >&2
        exit "$MIGRATE_EXIT"
      fi
      ;;
  esac
fi

# --- 4) Spuštění podle MODE --------------------------------------------------
# ml-sender se volá JMÉNEM, ne absolutní cestou. /usr/local/bin je v PATH
# základní image, takže se v kontejneru chová stejně, a test si smí podstrčit
# vlastní binárku přes PATH, aniž by musel psát do /usr/local/bin.
case "$MODE" in
  web)
    exec node apps/web/server.js
    ;;
  worker)
    exec node apps/worker/dist/main.js
    ;;
  sender)
    exec ml-sender
    ;;
  all)
    # Tři potomci pod jedním PID 1. Žádný supervizor: restart je práce Dockeru.
    # Kdyby kontejner držel běh s jedním mrtvým procesem, healthcheck by lhal.
    #
    # BEZ `wait -n`. To je rozšíření bashe 4.3 a POSIX ho nemá: pod `dash`
    # skončí na `Illegal option -n`, pod bashem 3.2 na `invalid option`.
    # Skript se přitom spouští přes `sh`, tedy pod dashem na Ubuntu runneru
    # i pod bashem 3.2 na macOS, a do Alpine s BusyBox ash test nikdy nevstoupí.
    # Náhrada přes `kill -0` v cyklu taky nefunguje: `kill -0` uspěje i na
    # zombie procesu, tedy na potomkovi, který už skončil a čeká na `wait`.
    #
    # Řešení: každý potomek běží pod tenkým supervizorem, který si počká na svůj
    # proces a zapíše jeho exit kód do souboru. Hlavní skript čeká, až se objeví
    # první řádek.
    STATUS_DIR="$(mktemp -d)"
    trap 'rm -rf "$STATUS_DIR"' EXIT
    EXITS="$STATUS_DIR/exits"
    : > "$EXITS"

    supervise() {
      _name=$1
      shift
      "$@" &
      _pid=$!
      # PID skutečného procesu, ne supervizoru. Bez něj by SIGTERM došel jen
      # k supervizoru a node ani ml-sender by o vypnutí nevěděly.
      echo "$_pid" > "$STATUS_DIR/$_name.pid"
      # `wait` bez `|| _code=$?` by pod `set -e` shodilo celý supervizor dřív,
      # než stihne nenulový kód zapsat, a pád potomka by zmizel beze stopy.
      _code=0
      wait "$_pid" || _code=$?
      printf '%s %s\n' "$_name" "$_code" >> "$EXITS"
    }

    forward_term() {
      for _file in "$STATUS_DIR"/*.pid; do
        [ -f "$_file" ] || continue
        kill -TERM "$(cat "$_file")" 2>/dev/null || true
      done
    }

    supervise web    node apps/web/server.js &
    supervise worker node apps/worker/dist/main.js &
    supervise sender ml-sender &

    # Signál se předá potomkům, aby doběhli graceful shutdown.
    trap 'forward_term' TERM INT

    while [ ! -s "$EXITS" ]; do
      sleep 1
    done
    # Sekunda navíc na potomky, kteří skončili prakticky současně. Bez ní by
    # výsledný kód závisel na tom, který zápis vyhrál závod.
    sleep 1
    cp "$EXITS" "$STATUS_DIR/snapshot"

    # Kód kontejneru je kód prvního potomka, který skončil; když jich skončilo
    # víc naráz, vyhrává nenulový. Snapshot se bere PŘED forward_term, aby se
    # do výběru nedostal kód 143 od potomků, které jsme ukončili sami.
    FIRST_EXIT=0
    FIRST_SEEN=""
    while read -r _name _code; do
      [ -z "$FIRST_SEEN" ] && { FIRST_SEEN="$_name"; FIRST_EXIT="$_code"; }
      if [ "$_code" -ne 0 ]; then
        FIRST_EXIT="$_code"
        break
      fi
    done < "$STATUS_DIR/snapshot"

    forward_term
    wait 2>/dev/null || true
    exit "$FIRST_EXIT"
    ;;
  *)
    echo "MODE: neplatná hodnota \"$MODE\". Povolené jsou web, worker, sender, all." >&2
    exit 78
    ;;
esac
