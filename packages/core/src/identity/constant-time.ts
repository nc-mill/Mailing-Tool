import { setTimeout as delay } from 'node:timers/promises';

/**
 * Rozhodnutí R6 plánu P04. Kritérium 16 vyžaduje, aby se doba odpovědi na
 * přihlášení k neexistujícímu účtu nelišila od existujícího o víc než 20 %
 * (medián ze 100 pokusů). Dummy hash sám o sobě nestačí: existující účet má
 * navíc dotaz na členství, zápis čítače a případný rehash.
 *
 * 250 ms je s rezervou nad dobou jednoho ověření Argon2id při m=19456,t=2,p=1
 * (řádově desítky milisekund) i nad dobou dvou dotazů do databáze.
 */
export const AUTH_MIN_RESPONSE_MS = 250;

export type FloorWarning = (code: 'constant_time_floor_exceeded', elapsedMs: number) => void;

/**
 * Provede operaci a vrátí se nejdřív po `minMs` od začátku, i když skončila dřív.
 * Když trvala déle, dospání se přeskočí a zavolá se `onFloorExceeded`, protože
 * v takovém případě podlaha přestala latenci srovnávat a kritérium 16 už neplatí.
 * Výjimka se propaguje až po uplynutí podlahy, jinak by chybová cesta byla
 * měřitelně rychlejší než úspěšná.
 */
export async function withConstantTime<T>(
  minMs: number,
  operation: () => Promise<T>,
  onFloorExceeded?: FloorWarning,
): Promise<T> {
  const startedAt = Date.now();
  let result: T | undefined;
  let failure: unknown;

  try {
    result = await operation();
  } catch (err) {
    failure = err;
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) {
    await delay(minMs - elapsed);
  } else {
    onFloorExceeded?.('constant_time_floor_exceeded', elapsed);
  }

  if (failure !== undefined) throw failure;
  return result as T;
}
