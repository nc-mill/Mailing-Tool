import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY } from '@mlain/core/queues';
import { HANDLERS } from '../src/handlers.generated';

/**
 * Pojistka proti vadě, která se v tomhle repozitáři zopakovala třikrát: obsluha
 * fronty existuje, má vlastní zelené testy, a NIKDO ji nezaregistroval.
 *
 * Nic přitom nespadne. `registerQueues` frontu bez obsluhy schválně stejně
 * založí (jinak by doménový plán dostal při prvním `send` chybu o neexistující
 * frontě a nepoznal by, že jde jen o nedodanou obsluhu), vypíše o tom jednu
 * řádku do logu a jede dál. Úloha se zařadí, nikdo si ji nevyzvedne a operace,
 * kterou měla dokončit, zůstane viset navždy. Stalo se to u importu a exportu
 * kontaktů (codegen nehledal ve druhé úrovni) a naposledy u CELÉ domény
 * kampaní, kde chyběl soubor `queue-handlers.ts`, takže se kampaň nikdy
 * neodeslala.
 *
 * Tenhle test žádnou obsluhu nevynucuje. Vynucuje ROZHODNUTÍ: fronta má buď
 * obsluhu, nebo je tady vypsaná i s důvodem, proč ji nemá. Nová fronta v
 * registru shodí test do doby, než se jedno z toho stane.
 */

/**
 * Fronty vědomě bez obsluhy v tomhle buildu, s důvodem.
 *
 * Důvod není omluva, je to informace pro toho, kdo bude frontu zapojovat.
 * Rozlišuje dva různé stavy: „obsluhu nikdo nenapsal" a „obsluha existuje,
 * ale nejde jí složit závislosti". Ten druhý je horší, protože vypadá jako
 * hotová práce.
 */
const UNDELIVERED: Readonly<Record<string, string>> = {
  // --- P16 a P04: obsluha zatím neexistuje --------------------------------
  'platform.maintain_partitions': 'obsluhu dodá P03, modul jobu zatím není',
  'platform.backup': 'obsluhu dodá P16, modul jobu zatím není',
  'platform.backup_verify': 'obsluhu dodá P16, modul jobu zatím není',

  // --- P07 a P11: hromadné operace nad kontakty ---------------------------
  'contacts.bulk_delete': 'obsluhu dodá P07, modul jobu zatím není',
  'contacts.bulk_tag': 'obsluhu dodá P07, modul jobu zatím není',
  'contacts.bulk_vocative_review': 'obsluhu dodá P07, modul jobu zatím není',
  'contacts.strip_attribute': 'obsluhu dodá P07, modul jobu zatím není',
  'contacts.refingerprint': 'obsluhu dodá P07, modul jobu zatím není',
  'contacts.recompute_greeting': 'obsluhu dodá P07, modul jobu zatím není',
  'contacts.cleanup_pending': 'obsluhu dodá P07, modul jobu zatím není',
  'contact_fields.build_index': 'obsluhu dodá P07, modul jobu zatím není',
  'consents.rebuild_state': 'obsluhu dodá P07, modul jobu zatím není',
  'gdpr.export_subject': 'obsluhu dodá P07, modul jobu zatím není',
  'gdpr.erase': 'obsluhu dodá P07, modul jobu zatím není',
  'gdpr.sever_links': 'obsluhu dodá P07, modul jobu zatím není',
  'inbound.process': 'obsluhu dodá P07, modul jobu zatím není',
  'retention.run': 'obsluhu dodá P07, modul jobu zatím není',
  'segments.mark_invalid': 'obsluhu dodá P11, modul jobu zatím není',
  'segments.recalc_for_contact': 'obsluhu dodá P11, modul jobu zatím není',

  // --- P08 a P12: obsah a šablony -----------------------------------------
  'content.process_asset': 'obsluhu dodá P08, modul jobu zatím není',
  'content.revalidate_templates': 'obsluhu dodá P08, modul jobu zatím není',
  'content.cleanup_versions': 'obsluhu dodá P08, modul jobu zatím není',
  'content.cleanup_assets': 'obsluhu dodá P08, modul jobu zatím není',
  'content.verify_asset_refcounts': 'obsluhu dodá P08, modul jobu zatím není',

  // --- P13: doména kampaní ------------------------------------------------
  //
  // Čtyři fronty s prefixem `campaign.` obsluhu MAJÍ (`campaign.materialize`
  // složenou doopravdy, tři přes `needsDependencies`). Tyhle tři jsou vedle
  // toho: jméno fronty začíná jiným prefixem, takže by podle konvence
  // `handlerModulePath` patřily do `src/outbox/jobs`, `src/provider/jobs`
  // a `src/domain/jobs`. Zakládat tři nové domény jen pro hlášku o chybějící
  // závislosti nemá smysl, dokud se ta závislost nedá dodat.
  'outbox.stall_watch': 'obsluhu dodá P13, modul jobu zatím není',
  'outbox.reconcile':
    'obsluha reconcileHandler existuje, ale ReconcileDeps.listWorkspaces potřebuje výčet projektů napříč instalací a ten pod rolí mlain_app RLS nepustí',
  'provider.refresh_quota':
    'obsluha refreshQuotaHandler existuje, ale RefreshQuotaDeps.loadProvider musí vrátit osm ProviderSignals a repozitář má zdroj jen pro dva',
  'domain.recheck':
    'obsluha domainRecheckHandler existuje, ale DomainRecheckDeps.listDue potřebuje výčet domén napříč projekty a ten pod rolí mlain_app RLS nepustí',
  'provider_event.process': 'obsluhu dodá P13, modul jobu zatím není',
  'provider_event.rematch': 'obsluhu dodá P13, modul jobu zatím není',
  'deliverability.rollup': 'obsluhu dodá P13, modul jobu zatím není',
  'retention.drop_message_partitions': 'obsluhu dodá P13, modul jobu zatím není',

  // --- P10: tracking a identity -------------------------------------------
  'tracking.process_engagement': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.process_provider_events': 'obsluhu dodá P10, modul jobu zatím není',
  'event.process': 'obsluhu dodá P10, modul jobu zatím není',
  'identity.merge': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.refresh_campaign_progress': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.recompute_engagement_windows': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.cleanup_token_uses': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.enforce_retention': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.refresh_proxy_ranges': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.erase_contact': 'obsluhu dodá P10, modul jobu zatím není',
  'tracking.rebuild_engagement': 'obsluhu dodá P10, modul jobu zatím není',

  // --- P09: sender --------------------------------------------------------
  'sender.credentials_refresh': 'obsluhu dodá P09, modul jobu zatím není',
};

const registryNames = QUEUE_REGISTRY.map((entry) => entry.name);

describe('pokrytí front obsluhami', () => {
  it('každá fronta z registru má obsluhu, nebo je vedená jako nedodaná i s důvodem', () => {
    const nerozhodnute = registryNames.filter(
      (name) => typeof HANDLERS[name] !== 'function' && UNDELIVERED[name] === undefined,
    );
    expect(
      nerozhodnute,
      'fronta bez obsluhy, která není vedená v UNDELIVERED: úloha se do ní zařadí a nikdo si ji nevyzvedne',
    ).toEqual([]);
  });

  it('seznam nedodaných obsluh nezastarává', () => {
    // Fronta, která obsluhu MEZITÍM dostala, musí ze seznamu zmizet. Jinak by
    // se seznam za půl roku četl jako popis stavu, kterým dávno není.
    const uzMaHandler = Object.keys(UNDELIVERED).filter(
      (name) => typeof HANDLERS[name] === 'function',
    );
    expect(uzMaHandler, 'tahle fronta už obsluhu má, vyškrtni ji z UNDELIVERED').toEqual([]);

    // A naopak: seznam nesmí mluvit o frontě, která v registru není.
    const neznama = Object.keys(UNDELIVERED).filter((name) => !registryNames.includes(name));
    expect(neznama, 'tahle fronta v registru není, vyškrtni ji z UNDELIVERED').toEqual([]);
  });

  it('každý důvod je vysvětlení, ne prázdný řádek', () => {
    for (const [name, reason] of Object.entries(UNDELIVERED)) {
      expect(reason.length, `${name} má prázdný důvod`).toBeGreaterThan(20);
    }
  });

  /**
   * Doména kampaní je tady jmenovitě, protože právě u ní tahle vada zastavila
   * celý produkt: fronty se registrovaly bez obsluhy a kampaň se nikdy
   * neodeslala. Obecné pravidlo výš by tenhle stav propustilo, kdyby někdo
   * všechny čtyři fronty zapsal do UNDELIVERED.
   */
  it('campaign.materialize má obsluhu, jinak se kampaň nikdy neodešle', () => {
    expect(HANDLERS['campaign.materialize']).toBeTypeOf('function');
    expect(UNDELIVERED['campaign.materialize']).toBeUndefined();
  });

  it('registr ani mapa obsluh nemá duplicity', () => {
    expect(new Set(registryNames).size).toBe(registryNames.length);
    for (const name of Object.keys(HANDLERS)) {
      expect(registryNames, `obsluha ${name} nemá frontu v registru`).toContain(name);
    }
  });
});
