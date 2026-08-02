import { randomBytes } from 'node:crypto';

/** SECRET_KEY je base64url bez paddingu, který se dekóduje na přesně 32 bajtů. */
export function generateSecretKey(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Postup rotace podle 3.10. Pořadí kroků 2 a 3 se nesmí prohodit: kdyby
 * přešifrování běželo dřív, než se restartuje sender, běžel by sender pořád
 * se starým klíčem, konfigurace providera by byla zašifrovaná novým a každé
 * dešifrování by selhalo. U kampaně na milion příjemců je to rozdíl milionu
 * zpráv označených jako neúspěšné.
 */
export function rotationRunbook(keyId: number, key: string): string {
  return [
    `Nový klíč pro pokolení ${keyId}:`,
    '',
    `  ${key}`,
    '',
    'Postup rotace, kroky se nesmí prohodit:',
    '',
    '  1. Do prostředí VŠECH procesů (web, worker, sender):',
    `       SECRET_KEY=${keyId}:${key}`,
    '       SECRET_KEY_PREVIOUS=<dosavadní pokolení, oddělená čárkou>',
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
