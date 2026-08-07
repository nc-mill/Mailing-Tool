import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY } from '../../src/queues/registry';
import type { QueueEntry } from '../../src/queues/types';
import {
  RAW_INSERT_FILES,
  RAW_INSERT_PRODUCERS,
  UNRESOLVED_ALLOWLIST,
  scanProducers,
} from './producer-scan';

/**
 * BRÁNA PROTI TICHÉMU ROZCHODU SLUČOVÁNÍ.
 *
 * Slučování duplicitních úloh stojí na DVOU nezávislých polovinách:
 *
 *   1. fronta musí v `pgboss.queue` mít jinou politiku než `standard`,
 *   2. producent musí posílat `singletonKey`.
 *
 * Když jedna z nich chybí, nespadne nic. Úloha se zařadí, doběhne, log mlčí,
 * jen se nic neslučuje. Přesně tak to v produktu vypadalo: 47 front klíč
 * deklarovalo, producenti ho posílali, a všech 99 front v databázi mělo
 * `policy = 'standard'`, pro kterou pg-boss klíč IGNORUJE. Nikdo ty dvě
 * poloviny nespojil, a proto se to rozešlo.
 *
 * Tenhle soubor je spojuje. Není to test registru ani test producentů; je to
 * test toho, že spolu souhlasí.
 */

const withTemplate = QUEUE_REGISTRY.filter((entry) => entry.singletonKeyTemplate !== undefined);

/**
 * Fronta, jejímž producentem je PLÁNOVAČ pg-bossu, ne kód produktu.
 *
 * Tik z cronu vzniká v `timekeeper.js` a `singletonKey` NEMÁ, do sloupce jde
 * NULL. Slučovací indexy klíč berou jako `COALESCE(singleton_key, '')`, takže
 * všechny tiky jedné fronty spadnou do jednoho kbelíku, a to je přesně to,
 * co `global` znamená. Producenta v repozitáři tedy hledat nemá smysl.
 */
function scheduledGlobal(entry: QueueEntry): boolean {
  return entry.cron !== undefined && entry.singletonKeyTemplate === 'global';
}

describe('slučování duplicitních úloh, registr', () => {
  it('má u každé fronty s klíčem nebo politikou napsané, co se stane se zahozenou úlohou', () => {
    for (const entry of QUEUE_REGISTRY) {
      if (entry.singletonKeyTemplate === undefined && entry.policy === undefined) {
        expect(
          entry.discardNote,
          `${entry.name}: discardNote bez klíče i politiky`,
        ).toBeUndefined();
        continue;
      }
      // Krátká věta typu „je to v pořádku" nestačí. Rozdíl mezi neškodným
      // zahozením úklidu a zahozenou žádostí podle článku 17 se do deseti
      // znaků nevejde, a právě ten rozdíl je důvod, proč se to píše.
      expect(entry.discardNote?.length ?? 0, `${entry.name}: chybí discardNote`).toBeGreaterThan(
        80,
      );
    }
  });

  it('nezapíná politiku u fronty, která žádný klíč nedeklaruje', () => {
    for (const entry of QUEUE_REGISTRY) {
      if (entry.policy === undefined) continue;
      expect(entry.singletonKeyTemplate, `${entry.name}: politika bez klíče`).toBeDefined();
    }
  });

  it('nepoužívá key_strict_fifo, protože by shodilo tiky z cronu', () => {
    // Politika vynucuje `singletonKey` u KAŽDÉ úlohy tabulkovým CHECKem
    // (`job_key_strict_fifo_singleton_key_check`), jenže plánovač pg-bossu
    // vkládá NULL. Zapnout ji nad cronovou frontou znamená, že se tik nezařadí
    // a vyhodí chybu. Navíc blokuje klíč i ve stavu `failed`.
    for (const entry of QUEUE_REGISTRY) {
      expect(entry.policy, `${entry.name}`).not.toBe('key_strict_fifo');
    }
  });

  it('nedává politiku dead letter frontám', () => {
    // Dead letter fronty se zakládají v workeru zvlášť a politiku nedostávají.
    // Slučovat nedoručitelné úlohy by znamenalo tiše zahazovat právě to, co se
    // má vyšetřit. Registr je nezná, takže stačí ověřit, že se nepřidaly.
    expect(
      QUEUE_REGISTRY.map((entry) => entry.name).filter((name) => name.endsWith('.dlq')),
    ).toEqual([]);
  });
});

describe('slučování duplicitních úloh, sken producentů', () => {
  it('přečte každé volání zařazovače, nebo ho pojmenuje', () => {
    const scan = scanProducers();
    expect(scan.unresolved.sort()).toEqual(Object.keys(UNRESOLVED_ALLOWLIST).sort());
  });

  it('zná každý soubor, který si do tabulky úloh píše vlastním SQL', () => {
    // Nový soubor s vlastním insertem je nová cesta do fronty, kterou sken
    // volání nevidí. Kdyby se sem nedoplnil, vypadala by fronta jako fronta
    // bez producenta a brána by u ní slučování zakázala, ačkoli producenta má.
    const scan = scanProducers();
    expect(scan.rawInsertFiles).toEqual(Object.keys(RAW_INSERT_FILES).sort());
  });

  it('nemá přejmenovaný import zařazovače, o kterém by sken nevěděl', () => {
    expect(scanProducers().unknownAliases).toEqual([]);
  });

  it('má u každého ručně zařazeného producenta uvedený důvod', () => {
    for (const [file, spec] of Object.entries(UNRESOLVED_ALLOWLIST)) {
      expect(spec.why.length, `${file}`).toBeGreaterThan(40);
    }
    for (const spec of RAW_INSERT_PRODUCERS) {
      expect(spec.why.length, `${spec.queue}`).toBeGreaterThan(40);
    }
  });
});

describe('slučování duplicitních úloh, obě poloviny dohromady', () => {
  /**
   * TOHLE JE TA BRÁNA.
   *
   * Fronta, jejíž producent klíč posílá, MUSÍ mít politiku, jinak se klíč
   * zahazuje do prázdna. Fronta, jejíž producent klíč NEPOSÍLÁ, politiku mít
   * NESMÍ, protože všechny její úlohy by spadly do jednoho kbelíku
   * `COALESCE(singleton_key, '')` a slučovaly by se navzájem věci, které spolu
   * nesouvisí. Obojí je vada a obojí tady spadne.
   */
  it('zapíná politiku právě tam, kde producent klíč doopravdy posílá', () => {
    const scan = scanProducers();
    const wrong: string[] = [];

    for (const entry of withTemplate) {
      const counts = scan.byQueue.get(entry.name);
      const shouldMerge =
        scheduledGlobal(entry) ||
        (counts !== undefined && counts.keyed > 0 && counts.keyless === 0);
      const doesMerge = entry.policy !== undefined;

      if (shouldMerge === doesMerge) continue;
      wrong.push(
        shouldMerge
          ? `${entry.name}: producent klíč posílá, ale fronta nemá politiku, takže se ` +
              'neslučuje. Doplň policy do registru.'
          : `${entry.name}: fronta má politiku ${String(entry.policy)}, ale producent klíč ` +
              `neposílá (klíčovaných volání ${counts?.keyed ?? 0}, bezklíčových ` +
              `${counts?.keyless ?? 0}). Slučovaly by se nesouvisející úlohy.`,
      );
    }

    expect(wrong).toEqual([]);
  });

  /**
   * Druhý směr téže brány, a je to ten důležitější.
   *
   * U front, kde slučování zapnuté není, je důvodem chybějící klíč u producenta
   * nebo chybějící producent. Až to někdo opraví, musí se politika ZAPNOUT,
   * jinak se oprava ztratí. Test výš to zajistí sám, protože se ta fronta
   * překlopí do kategorie „producent klíč posílá". Tenhle test to jen říká
   * nahlas: seznam vypnutých front je uzavřený a jeho zmenšení je změna,
   * kterou musí někdo vidět.
   */
  it('má uzavřený seznam front, u kterých se slučování schválně nezaplo', () => {
    const off = withTemplate.filter((entry) => entry.policy === undefined).map((e) => e.name);
    expect(off.sort()).toEqual(
      [
        // Producent existuje, ale klíč neposílá. Oprava je na doménovém vlastníkovi.
        'contact_fields.verify_index',
        'gdpr.erase',
        'gdpr.export_subject',
        'gdpr.sever_links',
        // Producent v repozitáři není vůbec: obsluha existuje, ale nikdo do fronty
        // nezařazuje, takže se tvar klíče nedá ověřit.
        //
        // `platform.webhook_deliver` z tohohle seznamu ZMIZELA a je to ta správná
        // cesta ven: producent vznikl (`fanoutEvent` a `platform.webhook_retry`),
        // takže si test výš politiku vynutil sám. Přesně tak to má fungovat.
        'consents.rebuild_state',
        'content.process_asset',
        'inbound.process',
        'provider_event.process',
        // `tracking.erase_contact` z tohohle seznamu ZMIZELA i s frontou. Nebyla
        // to fronta bez producenta, byla to druhá cesta k témuž: stopu kontaktu
        // odpojuje `gdpr.sever_links`, kterou oba producenti výmazu volají.
        //
        // `tracking.rebuild_engagement` ZMIZELA taky, a ze stejného rodu důvodů:
        // rekonstrukci dělá `mlain rebuild-engagement` přímým voláním dávkovače,
        // takže fronta nebyla odložená funkce, ale nespuštěná druhá cesta.
      ].sort(),
    );
  });

  it('u každé zapnuté fronty říká, co se stane se zahozenou úlohou', () => {
    for (const entry of QUEUE_REGISTRY) {
      if (entry.policy === undefined) continue;
      expect(entry.discardNote, `${entry.name}`).toBeDefined();
    }
  });
});
