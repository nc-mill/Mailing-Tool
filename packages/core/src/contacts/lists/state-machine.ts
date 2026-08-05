import { HARD_BOUNCE_REMOVAL_MIN_DAYS } from '../constants';

export const SUBSCRIPTION_STATES = [
  'pending',
  'confirmed',
  'unsubscribed',
  'bounced',
  'complained',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATES)[number];
/** 'none' znamená, že řádek v list_subscriptions ještě neexistuje. */
export type SubscriptionState = SubscriptionStatus | 'none';

export type SuppressionSnapshot = {
  reason: string;
  createdAt: Date;
  removedAt: Date | null;
};

export type SubscriptionEvent =
  | {
      kind: 'subscribe';
      optIn: 'single' | 'double';
      source:
        | 'manual'
        | 'import'
        | 'api'
        | 'form'
        | 'webhook'
        | 'preference_center'
        | 'double_opt_in'
        | 'migration';
      /** Stav suppression pro tuhle adresu, pokud nějaká je. */
      suppression?: SuppressionSnapshot | null;
      /** Import a API s scope contacts:write smí potvrzení přeskočit, ale jen s prohlášením. */
      skipConfirmation?: boolean;
      declaration?: boolean;
      /**
       * Máme pro tenhle seznam DOLOŽENÝ, dosud neodvolaný souhlas? Vyhodnocuje ho
       * `findEffectiveConsent` nad append-only logem `consents`, ne volající podle nálady.
       * Význam je „souhlas už v evidenci je", ne „přeskoč potvrzení".
       */
      existingConsent?: boolean;
      now: Date;
    }
  | { kind: 'confirm'; token: 'valid' | 'expired' | 'consumed'; now: Date }
  | {
      kind: 'unsubscribe';
      scope: 'list' | 'global';
      reason:
        | 'link'
        | 'one_click'
        | 'preference_center'
        | 'api'
        | 'manual'
        | 'complaint'
        | 'bounce'
        | 'global'
        | 'objection'
        | 'import';
      now: Date;
    }
  | { kind: 'hard_bounce'; now: Date }
  | { kind: 'complaint'; now: Date }
  | { kind: 'cleanup'; now: Date }
  | { kind: 'admin_force_confirm'; now: Date };

/**
 * Vedlejší efekty přechodu. Automat je jen popisuje, neprovádí. Provedení patří volajícímu
 * (úkoly 28, 29, 31 a 35), protože sahá do databáze a do fronty a automat musí zůstat čistá funkce,
 * jinak se tabulka 4.8.1 nedá otestovat řádek po řádku.
 */
export type SubscriptionEffect =
  | 'issue_token'
  | 'send_confirmation'
  | 'consume_token'
  | 'grant_consent'
  | 'send_welcome'
  | 'activate_contact'
  | 'emit_subscribed'
  | 'withdraw_consent_list'
  | 'withdraw_consent_global'
  | 'unsubscribe_all_lists'
  | 'complain_all_lists'
  | 'add_suppression'
  | 'remove_unsubscribe_suppression'
  | 'set_contact_unsubscribed'
  | 'set_contact_bounced'
  | 'set_contact_complained'
  | 'revoke_pending_messages'
  | 'emit_unsubscribed'
  | 'delete_row'
  | 'audit_forced_confirm';

export type TransitionResult =
  | { allowed: true; next: SubscriptionStatus | 'deleted'; effects: SubscriptionEffect[] }
  | { allowed: false; code: 'subscribe_blocked_complaint' | 'subscribe_blocked_suppressed' };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Úplná tabulka přechodů ze 4.8.1 části 2. Jediné místo, kde se o přechodu rozhoduje.
 *
 * Nejdůležitější pravidlo je návrat odhlášeného VŽDY přes 'pending', i na seznamu se single
 * opt-in. Bez něj by stačilo znovu naimportovat starý soubor a odhlášení lidé by byli zpátky
 * v rozesílce, aniž by kdokoliv poznal, že se to stalo.
 */
export function transition(from: SubscriptionState, event: SubscriptionEvent): TransitionResult {
  switch (event.kind) {
    case 'subscribe':
      return onSubscribe(from, event);
    case 'confirm':
      return onConfirm(from, event);
    case 'unsubscribe':
      return onUnsubscribe(from, event);
    case 'hard_bounce':
      return from === 'complained'
        ? // Stížnost je přísnější signál než odraz a nikdy se jí neustupuje.
          { allowed: true, next: 'complained', effects: ['add_suppression'] }
        : { allowed: true, next: 'bounced', effects: ['add_suppression', 'set_contact_bounced'] };
    case 'complaint':
      return {
        allowed: true,
        next: 'complained',
        effects: [
          'add_suppression',
          'complain_all_lists',
          'set_contact_complained',
          'withdraw_consent_global',
          'revoke_pending_messages',
        ],
      };
    case 'cleanup':
      return from === 'pending'
        ? { allowed: true, next: 'deleted', effects: ['delete_row'] }
        : // Úklid se smí dotknout jen nepotvrzených řádků. Cokoliv jiného by mazalo důkazy.
          { allowed: true, next: from === 'none' ? 'deleted' : from, effects: [] };
    case 'admin_force_confirm':
      return {
        allowed: true,
        next: 'confirmed',
        effects: ['grant_consent', 'activate_contact', 'audit_forced_confirm'],
      };
  }
}

function onSubscribe(
  from: SubscriptionState,
  event: Extract<SubscriptionEvent, { kind: 'subscribe' }>,
): TransitionResult {
  // Stížnost blokuje přihlášení natrvalo a jedinou cestou zpět je ruční zásah správce
  // se záznamem v auditu (událost 'admin_force_confirm').
  if (from === 'complained') return { allowed: false, code: 'subscribe_blocked_complaint' };

  if (from === 'bounced' && !bounceSubscribeAllowed(event)) {
    return { allowed: false, code: 'subscribe_blocked_suppressed' };
  }

  // Kdo už je potvrzený, nedostane nic navíc: žádný potvrzovací ani uvítací e-mail.
  // Je to rozhodnutí zadavatele a zároveň jediná obrana proti tomu, aby se opakovaným
  // odesláním formuláře dala cizí schránka zaplavit našimi e-maily.
  if (from === 'confirmed') return { allowed: true, next: 'confirmed', effects: [] };

  // Import a API smí potvrzení přeskočit jen s doloženým prohlášením o existujícím souhlasu.
  // Bez prohlášení se přechod do 'confirmed' na double opt-in seznamu nikdy nesmí stát.
  //
  // ŽIVÁ SUPPRESSION zkratku zavírá, ať je důvod jakýkoliv (pravidlo 4 z 4.1.2). Je to
  // jediné místo, kde volající API vyrobí potvrzené přihlášení A UDĚLENÝ SOUHLAS, aniž by
  // příjemce cokoliv udělal. Řádek v seznamu chybět může (globální odhlášení se do stavu
  // konkrétního seznamu nepromítne), takže bez téhle podmínky by se odhlášený člověk vrátil
  // rovnou do rozesílky. Cesta zpět zůstává: níž se propadne na pending s potvrzovacím
  // odkazem, tedy na projev vůle příjemce.
  if (
    event.skipConfirmation === true &&
    event.declaration === true &&
    from !== 'unsubscribed' &&
    !hasLiveSuppression(event)
  ) {
    return {
      allowed: true,
      next: 'confirmed',
      effects: ['grant_consent', 'send_welcome', 'emit_subscribed'],
    };
  }

  /*
   * DOLOŽENÝ SOUHLAS. Dvoufázové potvrzení slouží k tomu, aby si souhlas vyžádalo
   * od příjemce tam, kde ho nemáme. Kde ho máme zapsaný, auditovaný a neodvolaný,
   * není to ochrana příjemce, ale překážka: člověk by nikdy nedostal ani ten potvrzovací
   * e-mail, na který se čeká, a zůstal by v `pending` navždy.
   *
   * Souhlas si tahle funkce nevymýšlí ani nedovozuje z nastavení seznamu. Rozhoduje
   * o něm `findEffectiveConsent` nad append-only logem `consents`, tedy nad dokladem.
   *
   * TŘI POJISTKY, každá zavírá jinou díru:
   *   - `from !== 'unsubscribed'`: kdo se odhlásil, se takhle nevrátí. Odhlášení je
   *     projev vůle příjemce a přebíjí jakýkoliv starší souhlas. Odvolání souhlasu
   *     odhlášení zapisuje taky, takže by sem `existingConsent` normálně vůbec nedošel;
   *     podmínka je tu proto, že na tomhle nesmí záležet.
   *   - `!hasLiveSuppression`: živá blokace adresy zavírá zkratku stejně jako u prohlášení.
   *   - stížnost a čerstvý tvrdý odraz odmítly větve nad tímhle blokem.
   *
   * `from === 'confirmed'` sem nedojde, vrátil se výš beze změny, takže se opakovaným
   * přidáním do seznamu nedá poslat druhý uvítací e-mail.
   */
  if (event.existingConsent === true && from !== 'unsubscribed' && !hasLiveSuppression(event)) {
    return {
      allowed: true,
      next: 'confirmed',
      effects: ['grant_consent', 'send_welcome', 'emit_subscribed'],
    };
  }

  // Odhlášený se vrací VŽDY přes pending, i na single opt-in seznamu a i s prohlášením.
  if (from === 'unsubscribed') {
    return { allowed: true, next: 'pending', effects: ['issue_token', 'send_confirmation'] };
  }

  if (event.optIn === 'single' && from === 'none') {
    return {
      allowed: true,
      next: 'confirmed',
      effects: ['grant_consent', 'send_welcome', 'emit_subscribed'],
    };
  }

  // 'none' i 'pending' i 'bounced' s odebranou suppression končí ve stejném stavu.
  // U 'pending' je to opakované odeslání potvrzení; limity hlídá volající (úkol 27).
  return { allowed: true, next: 'pending', effects: ['issue_token', 'send_confirmation'] };
}

/** Blokace, která PRÁVĚ TEĎ platí. Měkce odebraný řádek (removed_at) už neplatí. */
function hasLiveSuppression(event: Extract<SubscriptionEvent, { kind: 'subscribe' }>): boolean {
  const suppression = event.suppression ?? null;
  return suppression !== null && suppression.removedAt === null;
}

function bounceSubscribeAllowed(event: Extract<SubscriptionEvent, { kind: 'subscribe' }>): boolean {
  const suppression = event.suppression ?? null;
  if (suppression === null) return true;
  if (suppression.removedAt !== null) return true;
  const ageDays = (event.now.getTime() - suppression.createdAt.getTime()) / DAY_MS;
  return ageDays >= HARD_BOUNCE_REMOVAL_MIN_DAYS;
}

function onConfirm(
  from: SubscriptionState,
  event: Extract<SubscriptionEvent, { kind: 'confirm' }>,
): TransitionResult {
  if (from === 'complained') return { allowed: false, code: 'subscribe_blocked_complaint' };

  if (event.token === 'expired') {
    // Prošlý odkaz nikdy nekončí chybou: vydá se nový a pošle se znovu. Limity hlídá volající.
    return {
      allowed: true,
      next: from === 'none' ? 'pending' : (from as SubscriptionStatus),
      effects: ['issue_token', 'send_confirmation'],
    };
  }

  if (event.token === 'consumed') {
    // Lidé klikají dvakrát. Druhé kliknutí musí říct "už jste přihlášeni", nikdy chybu.
    return { allowed: true, next: 'confirmed', effects: [] };
  }

  if (from === 'unsubscribed') {
    return {
      allowed: true,
      next: 'confirmed',
      effects: [
        'consume_token',
        'remove_unsubscribe_suppression',
        'grant_consent',
        'send_welcome',
        'activate_contact',
        'emit_subscribed',
      ],
    };
  }

  return {
    allowed: true,
    next: 'confirmed',
    effects: [
      'consume_token',
      'grant_consent',
      'send_welcome',
      'activate_contact',
      'emit_subscribed',
    ],
  };
}

function onUnsubscribe(
  from: SubscriptionState,
  event: Extract<SubscriptionEvent, { kind: 'unsubscribe' }>,
): TransitionResult {
  const effects: SubscriptionEffect[] = [];

  // Z pending se odhlašuje bez odvolání souhlasu: žádný souhlas nikdy nevznikl.
  if (from === 'confirmed') {
    effects.push(event.scope === 'global' ? 'withdraw_consent_global' : 'withdraw_consent_list');
  }

  if (event.scope === 'global') {
    effects.push('unsubscribe_all_lists', 'add_suppression', 'set_contact_unsubscribed');
  }

  effects.push('revoke_pending_messages');
  if (from === 'confirmed') effects.push('emit_unsubscribed');

  return { allowed: true, next: 'unsubscribed', effects };
}
