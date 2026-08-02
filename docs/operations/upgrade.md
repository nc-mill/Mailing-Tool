# Upgrade instalace

Dvě cesty. Vyber podle toho, kolik dat máš a jak moc si můžeš dovolit výpadek.

## Jednoduchá cesta

Pro malé instalace a pro vývoj.

```bash
docker compose pull
docker compose up -d
```

Migrace se aplikují při startu (`MIGRATE_ON_START`), runner drží advisory lock,
takže i při víc instancích migruje právě jedna. Když migrace spadne, kontejner
nenaběhne a `/api/health/ready` nevrátí 200.

## Opatrná cesta

Pro produkci. `mlain upgrade` udělá zálohu **před** migrací, takže je kam se
vrátit.

```bash
# 1. Zastav worker a sender RUČNĚ.
docker compose stop worker sender

# 2. Spusť upgrade.
docker compose exec app mlain upgrade

# 3. Spusť procesy zpět.
docker compose start worker sender

# 4. Ověř.
docker compose exec app mlain doctor
```

### `mlain upgrade` procesy nezastavuje ani nespouští

Je to vědomá odchylka od kapitoly 3.14 specifikace a stojí za ní bezpečnost, ne
lenost.

Aby příkaz uvnitř kontejneru zastavil jiný kontejner, potřeboval by **docker
socket namontovaný dovnitř**. Docker socket uvnitř kontejneru je fakticky root
na hostiteli: kdokoliv, kdo se do kontejneru dostane, umí spustit privilegovaný
kontejner s namontovaným kořenovým svazkem. Aplikační kontejner přitom běží
`read_only: true`, pod uživatelem 10001 a s `no-new-privileges`. Socket dovnitř
by celý ten model zahodil kvůli jediné pohodlné funkci.

Co `mlain upgrade` místo toho dělá:

1. **preflight**: přes `pg_stat_activity` ověří, že worker ani sender neběží, a
   když běží, skončí nenulově a řekne který,
2. **záloha**: spustí totéž co `mlain backup`,
3. **migrace**: pustí migrační runner,
4. **readiness**: ověří shodu verze schématu,
5. **výpis**: vypíše přesné příkazy na návrat procesů.

Zastavení a spuštění procesů je tedy na tobě a runbook to říká nahlas, aby to
nebylo překvapení uprostřed odstávky.

## Když upgrade spadne

| Kde | Co udělat |
|---|---|
| preflight hlásí běžící proces | zastav ho a zopakuj; sender uprostřed dávky by po migraci psal do starého schématu |
| migrace | obnov ze zálohy, kterou upgrade právě udělal, a nahlas chybu; migrace jsou v transakci, ale schéma po částečném běhu neověřuj odhadem |
| readiness | image a schéma se rozešly, zkontroluj, že běží ta verze image, kterou jsi chtěl |

Exit kód 4 znamená **přeskočenou major verzi**: mezi tvojí a cílovou verzí je
vydání, přes které se musí projít. Kód 5 je `schema_version_ahead`, tedy schéma
z novější aplikace, než je spuštěná image.
