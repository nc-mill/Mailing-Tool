import data from '../../../data/ses-regions.json';

/**
 * Regiony, ve kterých Amazon SES OPRAVDU je.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Region se dřív zadával jako volný text a pak zmizel
 * do šifrované konfigurace. U Amazonu je přitom na region vázané úplně všechno:
 * ověřené identity, testovací režim, denní limit, konfigurační sada i DKIM
 * záznamy domény. Zadavatel měl v konzoli otevřenou Severní Virginii, produkt
 * odesílal z Frankfurtu a produkční přístup měl v Irsku. Tři různé pravdy
 * o jednom účtu, nikde nebylo napsané, které se týká čeho, a čtyři dny neodešla
 * jediná zpráva.
 *
 * SEZNAM NENÍ Z PAMĚTI. Je opsaný z tabulky „Service API endpoints" na stránce
 * `docs.aws.amazon.com/general/latest/gr/ses.html` a zkontrolovaný proti souboru
 * `endpoints.json` z botocore, tedy proti tomu, co používají oficiální SDK.
 * Zdroj i datum ověření jsou zapsané v `packages/core/data/ses-regions.json`,
 * stejně jako je má `dns-providers.json`.
 *
 * CO V SEZNAMU SCHVÁLNĚ NENÍ. Strojová tabulka služeb AWS
 * (`api.regional-table.region-services.aws.a2z.com`) hlásí u SES o šest regionů
 * víc, jenže jejich endpoint `email.<region>.amazonaws.com` se ani nepřeloží
 * (ověřeno DNS dotazem u `ap-east-1`, `ap-east-2`, `ap-southeast-4`,
 * `ap-southeast-6`, `ap-southeast-7` a `mx-central-1`). Nabídnout region, ve
 * kterém služba není, znamená vyrobit tutéž vadu znovu, jen s naším podpisem.
 */

export type SesRegion = {
  /** Kód regionu tak, jak ho čeká SDK i konfigurace: `eu-west-1`. */
  code: string;
  /** Jméno, které stojí v konzoli AWS vpravo nahoře: `Europe (Ireland)`. */
  awsName: string;
  cityCs: string;
  cityEn: string;
  /**
   * Region, který má účet u Amazonu VYPNUTÝ, dokud si ho někdo nezapne.
   * Vybrat ho jde, ale bez zapnutí v nastavení účtu na něm nic neběží.
   */
  optIn: boolean;
  /** Má region i SMTP bránu SES. Naše odesílání ji nepoužívá, uživatel se na ni ptá. */
  smtp: boolean;
};

const parsed = data as {
  source: string;
  optInSource: string;
  verifiedAt: string;
  regions: SesRegion[];
};

/** Pořadí je věcné, ne abecední: nejdřív Evropa, pak zbytek světa. */
export const SES_REGIONS: readonly SesRegion[] = parsed.regions;

/** Odkud seznam pochází a k jakému datu byl ověřený. Patří na obrazovku, ne do hlavy. */
export const SES_REGIONS_SOURCE = parsed.source;
export const SES_REGIONS_OPT_IN_SOURCE = parsed.optInSource;
export const SES_REGIONS_VERIFIED_AT = parsed.verifiedAt;

/**
 * Region, který nabízíme jako první volbu. NENÍ to předvybraná hodnota:
 * dialog nechává výběr prázdný schválně, protože tiše předvyplněný Frankfurt
 * je přesně to, co uživatele stálo čtyři dny. Nabídnout a předvybrat jsou
 * dvě různé věci.
 */
export const SUGGESTED_SES_REGION = 'eu-central-1';

const BY_CODE = new Map(SES_REGIONS.map((r) => [r.code, r]));

export function sesRegion(code: string): SesRegion | null {
  return BY_CODE.get(code) ?? null;
}

export function isKnownSesRegion(code: string): boolean {
  return BY_CODE.has(code);
}

/**
 * Popis regionu pro člověka: `Irsko (eu-west-1)`.
 *
 * Neznámý kód se vrací TAK, JAK JE. Účet založený dřív může mít v konfiguraci
 * region, který v seznamu není (třeba `eu-south-2`, který odpovídá, ale
 * v dokumentaci uvedený není), a přepsat mu ho na prázdno by znamenalo tvrdit,
 * že žádný region nemá.
 */
export function sesRegionLabel(code: string, locale: 'cs' | 'en' = 'cs'): string {
  const region = sesRegion(code);
  if (!region) return code;
  return `${locale === 'cs' ? region.cityCs : region.cityEn} (${region.code})`;
}
