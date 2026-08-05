'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Alert } from '@mlain/ui/patterns/states';
import { sesRegion } from '@mlain/core/providers/ses/regions';

/**
 * V JAKÉM REGIONU ÚČET JE A CO V NĚM MÁ AMAZON OVĚŘENÉ.
 *
 * Tohle je odpověď na otázku, kterou obrazovka čtyři dny neuměla položit ani
 * zodpovědět. Zadavatel měl ověřené tři adresy v Severní Virginii, produkt
 * odesílal z Frankfurtu a doménu měl ověřenou v Irsku. Každá z těch tří pravd
 * byla sama o sobě správná a dohromady neodešla jediná zpráva.
 *
 * Zásada, kterou celý panel drží: `null` u počtu znamená „NEZJIŠŤOVALI JSME"
 * a mlčí se o něm. Nula znamená „ověřeno tu nemáte nic" a je to nejtvrdší
 * možná zpráva, protože v testovacím režimu pak neodejde ani zkušební e-mail
 * na vlastní adresu. Splést tyhle dva stavy je přesně ta chyba, kterou tenhle
 * panel má odstranit, ne zopakovat.
 */

export type RegionFacts = {
  region: string | null;
  identities: string[];
  /** `null` = nezjišťovali jsme. Nikdy se nevydává za nulu. */
  count: number | null;
  /** `true` = Amazon drží účet v testovacím režimu. `null` = nevíme. */
  sandbox: boolean | null;
};

/** Jméno regionu pro člověka. Neznámý kód se ukáže tak, jak je uložený. */
export function useRegionLabel(): (code: string) => string {
  const locale = useLocale();
  const cs = locale.startsWith('cs');
  return (code: string) => {
    const region = sesRegion(code);
    if (!region) return code;
    return `${cs ? region.cityCs : region.cityEn} (${region.code})`;
  };
}

/** Kolik ověřených identit se vypíše jmenovitě. Zbytek nese počet. */
const NAMED = 3;

export function ProviderRegionFacts({ facts, testId }: { facts: RegionFacts; testId: string }) {
  const t = useTranslations('campaigns.sending.regionFacts');
  const label = useRegionLabel();

  // Bez regionu se NETVRDÍ nic. Účet, který se ještě neověřoval, region ve stavu
  // nemá, a vymyslet ho z konfigurace by znamenalo tvrdit něco, co Amazon
  // nikdy nepotvrdil.
  if (facts.region === null || facts.region === '') return null;

  const regionLabel = label(facts.region);
  const named = facts.identities.slice(0, NAMED);
  const rest = (facts.count ?? named.length) - named.length;

  /*
   * HLASITÉ VAROVÁNÍ. Testovací režim BEZ jediné ověřené identity v tomhle
   * regionu znamená, že neodejde vůbec nic, ani zkušební zpráva na vlastní
   * adresu. Není to odrážka v seznamu poznámek, je to zeď, o kterou se uživatel
   * zastaví, a proto má vlastní hlášení, ne položku mezi ostatními.
   */
  const nothingVerified = facts.sandbox === true && facts.count === 0;

  return (
    <div className="flex flex-col gap-2" data-testid={testId} data-region={facts.region}>
      <p className="text-sm text-text-muted">
        <span>{t('inRegion', { region: regionLabel })}</span>{' '}
        {facts.count === null ? (
          // „Nevíme" se říká nahlas. Mlčení by se četlo jako „nic tu nemáte".
          <span data-testid={`${testId}-unknown`}>{t('identitiesUnknown')}</span>
        ) : facts.count === 0 ? (
          <span data-testid={`${testId}-none`}>{t('identitiesNone')}</span>
        ) : (
          <span data-testid={`${testId}-list`}>
            {rest > 0
              ? t('identitiesSomeMore', { list: named.join(', '), rest })
              : t('identitiesSome', { list: named.join(', ') })}
          </span>
        )}
      </p>

      {nothingVerified && (
        <Alert tone="error" title={t('nothingTitle')} data-testid={`${testId}-blocked`}>
          {t('nothingText', { region: regionLabel })}
        </Alert>
      )}
    </div>
  );
}
