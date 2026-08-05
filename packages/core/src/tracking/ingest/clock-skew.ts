/**
 * Korekce hodin klienta, viz plán P10 Task 25.
 *
 * Hodiny v prohlížeči nejsou spolehlivé, uživatel si je může nastavit na rok
 * 1970 nebo 2099. Okno je jediné místo, kde se taková hodnota zastaví,
 * a zároveň ohraničuje, o kolik oddílů zpět musí časová osa sáhnout.
 *
 * Pro dávkový import se korekce ANI okno nepoužijí: tam čas dodává server
 * zákazníka z vlastní databáze objednávek.
 */

const MAX_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_LAG_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 60 * 1000;

export type CorrectInput = { occurredAt: Date; sentAt: Date; serverNow: Date };
export type CorrectResult = { occurredAt: Date; clockSkewMs: number };

/**
 * Obě hranice jsou zároveň vynucené constraintem `ck_web_events__lag`.
 * Dolní odpovídá životnosti offline fronty v SDK, horní pokrývá hodiny napřed.
 * Bez ořezu by událost spadla mimo existující oddíl a zápis by tvrdě selhal,
 * protože výchozí oddíl se nezakládá.
 *
 * ODCHYLKA OD PLÁNU, vynucená constraintem: dolní hranice je `-7 dní + 1 minuta`,
 * ne přesně `-7 dní`. Constraint je ostrý (`occurred_at > received_at - 7 dní`)
 * a mezi ořezem v aplikaci a zápisem uběhne nenulový čas, takže hodnota přesně
 * na hranici projde ořezem a spadne na constraintu. Minuta rezervy je stejná,
 * jakou používá `web-events.repo.ts` u událostí z e-mailu.
 */
export function correctOccurredAt(input: CorrectInput): CorrectResult {
  const skewMs = input.serverNow.getTime() - input.sentAt.getTime();

  if (Math.abs(skewMs) > MAX_SKEW_MS) {
    return { occurredAt: input.serverNow, clockSkewMs: skewMs };
  }

  const corrected = input.occurredAt.getTime() + skewMs;
  const lowerBound = input.serverNow.getTime() - MAX_LAG_MS + 60_000;
  const upperBound = input.serverNow.getTime() + MAX_AHEAD_MS;
  const clamped = Math.min(Math.max(corrected, lowerBound), upperBound);

  return { occurredAt: new Date(clamped), clockSkewMs: skewMs };
}
