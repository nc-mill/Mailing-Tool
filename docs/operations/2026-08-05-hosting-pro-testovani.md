# Kde rozjet Mlain Mailer na internetu pro testování

**K čemu to je:** jednorázová rešerše hostingu pro testovací provoz. Není to
provozní runbook a nic z toho není objednané.

Zpracováno 5. 8. 2026. Zadání: testovací provoz na internetu, ne produkce pro zákazníky,
vlastní doména zatím není potřeba, cíl je zdarma nebo za opravdu málo.

> **Revize 2026-08-06.** Překontrolovaná byla **kapitola 2**, tedy to jediné, co
> se dá ověřit v repozitáři: limit paměti 2 GB, port 3000, PostgreSQL 18 s ICU
> `cs-CZ`, pět rolí v `docker/initdb/10-roles.sql` a fakt, že CI image nikam
> nepublikuje. Všechno sedí.
>
> **Ceny, limity poskytovatelů a bezplatné úrovně z kapitol 3 až 8 nikdo
> nepřekontroloval** a od 5. 8. 2026 se mohly změnit. Ber je jako stav
> k tomu dni, ne jako platný ceník. Kapitola 11 sama vyjmenovává, co se
> nepodařilo ověřit ani tehdy.

Ceny a parametry pocházejí ze dvou nezávislých rešerší z 5. 8. 2026. **U každého údaje,
který je z druhé ruky nebo neověřený, je to napsané.** Ceny se mění, před objednávkou
si je překontrolujte.

---

## 1. Odpověď na jednu větu

**Nejlevnější sestava bez kompromisů je VPS zhruba za 5 eur měsíčně** (Hetzner, 4 GB),
na něm Docker Compose a PostgreSQL ve vlastním kontejneru. Databáze je totiž to,
co u bezplatných nabídek padá.

**Trvale zdarma to jde na Oracle Cloud Always Free** (ARM, 2 jádra, 12 GB paměti),
ale za cenu dvou rizik: musíte si sestavit obraz pro ARM a Oracle si nečinné instance
bere zpátky a pravidla mění bez oznámení.

**Žádná bezplatná úroveň platforem typu Fly, Render, Railway nebo Koyeb tuhle aplikaci
neuběhne celou.** Buď mají 512 MB paměti, nebo kontejner uspávají, nebo neumí trvalý disk.

---

## 2. Co aplikace opravdu potřebuje

Ověřeno v repozitáři, ne odhadnuto.

| Požadavek | Detail | Kde je to vidět |
|---|---|---|
| Jeden Docker obraz | Web (Next.js), worker na úlohy na pozadí a odesílač v Go běží v jednom kontejneru (`MODE=all`), port 3000. Rozdělit je do tří kontejnerů jde overlayem `docker/compose.scale.yml`, pro testování to není potřeba | `docker/Dockerfile`, `docker/compose.yml` |
| Paměť aplikace | Limit **2 GB** | `docker/compose.yml`, `deploy.resources.limits.memory` |
| **Reálné minimum stroje** | **4 GB.** Ty 2 GB jsou jen aplikace, PostgreSQL běží vedle a má vlastní spotřebu, k tomu operační systém | odvozeno |
| PostgreSQL | **verze 18**, zakládaná s `--locale-provider=icu --icu-locale=cs-CZ` | `docker/compose.yml` |
| Databázové role | **Pět vlastních rolí** (`mlain_app`, `mlain_sender`, `mlain_backup`, `mlain_gdpr`, `mlain_maintenance`), zakládá je skript při inicializaci | `docker/initdb/10-roles.sql` |
| Řádková bezpečnost | RLS plus `SET LOCAL mlain.workspace_id`, na tom stojí oddělení projektů | migrace |
| Rozdělené tabulky | Partitioning u zpráv a událostí, na tom stojí retence | migrace |
| Trvalé úložiště | `/data` v kontejneru: nahrané soubory importů, přílohy | `docker/compose.yml` |
| Veřejná HTTPS adresa | Odkazy v e-mailech, potvrzování přihlášení, měření prokliků | funkce produktu |
| Odchozí pošta | SES nebo SMTP, **port 25 není potřeba** | konfigurace |

### Dvě věci, které se snadno přehlédnou

**Obraz se nikde nezveřejňuje.** `docker/compose.yml` se odkazuje na
`ghcr.io/nc-mill/mlain:1.0.0`, ale CI (`.github/workflows/ci.yml`, job `build-image`)
obraz jen **sestaví, otestuje a uloží jako přílohu běhu**. Žádný krok, který by ho poslal
do registru, tam není. **Ať zvolíte cokoli, obraz si musíte sestavit sami.**
Na Apple Silicon je to nativní stavba pro ARM, tedy rychlá a zadarmo.

**Stavba obrazu potřebuje víc paměti než běh.** Na 4GB stroji ji nedělejte, sestavte
obraz u sebe a na server ho jen přeneste. Na 8GB stroji už to projde.

---

## 3. Bezplatné servery

| Poskytovatel | Co dá | Paměť | Disk | Stačí? |
|---|---|---|---|---|
| **Oracle Cloud Always Free** (ARM Ampere A1) | 2 OCPU | **12 GB** | 200 GB | **Ano, s rezervou** |
| Oracle Always Free (AMD micro) | 2 instance | 1 GB každá | ze společných 200 GB | Ne |
| Google Cloud always free | 1× e2-micro, jen tři americké regiony | 1 GB | 30 GB | Ne |
| Google Cloud zkušební kredit | 300 USD na 90 dní | dle stroje | dle stroje | Ano, ale jen 90 dní |
| AWS | t4g.small zdarma **do 31. 12. 2026**, nové účty od 15. 7. 2025 dostávají 100 až 200 USD kreditu na 6 měsíců místo ročního free tieru | 2 GB | platí se zvlášť | Ne |

**Oracle k 15. 6. 2026 tiše zkrátil ARM z 4 jader a 24 GB na polovinu**, bez oznámení.
Účtům Always Free se instance nad limit pozastaví, ale nefakturuje se.

---

## 4. Placené VPS

Ceny bez DPH, pokud není uvedeno jinak. Kurz orientačně 25 Kč za euro.

| Plán | CPU | Paměť | Disk | Cena měsíčně | Poznámka |
|---|---|---|---|---|---|
| **Hetzner CX23** | 2 vCPU | 4 GB | 40 GB NVMe | **5,99 € včetně IPv4** (~150 Kč) | nejlevnější rozumná varianta |
| Hetzner CAX11 (ARM) | 2 vCPU | 4 GB | 40 GB NVMe | 6,49 € | |
| **Hetzner CAX21** (ARM) | 4 vCPU | 8 GB | 80 GB NVMe | **10,99 €** (~275 Kč) | pohodlná, obraz jde sestavit na stroji |
| Netcup VPS 500 G12 | 2 vCPU | 4 GB | 128 GB NVMe | 5,91 € **včetně DPH** | bez zřizovacího poplatku |
| Contabo Cloud VPS 4 | 4 vCPU | 8 GB | 100 GB SSD | 5,50 € **jen při závazku na 24 měsíců** | na testování nesmysl |
| OVHcloud VPS-1 | 2 vCPU | 4 GB | 40 GB NVMe | od 4,54 USD **při platbě na rok dopředu** | |
| IONOS VPS M+ | 4 vCPU | 4 GB | 120 GB NVMe | 3 € první tři měsíce, **pak 9 € plus 10 € zřizovací poplatek** | levné jen v prvním sloupci ceníku |
| vpsFree.cz | 8 jader | 4 GB | 120 GB | 300 Kč členský příspěvek | spolek, ne služba; VPS je kontejner, Docker uvnitř má svá specifika |

**Hetzner 15. 6. 2026 zdražil** ARM i Intel řady zhruba o 30 %. Starší objednávky si drží
původní cenu.

---

## 5. Platformy, kde běží kontejner

| Platforma | Bezplatná úroveň | Uspává kontejner? | Trvalý disk | Cena pro tuhle aplikaci |
|---|---|---|---|---|
| **Fly.io** | **Zrušena.** Zbyl jen zkušební kredit | Ne (volitelně) | Ano, 0,15 $/GB | ~12,20 $ měsíčně |
| **Railway** | 0,5 GB paměti, na 2 GB nestačí | Ne | Ano, do 5 GB na Hobby | ~20 $ měsíčně, účtuje **skutečnou** spotřebu |
| **Render** | 512 MB, **usíná po 15 minutách**, trvalý disk na free vůbec nejde | Free ano | Jen na placených | 28 $ a výš |
| **Koyeb** | 512 MB, svazky až od plánu za 29 $ | Free ano | Od Pro | 29 $ a výš |
| **Northflank** | **Developer Sandbox výslovně bez uspávání**, 2 služby a 1 databáze | Ne | Ano | 0 $, ale **kolik dá paměti se nepodařilo zjistit** |
| **Google Cloud Run** | Ano, ale trvale běžící instance stojí ~75 $ | Scale-to-zero je výchozí | **Ne blokové úložiště**, jen GCS přes FUSE bez zámků souborů | nevhodné |
| **Azure Container Apps** | Ano, ale trvale běžící ~72 $ | Ano | Přes Azure Files, neověřeno | nevhodné |
| **Sliplane** | Ne, jen 48hodinové demo | Ne | Ano | 17,80 € za server, na něm neomezeně kontejnerů |
| **Hetzner nebo Oracle + Dokploy** | podle stroje | Ne | Ano | **4,50 až 5 €, nebo nula** |

**Pozor na uspávání.** Aplikace má úlohy na pozadí, které musí běžet pořád: rozesílání,
přepočty, retence, plánované kampaně. Platforma, která kontejner při nečinnosti uspí,
tyhle úlohy zastaví a projeví se to jako „nic se neděje", ne jako chyba.

---

## 6. Hostované PostgreSQL: čtyři kontroly

Tohle je nejdůležitější tabulka celého dokumentu. Právě tady bezplatné nabídky padají.

| Poskytovatel | Verze | Vlastní role | RLS | Partitioning | ICU `cs-CZ` | Free limity |
|---|---|---|---|---|---|---|
| **Neon** | **18** | Ano, ale **jen přes SQL** | Ano, s pastí níž | Ano | **Ano, dokumentováno** | 0,5 GB, 100 CU-h, **uspává po 5 minutách a nejde vypnout** |
| **Supabase** | 17, **18 zatím ne** | Ano | Ano | Ano | ICU řazení ano, **vlastní databáze s ICU nejistá** | 500 MB, **projekt se po 7 dnech nečinnosti uspí**, přímé připojení jen po IPv6 |
| **Aiven** | **neověřeno** | Ano | nedokumentováno | nedokumentováno | **neověřeno** | 1 GB, **max 20 spojení, bez poolingu** |
| **Render Postgres** | neověřeno | – | – | – | – | **free databáze vyprší 30 dní po založení** |
| **Koyeb Postgres** | neověřeno | – | – | – | – | **jen 5 hodin výpočtu měsíčně** |
| **Fly Managed Postgres** | **16** | **Ne**, žádný superuser | Ano | Ano | Nepravděpodobné | 38 $ měsíčně |
| **Railway Postgres** | dle obrazu | Ano, plný superuser | Ano | Ano | Ano | není zdarma |
| **Vlastní PG 18 v kontejneru** | 18 | Ano | Ano | Ano | Ano | zdarma nad rámec stroje |

### Tři nástrahy

**Neon obchází řádkovou bezpečnost.** Role založené přes konzoli, CLI nebo API dostanou
členství v `neon_superuser`, který má u novějších projektů právo **obcházet RLS**. Kdyby
se aplikace připojovala takovou rolí, oddělení projektů by tiše přestalo platit.
Aplikační role je nutné zakládat **přes SQL**, ne přes konzoli. U nástroje, kde je RLS
základ oddělení zákazníků, je to zásadní.

**Neon vyčerpá bezplatný limit kolem dvacátého v měsíci.** Minimální výpočet je 0,25 CU,
měsíc má 730 hodin, tedy zhruba 182 CU-h proti limitu 100. Worker, který se pravidelně
ptá databáze, ji neuspí. (Výpočet je odvozený z dokumentovaných čísel, ne citace.)

**Aiven má strop 20 spojení bez poolingu.** Webová aplikace, worker a odesílač se do
toho vejdou jen s poolerem, a ten bezplatný plán nemá.

---

## 7. HTTPS bez vlastní domény

| Řešení | Důvěryhodný certifikát | Stabilní adresa | Vydrží delší testování? |
|---|---|---|---|
| **DuckDNS + Let's Encrypt** | **Ano** | Ano, `neco.duckdns.org` | **Ano.** Doména je na seznamu veřejných přípon, takže má vaše subdoména vlastní limit vydávání certifikátů |
| **Tailscale Funnel** | Ano | Ano, `stroj.tailnet.ts.net` | Ano. Nepotřebuje otevřené porty, ale jen porty 443, 8443 a 10000 |
| sslip.io, nip.io | Ano, ale nespolehlivě | Ano | **Ne.** Sdílejí jeden limit Let's Encrypt pro celou doménu a ten byl v únoru 2026 vyčerpaný |
| Cloudflare quick tunnel | Ano | **Ne**, adresa se mění při každém restartu | Ne |
| Cloudflare named tunnel | Ano | Ano | Ano, ale **vyžaduje vlastní doménu** |
| ngrok zdarma | Ano | Ano | **Ne.** 1 GB přenosu měsíčně a **varovná mezistránka pro návštěvníky**, což rozbije měření prokliků |

**Doporučení: DuckDNS a Let's Encrypt.**

---

## 8. Nástroje pro nasazení na vlastní stroj

| Nástroj | Cena | Spotřeba paměti v klidu | Poznámka |
|---|---|---|---|
| **Dokploy** | Zdarma, open source | **~350 MB** | Umí Compose, svazky, zálohy na S3. Nejlehčí |
| Coolify | Zdarma self-hosted | 500 až 700 MB | Nejvíc funkcí, nejlepší rozhraní |
| CapRover | Zdarma | nejmenší | **Compose podporuje jen omezeně** |
| Dokku | Zdarma | nejmenší | Jen příkazová řádka |

Na 4GB stroji je 350 MB proti 700 MB rozdíl, který stojí za zvážení. Nic z toho ale
nepotřebujete: `docker compose up` funguje taky.

---

## 9. Doporučení

### Varianta A: zdarma, s riziky

**Oracle Cloud Always Free, ARM 2 jádra a 12 GB, region Frankfurt.**
K tomu DuckDNS a Caddy nebo nginx s Let's Encrypt, PostgreSQL 18 ve vlastním kontejneru.

- Cena **0 Kč trvale**.
- Dvanáct gigabajtů je pro tuhle aplikaci luxus, 200 GB disku pokryje importy i přílohy.
- **Musíte sestavit obraz pro ARM.** Na Macu s Apple Silicon je to nativní.
- Rizika: ARM kapacita bývá nedostupná (Frankfurt lépe než americké regiony), Oracle
  si nečinné instance bere zpátky a v červnu zkrátil limity bez oznámení. Mějte zálohy
  mimo Oracle.
- Chce platební kartu k ověření totožnosti.

### Varianta B: placená jistota

**Hetzner CX23, 4 GB, 5,99 € měsíčně včetně IPv4** (~150 Kč), Docker Compose, DuckDNS.

- Bere se do minuty, x86 znamená obraz beze změn.
- Odpadá riziko, že poskytovatel něco tiše změní.
- Obraz sestavte u sebe, na 4 GB by stavba neprošla. Nebo si vezměte CAX21 s 8 GB
  za 10,99 € a stavějte přímo na stroji.

### Co nedoporučuju

**Platformy s bezplatnou úrovní** (Fly, Render, Railway, Koyeb). Buď mají 512 MB, nebo
uspávají kontejner, nebo neumí trvalý disk. Placené varianty vyjdou na 12 až 29 dolarů,
tedy dráž než VPS, který zvládne všechno.

**Cloud Run a Azure Container Apps.** Trvale běžící kontejner u nich stojí 70 až 75 dolarů
měsíčně a Cloud Run neumí blokové trvalé úložiště, jen objektové přes FUSE bez zámků
souborů, což je pro nahrané soubory importů nebezpečné.

**Hostované databáze zdarma.** Neon je nejblíž (umí PG 18 i ICU), ale obchází RLS
u rolí založených přes konzoli a bezplatný limit nestačí na trvalý provoz. Vlastní
PostgreSQL v kontejneru je jednodušší a projde všemi čtyřmi kontrolami.

---

## 10. Na co si dát pozor

1. **Odkazy v e-mailech povedou na `neco.duckdns.org`.** Antispamové filtry takovým
   doménám nevěří, takže část testovacích zpráv skončí ve spamu. **Na testování rozesílání
   to nevadí a není to vada nástroje.** Na cokoli reálnějšího si pořiďte doménu za pár
   desítek korun ročně.
2. **Obraz si musíte sestavit sami**, CI ho nikam nepublikuje.
3. **PostgreSQL nechte inicializovat čistě**, nepřenášejte hotový datový adresář mezi
   architekturami. Role a RLS zakládá inicializační skript při prvním startu.
4. **Pozor na cestu svazku PostgreSQL 18**: `/var/lib/postgresql`, ne
   `/var/lib/postgresql/data`. Špatná cesta není chyba, na které by kontejner spadl,
   databáze se založí do dočasného svazku, všechno vypadá, že běží, a po prvním
   `docker compose down` jsou data pryč. Je to v `compose.yml` popsané.
5. **Přenos dat nikoho neomezí**: Hetzner 20 TB, Oracle 10 TB měsíčně.
6. **Kartu chce Oracle, Google i AWS**, byť jen k ověření.

---

## 11. Co se nepodařilo ověřit

Tohle si před rozhodnutím zkontrolujte, obě rešerše to přiznaly samy.

- **Oficiální ceník Hetzneru** se nepodařilo načíst, parametry plánů jsou ze
  sekundárního zdroje. Ceny jsou z oficiální stránky o úpravě cen.
- **Stránky Oracle** vracely přesměrovací smyčku nebo odmítnutí. Údaj 2 jádra a 12 GB
  je shodně ze tří nezávislých článků z června a července 2026, ne z první ruky.
- **Kolik paměti dává Northflank** ve free Developer Sandboxu na jednu službu. Nejmenší
  placený plán má 256 MB, takže 2GB aplikace se tam nejspíš nevejde. Nutno ověřit
  registrací.
- **Jestli Aiven dovolí ICU locale** a **jakou verzi PostgreSQL na free plánu dává.**
- **Jestli je v Neonu skutečně české ICU řazení** a v jakém tvaru se zapisuje.
  Aplikace zakládá databázi s `ICU_LOCALE 'cs-CZ'`, Neon v příkladech používá tvar
  `xx-x-icu`. Může být potřeba drobná úprava zakládacího skriptu.
- **Ceník Render Postgres** (stránky vracely 404), údaje jsou ze sekundárních zdrojů.
- **Contabo při měsíčním závazku**, zdroje si protiřečí.
- **Kurz koruny k euru** nebyl ověřován, korunové částky jsou orientační.

---

## 12. Nejrychlejší cesta, kdybyste chtěl začít hned

1. Sestavit obraz u sebe (`docker build -f docker/Dockerfile -t mlain:test .`),
   na Macu pro ARM, na Oracle to sedne.
2. Založit stroj: Oracle Always Free ARM ve Frankfurtu, nebo Hetzner CX23.
3. Zaregistrovat subdoménu na DuckDNS a nasměrovat ji na adresu stroje.
4. Přenést obraz na stroj a spustit `docker compose --profile bundled up -d`,
   tedy s PostgreSQL v balíku.
5. Před sebe postavit Caddy, který si sám vyřídí certifikát od Let's Encrypt.
6. Nastavit `APP_URL` na tu adresu s `https://`, jinak nebudou fungovat odkazy
   v e-mailech ani měření prokliků.
