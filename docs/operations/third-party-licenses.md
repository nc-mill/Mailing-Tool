# Licence třetích stran

**K čemu to je:** dokument plní **podmínku distribuce** LGPL komponenty. Bez něj
a bez přiloženého textu licence šíříme `libvips` v rozporu s licencí.

Revize: 2026-08-06. Výjimky a data expirace ověřené proti `licenses.allow.json`,
cesty proti `docker/Dockerfile` a proti souborům na disku.

## 1. Komponenty pod copyleftem, které se s produktem šíří

| Balíček | Licence | Kde je | Výjimka |
|---|---|---|---|
| `@img/sharp-libvips-*` | LGPL-3.0-or-later | v linuxové produkční image, linkuje se dynamicky | `licenses.allow.json`, expirace **2027-08-01** |
| `@img/sharp-win32-*` | LGPL-3.0-or-later | jen ve vývojářské instalaci na Windows, do produkční image nevstupuje; tam je libvips slinkovaný staticky, takže je povinnost přísnější a zahrnuje umožnění relinkování | `licenses.allow.json`, expirace **2027-08-01** |
| `caniuse-lite` | CC-BY-4.0 | tabulka podpory funkcí v prohlížečích, kterou táhne browserslist pod Next.js. Licence dat, ne kódu, není to copyleft. Zdroj dat: [caniuse.com](https://caniuse.com), autor Alexis Deveria, licence [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). | `licenses.allow.json`, expirace **2027-08-01** |

Sám `sharp` je **Apache-2.0**. LGPL-3.0-or-later nese předkompilovaná nativní
knihovna `libvips` pod ním. Protože se v linuxové image linkuje dynamicky,
zůstává povinnost u distribuce té knihovny, ne u našeho kódu: musíme příjemci
dát text licence a umožnit mu knihovnu nahradit vlastní verzí.

Rozhodnutí zadavatele z 2026-08-01: `sharp` v produktu zůstává, evidence nález
N15.

## 2. Kde je plný text licence

| Kontext | Cesta |
|---|---|
| repozitář | `LICENSES/LGPL-3.0.txt` |
| běžící image | `/app/LICENSES/LGPL-3.0.txt` |

## 3. Jak knihovnu vyměnit za vlastní

> **Historie 2026-08-06.** Dřív tu stál týž příkaz
> `docker build --build-arg SHARP_FORCE_GLOBAL_LIBVIPS=1 …`, jenže
> `docker/Dockerfile` žádný `ARG SHARP_FORCE_GLOBAL_LIBVIPS` neměl. Nepřevzatý
> `--build-arg` Docker jen odvaruje na stderr a build doběhne s přibalenou
> knihovnou: výměna **tiše neproběhla a vypadalo to, že proběhla**. Chyběl taky
> `-t`, takže žádná `mlain:local` nevznikla a třetí krok by skončil na
> „unable to find image".
>
> Obojí je opravené. `ARG` i `ENV` jsou ve fázi `node-deps` před instalací
> závislostí a hlídá je test, který čte Dockerfile, ne tenhle dokument.

Proměnná `SHARP_FORCE_GLOBAL_LIBVIPS` je proměnná prostředí, kterou čte
**instalační skript balíčku sharp**, tedy se musí projevit ve chvíli
`pnpm install`. V Dockerfilu je to fáze `node-deps` a stojí tam takhle:

```dockerfile
# docker/Dockerfile, fáze node-deps, PŘED `pnpm install --frozen-lockfile`:
ARG SHARP_FORCE_GLOBAL_LIBVIPS=0
ENV SHARP_FORCE_GLOBAL_LIBVIPS=${SHARP_FORCE_GLOBAL_LIBVIPS}
```

Zbytek si musíš dodělat sám a Dockerfile ti k tomu upravit **musí**: vlastní
`libvips` se musí nainstalovat do fáze `node-deps` (v alpine základu vývojové
balíčky `vips-dev`, `pkgconf`, `build-base`) a totéž pak do fáze `runtime`, aby
se knihovna našla i za běhu. Samotný `--build-arg` jen řekne sharpu, ať
přibalenou kopii nepoužívá; knihovnu, na kterou se má linkovat, mu musíš dát.

```bash
# 1. Sestav a nainstaluj vlastní libvips do fází node-deps i runtime.
# 2. Postav image s vynucenou systémovou knihovnou. -t je povinné:
docker build --build-arg SHARP_FORCE_GLOBAL_LIBVIPS=1 -t mlain:local -f docker/Dockerfile .
# 3. Ověř, že se nelinkuje přibalená kopie:
docker run --rm --entrypoint node mlain:local -e "console.log(require('sharp').versions)"
```

`--entrypoint node` je nutný, protože `ENTRYPOINT` image spouští
`docker/entrypoint.sh`, ne `node`.

Ve výpisu třetího kroku musí u `vips` být verze tvého sestavení. Když tam je
verze z `@img/sharp-libvips-*`, výměna neproběhla a linkuje se dál přibalená
kopie. Tentýž údaj mimochodem vypisuje i stavba samotná, fáze `node-builder`
tiskne `sharp overen, verze libvips: …`.

## 4. Co produkt bez `sharp` ztratí

Kdyby se ho někdo rozhodl místo výměny vypustit:

- **extrakce značky z webu** (`brand_extractions`): načtení loga a barev z adresy,
- **generování variant obrázků**: zmenšeniny a převody nahraných obrázků.

Zbytek produktu funguje beze změny. Odesílání, kontakty, šablony, segmenty,
kampaně, tracking i reporty na `sharp` nezávisí.

## 5. Hlídač a co doopravdy hlídá

Test `apps/web/test/ci/license-obligations.test.ts` hlídá **distribuci textu
licence** a **skutečnou možnost výměny knihovny**:

1. `LICENSES/LGPL-3.0.txt` existuje, obsahuje řetězec
   `GNU LESSER GENERAL PUBLIC LICENSE` a má přes 5 000 znaků,
2. `docker/Dockerfile` obsahuje řetězec `LICENSES`, tedy text licence se do image
   kopíruje,
3. tenhle dokument pojmenuje komponentu `@img/sharp-libvips` i cestu
   `LICENSES/LGPL-3.0.txt`,
4. fáze `node-deps` v Dockerfilu deklaruje `ARG SHARP_FORCE_GLOBAL_LIBVIPS`
   s výchozí `0`, předává ho do prostředí přes `ENV`, a **obojí stojí před
   `pnpm install`**,
5. příkaz `docker build` v kapitole 3 předává právě ten `--build-arg` a má `-t`.

Body 4 a 5 se ptají na Dockerfile, ne na text téhle stránky. Dřív tu byla jen
kontrola, že se v dokumentu vyskytuje řetězec `SHARP_FORCE_GLOBAL_LIBVIPS`,
a proto svítila zeleně po celou dobu, kdy Dockerfile žádný takový `ARG` neměl.
Zelený test tvrdil splněnou licenční povinnost, která splněná nebyla. Kdo bude
kapitolu 3 přepisovat, ten řetězec kvůli testu nikde držet nemusí; test spadne
až tehdy, když přestane fungovat sama výměna.

