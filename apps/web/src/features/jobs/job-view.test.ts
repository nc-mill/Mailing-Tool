import { describe, expect, it } from 'vitest';
import {
  JOB_STATUS_KEYS,
  jobDetailHref,
  jobKey,
  jobKindKey,
  jobSourceLink,
  jobStatusKey,
  jobNote,
  jobStatusTone,
  mergeJobs,
  replaceFirstPage,
  type ApiJob,
} from './job-view';

const job: ApiJob = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'import',
  title: 'kveten.csv',
  status: 'completedWithErrors',
  done: 4987,
  total: 5000,
  started_by: 'Jana Nováková',
  started_at: '2026-08-07T10:00:00.000Z',
  updated_at: '2026-08-07T10:04:00.000Z',
  finished_at: '2026-08-07T10:04:00.000Z',
  note: 'row_invalid',
  can_cancel: false,
  stopping: false,
};

const labels = {
  failureCode: (code: string) => `Kód chyby: ${code}`,
  stopping: 'Zastavuje se.',
};

describe('převod úlohy pro obrazovku', () => {
  it('detail úlohy nese druh i ID, protože ID nejsou napříč zdroji jedinečná', () => {
    expect(jobDetailHref(job, 'eshop-kolo')).toBe(
      '/w/eshop-kolo/jobs/import/11111111-1111-4111-8111-111111111111',
    );
  });

  it('klíč řádku je druh a ID, aby se dvě úlohy se stejným ID nesrazily', () => {
    expect(jobKey(job)).not.toBe(jobKey({ ...job, kind: 'campaign_audience' }));
  });

  it('import vede na svůj průběh, kampaň na svoji kampaň', () => {
    expect(jobSourceLink(job, 'eshop-kolo')?.href).toBe(
      '/w/eshop-kolo/contacts/import/11111111-1111-4111-8111-111111111111',
    );
    expect(
      jobSourceLink({ kind: 'campaign_audience', id: 'c-1', status: 'running' }, 'eshop-kolo')
        ?.href,
    ).toBe('/w/eshop-kolo/campaigns/c-1');
  });

  /**
   * ROZDĚLANÝ IMPORT PATŘÍ DO PRŮVODCE. `paused` znamená „čeká se na člověka",
   * tedy nepotvrzené mapování sloupců; výsledek takový import nemá a odkaz na něj
   * vedl na obrazovku bez obsahu. Naměřeno 7. 8. 2026 na skutečném případu, kdy
   * zadavateli zůstal rozdělaný import a v rozhraní ho neměl jak spustit.
   */
  it('rozdělaný import vede do PRŮVODCE, ne na výsledek', () => {
    const link = jobSourceLink({ ...job, status: 'paused' }, 'eshop-kolo');
    expect(link?.href).toBe(
      '/w/eshop-kolo/contacts/import?import=11111111-1111-4111-8111-111111111111',
    );
    // Jiný popisek: „Otevřít import" u nedokončeného slibuje výsledek, který není.
    expect(link?.labelKey).toBe('jobs.resumeImport');
  });

  it('dokončený import vede pořád na výsledek', () => {
    for (const status of ['completed', 'completedWithErrors', 'failed', 'cancelled'] as const) {
      expect(jobSourceLink({ ...job, status }, 'eshop-kolo')?.href).toBe(
        '/w/eshop-kolo/contacts/import/11111111-1111-4111-8111-111111111111',
      );
    }
  });

  it('neznámý druh úlohy nedostane vymyšlený odkaz ani syrový název', () => {
    expect(
      jobSourceLink({ kind: 'export', id: 'e-1', status: 'running' }, 'eshop-kolo'),
    ).toBeNull();
    expect(jobKindKey('export')).toBe('jobs.kindUnknown');
  });

  it('každý stav z jádra má popisek i tón', () => {
    for (const status of Object.keys(JOB_STATUS_KEYS) as (keyof typeof JOB_STATUS_KEYS)[]) {
      expect(JOB_STATUS_KEYS[status]).toMatch(/^jobs\.status/);
      expect(jobStatusTone(status)).toBeTruthy();
    }
  });

  it('úloha bez poznámky nedostane prázdný text, ale nic', () => {
    expect(jobNote({ ...job, note: null, stopping: false }, labels)).toBeNull();
  });

  it('kód selhání se ukáže jako kód, ne jako holé slovo bez kontextu', () => {
    expect(jobNote(job, labels)).toBe('Kód chyby: row_invalid');
  });

  /**
   * Zastavování je silnější než stav. Zrušení se zapíše hned, ale běh se
   * zastaví až u nejbližší kontroly, takže „Zrušeno" by o dobíhající dávce
   * tvrdilo, že žádná není.
   */
  it('dokud dávka dobíhá, popisek stavu je zastavování, ne zrušeno', () => {
    expect(jobStatusKey({ status: 'cancelled', stopping: false })).toBe('jobs.statusCancelled');
    expect(jobStatusKey({ status: 'cancelled', stopping: true })).toBe('jobs.statusStopping');
  });

  it('dobíhající dávka i kód chyby se vejdou do řádku oba', () => {
    expect(jobNote({ ...job, stopping: true }, labels)).toBe(
      'Zastavuje se. Kód chyby: row_invalid',
    );
  });
});

/**
 * STRÁNKOVÁNÍ HISTORIE. Limit 50 nejnovějších úloh byl do 7. 8. strop, za
 * který se nedalo dostat; zadavatel chce vidět všechno, takže se z něj stala
 * velikost stránky. Ta změna má dvě nesymetrická pravidla a obě se dají
 * splést, proto sem patří test, ne jen komentář.
 */
describe('Stránkování a obnovování seznamu úloh', () => {
  const at = (id: string, updatedAt: string): ApiJob => ({ ...job, id, updated_at: updatedAt });

  it('další stránka se přidá pod už načtené, ne místo nich', () => {
    const first = [at('a', '2026-08-07T10:00:00.000Z'), at('b', '2026-08-07T09:00:00.000Z')];
    const second = [at('c', '2026-08-07T08:00:00.000Z')];

    expect(mergeJobs(first, second).map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  it('úloha, která se mezi dotazy posunula nahoru, není v seznamu dvakrát', () => {
    const first = [at('a', '2026-08-07T10:00:00.000Z'), at('b', '2026-08-07T09:00:00.000Z')];
    const again = [at('b', '2026-08-07T11:00:00.000Z')];

    expect(mergeJobs(first, again).map((j) => j.id)).toEqual(['b', 'a']);
  });

  /**
   * Obnovení NAHRAZUJE první stránku. Kdyby ji slévalo, zůstala by na
   * obrazovce navždy úloha, která se z první stránky posunula pryč.
   */
  it('obnovení odebere z první stránky to, co tam server už nemá', () => {
    const shown = [at('a', '2026-08-07T10:00:00.000Z'), at('b', '2026-08-07T09:00:00.000Z')];
    const fresh = [at('a', '2026-08-07T10:30:00.000Z')];

    expect(replaceFirstPage(shown, fresh, false).map((j) => j.id)).toEqual(['a']);
  });

  it('dolistovaná historie obnovení první stránky přežije', () => {
    const shown = [
      at('a', '2026-08-07T10:00:00.000Z'),
      at('b', '2026-08-07T09:00:00.000Z'),
      at('c', '2026-08-07T08:00:00.000Z'),
    ];
    // Čerstvá první stránka končí na `b`, takže `c` je historie pod ní.
    const fresh = [at('a', '2026-08-07T10:30:00.000Z'), at('b', '2026-08-07T09:00:00.000Z')];

    expect(replaceFirstPage(shown, fresh, true).map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  /**
   * Když za čerstvou stránkou nic není, je odpověď CELÝ seznam. Historie se
   * proto zahodí: jinak by na obrazovce zůstaly řádky, které na serveru
   * přestaly existovat.
   */
  it('bez další stránky se historie nedrží', () => {
    const shown = [at('a', '2026-08-07T10:00:00.000Z'), at('c', '2026-08-07T08:00:00.000Z')];
    const fresh = [at('a', '2026-08-07T10:30:00.000Z')];

    expect(replaceFirstPage(shown, fresh, false).map((j) => j.id)).toEqual(['a']);
  });
});
