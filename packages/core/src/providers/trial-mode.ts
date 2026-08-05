import { TRIAL_MAX_VERIFIED_ADDRESSES } from '../campaigns/constants';

export type TrialSettings = {
  trial_mode?: boolean;
  trial_verified?: Array<{ email: string; verified_at: string | null }>;
};

/**
 * Nastavení, ve kterém už `trial_mode` NENÍ nepovinné.
 *
 * Existuje kvůli jedné pasti. Uložená hodnota `trial_mode` chybí u každého čerstvého
 * projektu a `resolveTrialMode` z ní dělá ZAPNUTO, dokud není ověřená doména. Kdyby
 * brána brala syrové `TrialSettings`, chybějící klíč by se přečetl jako „vypnuto"
 * a zkušební režim by u nového projektu nechránil právě tam, kde chrání nejvíc.
 *
 * Typ je proto povinný na vstupu materializace: kdo bránu volá, musí hodnotu nejdřív
 * rozhodnout přes `resolveTrialSettings`, jinak se to NEZKOMPILUJE.
 */
export type ResolvedTrialSettings = TrialSettings & { trial_mode: boolean };

/**
 * Rozhodne platnou hodnotu přepínače.
 *
 * Výchozí hodnota je ZAPNUTO, dokud projekt nemá ověřenou doménu. Jakmile se uživatel
 * vyjádří, rozhoduje jeho hodnota. Je to táž úvaha, na které stojí `resolveTrialMode`
 * v aplikační vrstvě; ta ji odsud volá, aby pravidlo nebylo na dvou místech.
 *
 * DRUHÝ DŮVOD, PROČ ZAPNOUT: testovací režim u Amazonu (`providerSandbox`).
 *
 * Amazon v testovacím režimu doručí VÝHRADNĚ na adresy ověřené přímo u něj.
 * Kampaň na kohokoli jiného odmítne. Dokud se přepínač řídil jen ověřenou
 * doménou, mohl vzniknout přesně ten stav, který má tenhle projekt: doména
 * ověřená, tedy zkušební režim vypnutý, a účet přitom u Amazonu v testovacím
 * režimu. Materializace pak vyrobila zprávy pro celé publikum a Amazon je
 * odmítal jednu po druhé.
 *
 * Se zapnutým režimem se z adres mimo seznam stane `skipped` s důvodem
 * `trial_not_verified` ještě před odesláním. Je to VIDĚT v rozpadu kampaně,
 * takže se nikomu nic tiše neztratí, a odeslání na vlastní ověřené adresy
 * přitom funguje dál.
 *
 * `providerSandbox` je nepovinný a `undefined` znamená „nevíme". Nevědomost
 * režim nezapíná: tvrdit uživateli omezení, které jsme si nepřečetli, je táž
 * chyba jako mlčet o tom, které jsme si přečetli.
 */
export function resolveTrialSettings(
  settings: TrialSettings,
  input: { hasVerifiedDomain: boolean; providerSandbox?: boolean | undefined },
): ResolvedTrialSettings {
  return {
    ...settings,
    trial_mode: settings.trial_mode ?? (!input.hasVerifiedDomain || input.providerSandbox === true),
  };
}

/**
 * Zkušební režim se ukládá do workspaces.settings.campaigns, nezakládá tabulku
 * (rozhodnutí D15): je to nejvýše deset adres a jeden přepínač na projekt.
 */
export function canSendInTrial(email: string, settings: TrialSettings): boolean {
  if (!settings.trial_mode) return true;
  return (settings.trial_verified ?? []).some(
    (a) => a.email.toLowerCase() === email.toLowerCase() && a.verified_at !== null,
  );
}

/**
 * Riziko, které část 6 v 8.2.9 přiznává: uživatel si postaví kampaň na 20 000 lidí
 * a teprve při odeslání zjistí, že je ve zkušebním režimu. Zmírněním je pruh
 * s KONKRÉTNÍM číslem přímo na obrazovce publika, ne obecné varování.
 */
export function trialAudienceNotice(input: { audienceSize: number; verifiedCount: number }): {
  audience: number;
  willReceive: number;
} {
  return { audience: input.audienceSize, willReceive: input.verifiedCount };
}

export function addTrialAddress(settings: TrialSettings, email: string): TrialSettings {
  const current = settings.trial_verified ?? [];
  if (current.length >= TRIAL_MAX_VERIFIED_ADDRESSES) {
    throw new Error(
      `Ve zkušebním režimu lze ověřit nejvýše ${TRIAL_MAX_VERIFIED_ADDRESSES} adres.`,
    );
  }
  if (current.some((a) => a.email.toLowerCase() === email.toLowerCase())) return settings;
  return {
    ...settings,
    trial_verified: [...current, { email: email.toLowerCase(), verified_at: null }],
  };
}
