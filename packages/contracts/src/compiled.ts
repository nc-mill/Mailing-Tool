import { countClickMarkers, findLeftoverMarker, OPEN_PIXEL_MARKER } from './markers';

/**
 * Fixture kontraktu 5. `document` a `context` jsou VSTUP renderu (vlastní P08),
 * `compiled` je jeho VÝSTUP a `expect` jsou tvrzení, která nad výstupem platí.
 *
 * Pole `compiled` tady je proto, že tutéž fixture čte i Go strana, která blokový
 * model nezná a renderer nemá: sender dostává hotové compiled_html a compiled_text
 * a jen v nich nahrazuje značky.
 */
export type CompiledFixture = {
  id: string;
  description: string;
  document: Record<string, unknown>;
  context: {
    campaignId?: string;
    trackOpens: boolean;
    trackClicks: boolean;
    language: string;
    purpose?: string;
  };
  compiled?: { html: string; text: string };
  expect: {
    htmlContains?: string[];
    textContains?: string[];
    clickMarkerCount?: number;
    hasOpenPixelSlot?: boolean;
    error?: string;
  };
};

export type CompiledMismatch = { id: string; detail: string };

/**
 * Ověří vyrenderovaný výstup proti tvrzením fixture. Vrací seznam neshod místo
 * házení výjimky, aby volající viděl všechny naráz; jedna neshoda na jedno
 * tvrzení se hledá líp než první, o kterou se test zarazil.
 */
export function assertCompiledFixture(
  fixture: CompiledFixture,
  rendered: { html: string; text: string },
): CompiledMismatch[] {
  const out: CompiledMismatch[] = [];
  const add = (detail: string): void => void out.push({ id: fixture.id, detail });

  for (const needle of fixture.expect.htmlContains ?? []) {
    if (!rendered.html.includes(needle)) add(`HTML neobsahuje ${JSON.stringify(needle)}`);
  }
  for (const needle of fixture.expect.textContains ?? []) {
    if (!rendered.text.includes(needle)) add(`text neobsahuje ${JSON.stringify(needle)}`);
  }

  if (fixture.expect.clickMarkerCount !== undefined) {
    const total = countClickMarkers(rendered.html) + countClickMarkers(rendered.text);
    if (total !== fixture.expect.clickMarkerCount) {
      add(`značek odkazu je ${total}, čeká se ${fixture.expect.clickMarkerCount}`);
    }
  }

  if (fixture.expect.hasOpenPixelSlot !== undefined) {
    const present = rendered.html.includes(OPEN_PIXEL_MARKER);
    if (present !== fixture.expect.hasOpenPixelSlot) {
      add(`slot pixelu je ${present ? 'přítomný' : 'chybějící'}, čeká se opak`);
    }
    // Kontrakt garantuje PRÁVĚ JEDEN výskyt. Druhý by po náhradě zůstal
    // v dokumentu a odešel příjemci, protože pixel se nahrazuje jednou.
    const occurrences = rendered.html.split(OPEN_PIXEL_MARKER).length - 1;
    if (present && occurrences !== 1)
      add(`slot pixelu je v HTML ${occurrences}krát, smí být jednou`);
  }

  // Značka odkazu smí zůstat, tu nahrazuje až sender. Cokoliv jiného ne.
  const withoutLinks = rendered.text.replaceAll('mlain.invalid', '');
  const leftover = findLeftoverMarker(withoutLinks);
  if (leftover !== undefined) add(`v textové části zůstal vyhrazený řetězec ${leftover}`);

  return out;
}
