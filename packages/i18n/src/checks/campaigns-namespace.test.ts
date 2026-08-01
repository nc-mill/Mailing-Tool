import { describe, expect, it } from 'vitest';
import cs from '../../messages/cs/campaigns.json';
import en from '../../messages/en/campaigns.json';
import { NAMESPACES } from '../load-messages';

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ KONFIGURACÍ. Plán psal test do
 * `packages/i18n/__tests__/campaigns-namespace.test.ts`. Vitest v tomhle balíčku
 * má `include: ['src/**\/*.test.ts']`, takže by se soubor mimo `src/` nespustil
 * NIKDY a série by přesto skončila zeleně. Test proto stojí vedle ostatních
 * kontrol katalogu, kde ho ta konfigurace opravdu najde.
 */
function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('namespace campaigns', () => {
  it('je zapsaný v registru NAMESPACES, jinak by se za běhu vůbec nenačetl', () => {
    expect(NAMESPACES).toContain('campaigns');
  });

  it('cs a en mají shodnou množinu klíčů, en je zdroj pravdy', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('pokrývá všech deset stavů kampaně', () => {
    for (const s of [
      'draft',
      'scheduled',
      'queueing',
      'sending',
      'paused',
      'sent',
      'partiallySent',
      'cancelled',
      'failed',
      'scheduleMissed',
    ]) {
      expect(cs.status).toHaveProperty(s);
      expect(en.status).toHaveProperty(s);
    }
  });

  it('pokrývá VŠECH DEVĚT kódů pause_reason, včetně čtyř od senderu', () => {
    for (const code of [
      'renderFailureRate',
      'credentialsUndecryptable',
      'providerQuotaExhausted',
      'providerUnavailable',
      'user',
      'bounceGuard',
      'complaintGuard',
      'providerBlocked',
      'materializeTimeout',
    ]) {
      expect(cs.pauseReason, code).toHaveProperty(code);
    }
  });

  it('český plurál má kategorie =0, one, few, many i other', () => {
    for (const value of [cs.audience.recipientCount, cs.send.button, cs.dns.recordCount]) {
      for (const category of ['=0 {', 'one {', 'few {', 'many {', 'other {']) {
        expect(value).toContain(category);
      }
    }
  });

  it('počet DNS záznamů je ICU plurál, ne pevné slovo', () => {
    expect(cs.dns.recordCount).toMatch(/\{count, plural,/);
    expect(en.dns.recordCount).toMatch(/\{count, plural,/);
  });

  it('texty o nevratnosti říkají rovnou, že odeslané maily zpátky nejdou', () => {
    expect(cs.progress.stopped).toContain('zpátky');
    expect(cs.send.confirmUndo).toContain('zpátky vzít nejde');
    expect(en.progress.stopped).toContain("can't be recalled");
  });

  it('kontrolní seznam má pojmenovanou každou bránu rozpadu publika', () => {
    for (const key of [
      'excludedSuppressed',
      'excludedUnsubscribed',
      'excludedUnconfirmed',
      'excludedSnoozed',
      'excludedProcessingRestricted',
      'excludedInvalidEmail',
      'excludedDeleted',
      'excludedSample',
      'duplicatesRemoved',
    ]) {
      expect(cs.audience, key).toHaveProperty(key);
    }
  });

  it('prahy doručitelnosti mají text o tom, že jde jen přitvrdit', () => {
    expect(cs.sending.thresholds.explanation).toContain('strop');
    expect(cs.sending.thresholds.tooLoose).toContain('přísnější');
  });

  it('žádný klíč neobsahuje dlouhou pomlčku', () => {
    // U+2014 se zapisuje kódem schválně: znak samotný se do repozitáře nedostane
    // ani v testu, který ho zakazuje, takže grep přes celý strom zůstává čistý.
    const emDash = String.fromCharCode(0x2014);
    expect(JSON.stringify(cs)).not.toContain(emDash);
    expect(JSON.stringify(en)).not.toContain(emDash);
  });
});
