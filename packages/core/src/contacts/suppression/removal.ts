import { HARD_BOUNCE_REMOVAL_MIN_DAYS } from '../constants';
import type { SuppressionReason } from './rank';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** Výchozí odebratelnost podle matice ve 4.10.1. Volající ji nikdy nepředává. */
export const REMOVABLE_BY_DEFAULT: Record<SuppressionReason, boolean> = {
  hard_bounce: false,
  soft_bounce_threshold: true,
  complaint: false,
  manual: true,
  global_unsubscribe: false,
  one_click_unsubscribe: false,
  invalid: true,
  import: true,
  gdpr_erasure: false,
  ses_suppressed: false,
};

export type RemovalCheck =
  | { allowed: true }
  | { allowed: false; code: 'suppression_not_removable' | 'suppression_too_recent' | 'forbidden' };

export function minimumAgeDays(reason: SuppressionReason): number {
  return reason === 'hard_bounce' ? HARD_BOUNCE_REMOVAL_MIN_DAYS : 0;
}

/**
 * Matice odebrání ze 4.10.2 části 2.
 *
 * Platí vůči AKTUÁLNÍMU důvodu, ne vůči tomu, se kterým řádek vznikl. Adresa zablokovaná
 * ručně, na kterou později přijde stížnost, se povýší na complaint a od té chvíle ji
 * nejde odebrat vůbec. Kdyby se povýšení nedělalo, editor by stížnost odblokoval jedním
 * kliknutím a nikde by nebylo vidět, že odblokovává stížnost.
 *
 * Stížnost je nejsilnější negativní signál, jaký od příjemce existuje, a hromadné
 * odblokování stížností je nejrychlejší cesta k pozastavení účtu u odesílacího providera.
 */
export function canRemove(reason: SuppressionReason, role: Role, ageDays: number): RemovalCheck {
  // Nikdy: stížnost a výmaz podle článku 17. Jediná cesta je zásah v databázi,
  // který si musí provozovatel obhájit sám.
  if (reason === 'complaint' || reason === 'gdpr_erasure') {
    return { allowed: false, code: 'suppression_not_removable' };
  }

  // Nikdy přímo: odhlášení. Odstraní se automaticky, když ten samý člověk znovu
  // projde dvojím potvrzením. Tím je návrat vždy jeho rozhodnutím, ne rozhodnutím
  // marketéra.
  if (reason === 'global_unsubscribe' || reason === 'one_click_unsubscribe') {
    return { allowed: false, code: 'suppression_not_removable' };
  }

  // Blokaci od odesílacího providera nemá smysl odebírat u nás, odebírá se u něj.
  if (reason === 'ses_suppressed') {
    return { allowed: false, code: 'suppression_not_removable' };
  }

  if (reason === 'hard_bounce') {
    if (role !== 'owner' && role !== 'admin') return { allowed: false, code: 'forbidden' };
    if (ageDays < HARD_BOUNCE_REMOVAL_MIN_DAYS) {
      return { allowed: false, code: 'suppression_too_recent' };
    }
    return { allowed: true };
  }

  if (role === 'viewer') return { allowed: false, code: 'forbidden' };
  return { allowed: true };
}

/**
 * Hromadné odebrání je dostupné jen u mírných důvodů. U tvrdých odrazů je povolené
 * jen pro konkrétní doménu, po výrazném potvrzení, s uvedením důvodu a se zápisem
 * do auditu (rozhodnutí zadavatele, které zmírnilo původní absolutní zákaz).
 * Stížnosti se hromadně odblokovat nesmějí nikdy.
 */
export function canRemoveInBulk(reason: SuppressionReason, role: Role): boolean {
  if (reason === 'hard_bounce') return role === 'owner' || role === 'admin';
  return canRemove(reason, role, Number.MAX_SAFE_INTEGER).allowed;
}
