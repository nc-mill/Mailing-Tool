'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Alert } from '@mlain/ui/patterns/states';
/*
 * Import míří na LISTOVÝ modul, ne na barel `@mlain/core/providers`.
 *
 * Barel vytahuje klienty AWS, šifrování konfigurace i vrstvu SMTP, tedy kód,
 * který patří výhradně na server. V komponentě s `'use client'` by se to celé
 * pokusilo dostat do prohlížeče. `ses/regions` je naopak čistá data a tři
 * funkce nad nimi, bez jediné závislosti.
 */
import { SES_REGIONS, sesRegion, SUGGESTED_SES_REGION } from '@mlain/core/providers/ses/regions';
import { SelectField } from '@/lib/forms/select-field';

/**
 * Výběr regionu Amazonu a upozornění, které k němu patří.
 *
 * PROČ VÝBĚR A NE VOLNÝ TEXT. Region se dřív psal rukou a pak zmizel do
 * šifrované konfigurace. Zadavatel si ověřoval adresy v konzoli přepnuté na
 * Severní Virginii, produkt odesílal z Frankfurtu a produkční přístup měl
 * v Irsku. Tři různé pravdy o jednom účtu, čtyři dny bez jediné odeslané
 * zprávy. Volný text nedokáže ani jednu z těch tří pravd pojmenovat.
 *
 * PROČ SE NIC NEPŘEDVYBÍRÁ. Nabídnout a předvybrat jsou dvě různé věci.
 * Předvyplněný Frankfurt vypadá jako odpověď a uživatel ho odklikne, aniž by
 * se šel podívat, kde má vlastně ověřeno. Výběr proto začíná prázdný a první
 * v nabídce stojí doporučený region s výslovným popiskem, že je to jen návrh.
 *
 * Seznam pochází z `packages/core/data/ses-regions.json`, kde je i zdroj
 * a datum ověření. Skládat ho tady znovu by znamenalo druhý zdroj pravdy.
 */

/**
 * Popisek jedné položky: `Irsko (eu-west-1)`.
 *
 * Jméno z konzole AWS (`Europe (Ireland)`) do popisku ZÁMĚRNĚ nepatří, i když
 * je to přesně ten údaj, který má uživatel spojit s tím, co vidí u Amazonu.
 * Naměřeno na skutečné obrazovce: s ním narostly položky natolik, že rozbalený
 * seznam přetekl přes okraj dialogu a překryl formulář pod ním. Jméno se proto
 * ukazuje k VYBRANÉMU regionu jedním řádkem pod výběrem, kde má místo a kde ho
 * uživatel čte ve chvíli, kdy ho potřebuje. Město i zkratka v položce zůstávají,
 * a to jsou zároveň obě hodnoty, podle kterých se region v konzoli vybírá.
 */
function optionLabel(code: string, city: string, t: ReturnType<typeof useTranslations>): string {
  return t('regionOption', { city, code });
}

export function RegionSelect({
  name,
  value,
  onChange,
  error,
}: {
  /** Jméno pole. Liší se mezi dialogem zakládání a úpravy, testy míří na něj. */
  name: string;
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
}) {
  const t = useTranslations('campaigns.sending.region');
  const locale = useLocale();
  const cs = locale.startsWith('cs');

  /*
   * Doporučený region stojí PRVNÍ a je označený. Řadit podle abecedy by
   * znamenalo začít Kapským Městem, což pro českého uživatele není nabídka,
   * ale bludiště. Zbytek drží pořadí z datového souboru: Evropa, pak svět.
   */
  const options = SES_REGIONS.map((region) => {
    const city = cs ? region.cityCs : region.cityEn;
    const base = optionLabel(region.code, city, t);
    if (region.code === SUGGESTED_SES_REGION)
      return { value: region.code, label: t('suggested', { label: base }) };
    // Region, který má účet ve výchozím stavu vypnutý, se pozná už v nabídce.
    // Vybrat ho jde, ale kdo si ho u Amazonu nezapnul, nedostane se v něm nikam.
    return { value: region.code, label: region.optIn ? t('optIn', { label: base }) : base };
  });

  /** Vybraný region. `null` znamená „ještě nevybráno" nebo region mimo seznam. */
  const chosen = value === '' ? null : sesRegion(value);

  /**
   * Uložený region, který v seznamu není. Stát se to může u účtu založeného
   * dřív nebo u regionu, který Amazon spustil a do dokumentace zatím nedal.
   * Hodnota se NEZAHAZUJE: přepsat uživateli region na prázdno by znamenalo
   * tvrdit, že žádný nemá, a při uložení by se mu účet rozbil.
   */
  const unknown = value !== '' && sesRegion(value) === null;
  const allOptions = unknown
    ? [{ value, label: t('unknownOption', { code: value }) }, ...options]
    : options;

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        name={name}
        label={t('label')}
        placeholder={t('placeholder')}
        options={allOptions}
        {...(value === '' ? {} : { defaultValue: value })}
        onSelected={onChange}
        {...(error === undefined ? {} : { errors: { [name]: [error] } })}
      />
      {/* Jméno z konzole AWS k vybranému regionu. Právě podle něj uživatel
          pozná, že se dívá do toho správného: v konzoli vpravo nahoře nestojí
          `eu-west-1`, ale `Europe (Ireland)`. */}
      {chosen && (
        <p className="text-sm text-text-muted" data-testid={`${name}-console-name`}>
          {t('consoleName', { awsName: chosen.awsName })}
          {chosen.optIn ? ` ${t('optInNote')}` : ''}
        </p>
      )}
      <RegionWarning />
    </div>
  );
}

/**
 * Co je u Amazonu na region vázané, a kde si ho uživatel v konzoli přečte.
 *
 * NENÍ to rozbalovací nápověda a nesmí jí být. Rozbalí ji jen ten, kdo už
 * tuší, že problém existuje, a přesně ten člověk ji nepotřebuje. Výčet je
 * jmenovitý, protože obecná věta „region musí sedět" nikomu neřekne, CO
 * přesně se rozejde, když nesedí.
 */
export function RegionWarning() {
  const t = useTranslations('campaigns.sending.region');
  const items = [
    'boundIdentities',
    'boundSandbox',
    'boundQuota',
    'boundConfigSet',
    'boundDkim',
  ] as const;

  return (
    <Alert tone="warning" title={t('warningTitle')} data-testid="region-warning">
      <span className="flex flex-col gap-2">
        <span>{t('warningIntro')}</span>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {items.map((item) => (
            <li key={item}>{t(item)}</li>
          ))}
        </ul>
        <span>{t('whereToFind')}</span>
      </span>
    </Alert>
  );
}

/**
 * Co se stane, když se region u HOTOVÉHO účtu přepne.
 *
 * Ukazuje se jen při skutečné změně, ne trvale: trvalé varování u pole, se
 * kterým uživatel nic nedělá, se po druhém otevření dialogu přestane číst.
 * Zadavatel právě přepnul `eu-central-1` na `eu-west-1` a přišel přitom
 * o konfigurační sadu, ověřené identity i DKIM záznamy, aniž by mu to kdokoli
 * řekl předem.
 */
export function RegionChangeWarning({ from, to }: { from: string; to: string }) {
  const t = useTranslations('campaigns.sending.region');
  const locale = useLocale();
  const cs = locale.startsWith('cs');
  const label = (code: string): string => {
    const region = sesRegion(code);
    if (!region) return code;
    return `${cs ? region.cityCs : region.cityEn} (${region.code})`;
  };
  const items = ['changeConfigSet', 'changeIdentities', 'changeDkim', 'changeSandbox'] as const;

  return (
    <Alert
      tone="warning"
      title={t('changeTitle', { from: label(from), to: label(to) })}
      data-testid="region-change-warning"
    >
      <span className="flex flex-col gap-2">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {items.map((item) => (
            <li key={item}>{t(item)}</li>
          ))}
        </ul>
        <span>{t('changeAfter')}</span>
      </span>
    </Alert>
  );
}
