/**
 * Výchozí režim potvrzení přihlášení pro nově zakládané seznamy.
 *
 * Zadavatel zvolil variantu s vyšší konverzí (jedno kliknutí), ale s podmínkou, že potvrzení
 * provádí vždy POST, nikdy GET, protože firemní bezpečnostní skenery odkazy v e-mailech
 * samy proklikávají. V režimu 'one_step' proto stránka formulář odešle sama skriptem;
 * bez JavaScriptu zůstane tlačítko. Viz ROZHODNUTI-PRO-ZADAVATELE.md, kapitola 3c.
 *
 * Výchozí hodnota sloupce lists.confirmation_mode v DDL je 'two_step' a vlastní ji P03.
 * Je to pojistka pro zápis mimo doménovou vrstvu, ne rozpor.
 */
export const DEFAULT_CONFIRMATION_MODE = 'one_step' as const;

/** Platnost potvrzovacího odkazu double opt-in v hodinách. */
export const DEFAULT_CONFIRMATION_TTL_HOURS = 168;

/** Kolikrát nejvýš se smí potvrzovací e-mail poslat znovu za 24 hodin. */
export const DEFAULT_CONFIRMATION_MAX_RESENDS = 3;

/** Nejkratší odstup mezi dvěma potvrzovacími e-maily na tentýž kontakt a seznam. */
export const CONFIRMATION_RESEND_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Placeholder adresy po anonymizaci podle článku 17. Jednotný napříč částmi, viz požadavek 4.14. */
export function erasedEmail(contactId: string): string {
  return `erased+${contactId}@erased.invalid`;
}

/** Kolik dní musí uplynout od tvrdého odrazu, než ho jde odblokovat. */
export const HARD_BOUNCE_REMOVAL_MIN_DAYS = 30;

/** Kolik dní má měkce smazaný kontakt na obnovu, než ho retence anonymizuje. */
export const SOFT_DELETE_RESTORE_DAYS = 30;

/** Velikosti dávek u hromadných operací. */
export const BULK_BATCH_SIZE = 5000;
export const ATTRIBUTE_STRIP_BATCH_SIZE = 10000;
export const GREETING_RECOMPUTE_BATCH_SIZE = 10000;
export const REFINGERPRINT_BATCH_SIZE = 10000;

/** Nad kolik kontaktů se operace nad skupinou fronty oslovení přesune do jobu. */
export const VOCATIVE_REVIEW_SYNC_LIMIT = 5000;

/**
 * Strop ruční práce u kontroly oslovení. Nad kterýkoliv z nich rozhraní nabídne
 * jako doporučenou volbu "u nejistých kontaktů použít neutrální oslovení".
 * Rozhodnutí zadavatele: "Když nejisté případy překročí 100 skupin nebo 10 % importu."
 */
export const VOCATIVE_REVIEW_GROUP_SOFT_LIMIT = 100;
export const VOCATIVE_REVIEW_RATIO_SOFT_LIMIT = 0.1;
