#!/usr/bin/env bash
# Hlídač počtu databázových kontejnerů během paralelní práce.
#
# Testy proti reálné databázi startují kontejnery. Když si každý testovací
# soubor vezme vlastní, naroste jich při paralelním běhu několik desítek
# a stroj se udusí: naměřeno 74 kontejnerů a zátěž 29, série testů přestala
# doběhnout a zvenčí to vypadalo, že se zastavila práce.
#
# Skript nic nemaže sám. Jen hlásí, když počet přeroste práh, protože
# automatické maskání běžícího testu je horší než pomalý běh.
PRAH=${1:-6}
while true; do
  POCET=$(docker ps -q | wc -l | tr -d ' ')
  ZATEZ=$(uptime | sed 's/.*averages*: *//' | awk '{print $1}')
  if [ "$POCET" -gt "$PRAH" ]; then
    echo "VAROVANI: $POCET kontejneru (prah $PRAH), zatez $ZATEZ"
    docker ps --format '  {{.Names}} {{.Status}}' | head -12
  fi
  sleep 20
done
