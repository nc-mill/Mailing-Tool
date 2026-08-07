'use client';

import { useTranslations } from 'next-intl';

/**
 * JAK TO STOJÍ SE ŽÁDOSTÍ O PRODUKČNÍ PŘÍSTUP.
 *
 * Existuje proto, že `production_access === false` je na tuhle otázku
 * NEDOSTATEČNÁ odpověď. Znamená jen „účet je v testovacím režimu" a platí
 * stejně pro tři různé lidi:
 *
 *   * pro toho, kdo o přístup nikdy nepožádal,
 *   * pro toho, komu Amazon žádost právě posuzuje,
 *   * pro toho, komu ji Amazon zamítl.
 *
 * Dokud obrazovka rozdíl neznala, nabízela všem třem tentýž formulář a druhé
 * odeslání skončilo na `ConflictException` od Amazonu, u nás na kódu
 * `production_access_review_in_progress`. Uživatel se tedy dozvěděl, že žádost
 * už běží, teprve TÍM, že ji zkusil podat podruhé.
 *
 * Hodnoty jsou výčet `ReviewStatus` z AWS SDK: `PENDING`, `GRANTED`, `DENIED`,
 * `FAILED`. `null` znamená, že se účet o přístup nikdy neucházel, nebo že jsme
 * se Amazona ještě neptali.
 */

/**
 * Stavy, ve kterých se tlačítko „Požádat o produkční přístup" NENABÍZÍ.
 *
 * Bydlí tady vedle textů schválně: kdo přidá další stav, vidí na jedné
 * obrazovce jak jeho větu, tak rozhodnutí o formuláři. Ve dvou souborech by se
 * to rozešlo a vznikla by dvojice „tlačítko svítí, ale věta říká, že to nejde".
 */
export const PRODUCTION_ACCESS_REQUEST_HIDDEN = new Set(['PENDING', 'GRANTED']);

/** Překlad stavu na klíč v katalogu. Neznámý stav se NEVYMÝŠLÍ, mlčí se o něm. */
function messageKey(reviewStatus: string | null, sandbox: boolean | null): string | null {
  switch (reviewStatus) {
    case 'PENDING':
      return 'pending';
    case 'GRANTED':
      return 'granted';
    case 'DENIED':
      return 'denied';
    case 'FAILED':
      return 'failed';
    case null:
      /*
       * „O přístup jste zatím nežádali" dává smysl JEN u účtu, který v testovacím
       * režimu prokazatelně je. U `sandbox === null` jsme se stavu nikdy
       * nezeptali a u `false` účet přístup má, takže by ta věta v obou případech
       * tvrdila něco, co nevíme, respektive co neplatí.
       */
      return sandbox === true ? 'none' : null;
    default:
      // Amazon může výčet rozšířit. Neznámou hodnotu radši nekomentujeme, než
      // abychom ji přeložili na nejbližší známou a napsali nepravdu.
      return null;
  }
}

export function ProviderReviewStatus({
  reviewStatus,
  sandbox,
  testId,
}: {
  reviewStatus: string | null;
  sandbox: boolean | null;
  testId: string;
}) {
  const t = useTranslations('campaigns.sending.productionAccess.reviewStatus');
  const key = messageKey(reviewStatus, sandbox);
  if (key === null) return null;

  return (
    <p
      className="text-sm text-text-muted"
      data-testid={testId}
      data-review-status={reviewStatus ?? 'none'}
    >
      {t(key)}
    </p>
  );
}
