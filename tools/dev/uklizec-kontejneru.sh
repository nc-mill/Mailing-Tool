#!/usr/bin/env bash
# Automatický úklid databázových kontejnerů z testů.
#
# Testy proti reálné databázi si startují kontejnery. Když jich naráz naroste
# příliš, stroj se udusí: naměřeno 74 kontejnerů a zátěž 30, série testů
# přestala doběhnout a zvenčí to vypadalo, že se zastavila práce.
#
# Skript drží počet pod stropem tak, že ruší NEJSTARŠÍ anonymní kontejnery.
# Nejstarší schválně: nejnověji nastartovaný patří běhu, který právě začal,
# zatímco ten nejstarší nejspíš zbyl po běhu, který už někdo zabil.
#
# POJMENOVANÉ kontejnery se nikdy neruší. Jsou to `mlain-dev-pg` (vývojová
# databáze, na které běží aplikace) a `mlain-test-pg` (sdílený kontejner
# testů). Pojmenování je tu jediná ochrana, takže kdo si kontejner pojmenuje,
# ten si ho ochrání.
STROP=${1:-8}
while true; do
  ANONYMNI=$(docker ps --filter ancestor=postgres:18-alpine --format "{{.ID}} {{.Names}} {{.CreatedAt}}" 2>/dev/null \
    | grep -v -E "mlain-dev-pg|mlain-test-pg" || true)
  POCET=$(echo "$ANONYMNI" | grep -c . || true)
  if [ "${POCET:-0}" -gt "$STROP" ]; then
    PRESAH=$((POCET - STROP))
    # `docker ps` řadí od nejnovějšího, takže nejstarší jsou na konci.
    echo "$ANONYMNI" | tail -n "$PRESAH" | awk '{print $1}' | xargs -r docker rm -f > /dev/null 2>&1
    echo "uklizeno $PRESAH kontejneru, zustava $STROP"
  fi
  sleep 15
done
