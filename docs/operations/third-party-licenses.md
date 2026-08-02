# Licence třetích stran

Tenhle dokument plní **podmínku distribuce**, ne formalitu. Bez něj a bez
přiloženého textu licence šíříme LGPL komponentu v rozporu s licencí.

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

Konkrétní a spustitelný postup, ne odkaz na cizí dokumentaci.

```bash
# 1. Sestav vlastní libvips a nainstaluj ho do image.
# 2. Řekni sharpu, aby použil systémovou knihovnu místo přibalené:
docker build --build-arg SHARP_FORCE_GLOBAL_LIBVIPS=1 -f docker/Dockerfile .
# 3. Ověř, že se nelinkuje přibalená kopie:
docker run --rm mlain:local node -e "console.log(require('sharp').versions)"
```

Ve výpisu třetího kroku musí u `vips` být verze tvého sestavení. Když tam je
verze z `@img/sharp-libvips-*`, výměna neproběhla a linkuje se dál přibalená
kopie.

## 4. Co produkt bez `sharp` ztratí

Kdyby se ho někdo rozhodl místo výměny vypustit:

- **extrakce značky z webu** (`brand_extractions`): načtení loga a barev z adresy,
- **generování variant obrázků**: zmenšeniny a převody nahraných obrázků.

Zbytek produktu funguje beze změny. Odesílání, kontakty, šablony, segmenty,
kampaně, tracking i reporty na `sharp` nezávisí.

## 5. Hlídač

Soulad tohohle dokumentu s `licenses.allow.json` a se soubory na disku hlídá
test `apps/web/test/ci/license-obligations.test.ts`. Neptá se plánu ani
dokumentace, porovnává skutečný obsah. Povinnost, kterou hlídá jen dobrá vůle,
se při první reorganizaci repozitáře ztratí.
