import { randomBytes } from 'node:crypto';

/** SECRET_KEY je base64url bez paddingu, který se dekóduje na přesně 32 bajtů. */
export function generateSecretKey(): string {
  return randomBytes(32).toString('base64url');
}

export const MAX_KEY_ID = 255;

/**
 * Pokolení, která instalace zná, přečtená z PROSTŘEDÍ.
 *
 * Schválně se to nečte z databáze, ačkoliv `key_id` je i v datech. `mlain
 * genkey` se pouští právě tehdy, když se s klíči něco děje: před instalací,
 * kdy databáze ještě neexistuje, a při havárii, kdy nemusí být dostupná.
 * Příkaz, který v takové chvíli spadne na připojení, je k ničemu, a příkaz,
 * který by při nedostupné databázi mlčky předpokládal „žádná pokolení",
 * by byl horší než k ničemu: navrhl by `key_id`, které se už používá.
 *
 * Parsuje se BENEVOLENTNĚ a nikdy to nevyhodí výjimku. Prostředí, ve kterém
 * se tenhle příkaz pouští, bývá rozbité, a to je důvod k jeho spuštění, ne
 * důvod ho odmítnout. Co se přečíst nedá, se přeskočí; výsledek je jen soupis
 * čísel, který se pak pro jistotu vypisuje uživateli.
 */
export function keyIdsInEnv(env: {
  SECRET_KEY?: string | undefined;
  SECRET_KEY_PREVIOUS?: string | undefined;
}): number[] {
  const found = new Set<number>();
  const generations = [env.SECRET_KEY ?? '', ...(env.SECRET_KEY_PREVIOUS ?? '').split(',')];
  for (const generation of generations) {
    const [rawId, ...rest] = generation.trim().split(':');
    if (rest.length === 0 || rawId === undefined) continue;
    const keyId = Number(rawId);
    if (Number.isInteger(keyId) && keyId >= 1 && keyId <= MAX_KEY_ID) found.add(keyId);
  }
  return [...found].sort((a, b) => a - b);
}

export type KeyIdDecision =
  { ok: true; keyId: number; notes: string[] } | { ok: false; message: string };

/**
 * Rozhodne, jaké `key_id` má nový klíč dostat.
 *
 * VADA, KTEROU TAHLE FUNKCE ZAVÍRÁ: příkaz měl `--id` s výchozí hodnotou 2.
 * Kdo přepínač vynechal podruhé, vyrobil DRUHÝ RŮZNÝ klíč se stejným `key_id`.
 * Obálky zašifrované tím prvním se pak nedají přečíst a nic to neohlásí:
 * `key_id` sedí, takže se sáhne po klíči, který k datům nepatří, a dešifrování
 * skončí jako „poškozená data". Ztráta je nevratná.
 *
 * Pravidla jsou tři a všechna vycházejí z toho, že tichý omyl je horší než
 * hlasité odmítnutí:
 *
 *  1. Když prostředí zná pokolení, odvodí se následující číslo. Žádná pevná
 *     výchozí hodnota; ta byla podstatou vady.
 *  2. Když prostředí nezná žádné, příkaz `--id` VYŽADUJE. Nezvolí 1 sám:
 *     `mlain genkey` se běžně pouští i na stroji, který s instalací nemá nic
 *     společného, a tam by „žádná pokolení" znamenalo naopak „nevím".
 *  3. Vyžádané číslo, které se v prostředí už vyskytuje, se ODMÍTNE. Přepsat
 *     existující pokolení jiným klíčem je právě ta nevratná ztráta.
 */
export function decideKeyId(
  requested: string | undefined,
  known: readonly number[],
): KeyIdDecision {
  const highest = known.length === 0 ? null : Math.max(...known);

  if (requested === undefined) {
    if (highest === null) {
      return {
        ok: false,
        message: [
          'Nevím, kolikáté pokolení klíče to má být, a hádat ho nebudu: druhý různý klíč',
          'se stejným key_id znamená, že se data zašifrovaná tím prvním už nepřečtou.',
          '',
          'V prostředí tohohle příkazu není SECRET_KEY ani SECRET_KEY_PREVIOUS, takže',
          'z něj nejde nic odvodit. Máte dvě možnosti:',
          '',
          '  - spusťte příkaz tam, kde instalace běží (v kontejneru přes mlain genkey),',
          '    a číslo si odvodí samo,',
          '  - nebo pokolení zadejte: mlain genkey --id <n>.',
          '',
          'První klíč nové instalace je --id 1.',
        ].join('\n'),
      };
    }
    return {
      ok: true,
      keyId: highest + 1,
      notes: [
        `Pokolení v prostředí: ${known.join(', ')}. Nový klíč dostal následující číslo ${highest + 1}.`,
      ],
    };
  }

  const keyId = Number(requested);
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > MAX_KEY_ID) {
    return { ok: false, message: `key_id musí být celé číslo od 1 do ${MAX_KEY_ID}.` };
  }
  if (known.includes(keyId)) {
    return {
      ok: false,
      message: [
        `Pokolení ${keyId} instalace UŽ ZNÁ a nový klíč by mělo stejné key_id.`,
        'Obálky zašifrované tím dosavadním klíčem by se přestaly dát přečíst, protože',
        'key_id by sedělo a sáhlo by se po klíči, který k nim nepatří. Nic by to neohlásilo.',
        '',
        `Pokolení v prostředí: ${known.join(', ')}. Další volné je ${Math.max(...known) + 1}:`,
        '',
        `  mlain genkey --id ${Math.max(...known) + 1}`,
      ].join('\n'),
    };
  }

  const notes: string[] = [];
  if (highest !== null && keyId < highest) {
    notes.push(
      `POZOR: pokolení ${keyId} je nižší než nejvyšší známé ${highest}. ` +
        'Rotace jde nahoru, takže to skoro jistě není, co chcete.',
    );
  }
  return { ok: true, keyId, notes };
}

/**
 * Postup rotace podle 3.10. Pořadí kroků 2 a 3 se nesmí prohodit: kdyby
 * přešifrování běželo dřív, než se restartuje sender, běžel by sender pořád
 * se starým klíčem, konfigurace providera by byla zašifrovaná novým a každé
 * dešifrování by selhalo. U kampaně na milion příjemců je to rozdíl milionu
 * zpráv označených jako neúspěšné.
 */
export function rotationRunbook(
  keyId: number,
  key: string,
  previous: readonly number[] = [],
): string {
  // Jmenovaná pokolení místo zástupného textu, když je odkud vzít. Krok 5
  // varuje, že vynechání staršího pokolení je tichá ztráta ochrany; výčet
  // konkrétních čísel je jediné, co proti tomu opravdu pomůže.
  const previousLine =
    previous.length === 0
      ? '       SECRET_KEY_PREVIOUS=<dosavadní pokolení, oddělená čárkou>'
      : `       SECRET_KEY_PREVIOUS=<pokolení ${previous.join(', ')}, oddělená čárkou, ŽÁDNÉ nevynechávat>`;
  return [
    `Nový klíč pro pokolení ${keyId}:`,
    '',
    `  ${key}`,
    '',
    'Postup rotace, kroky se nesmí prohodit:',
    '',
    '  1. Do prostředí VŠECH procesů (web, worker, sender):',
    `       SECRET_KEY=${keyId}:${key}`,
    previousLine,
    '',
    '  2. docker compose up -d',
    '     Restartujte VŠECHNY procesy a u každého ověřte readiness.',
    '     Teprve teď smí přijít krok 3.',
    '',
    '  3. mlain rotate-credentials',
    '     Přešifruje uložená tajemství na nové pokolení.',
    '     Kdyby tenhle krok přišel před restartem, sender by běžel se starým klíčem,',
    '     konfigurace providera by byla zašifrovaná novým a každé dešifrování by selhalo.',
    '',
    '  4. Počkejte 15 minut na expiraci identifikačních tokenů z prokliků.',
    '',
    '  5. SECRET_KEY_PREVIOUS se NIKDY neodebírá, ani po rotate-credentials.',
    '     Trackovací tokeny ve starých e-mailech leží v cizích schránkách roky',
    '     a otisky smazaných adres nejdou přepočítat, protože adresa je po výmazu pryč.',
    '     Odebrání starého pokolení je tichá ztráta ochrany: nic neselže a nic se nezaloguje.',
    '',
    '  6. Uložte si celý keyring do recovery bundle, tedy nový klíč i všechna předchozí pokolení.',
    '',
  ].join('\n');
}
