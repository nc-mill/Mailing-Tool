import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY, missingDependenciesOf } from '@mlain/core/queues';
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
  // `platform.maintain_partitions` z tohohle seznamu ZMIZELA i s frontou,
  // jako třetí a poslední z front kolem oddílů. Nebyla to nedodaná obsluha,
  // byla to fronta, která obsluhu mít nemohla: zakládání oddílu je DDL
  // a `mlain_app` schéma nevlastní. Zakládá i uklízí `mlain partitions`.

  // --- P07 a P11: hromadné operace nad kontakty ---------------------------
  //
  // `segments.mark_invalid` i `segments.recalc_for_contact` z tohohle seznamu
  // ZMIZELY: obě obsluhy jsou složené a vedené v `segments/jobs/queue-handlers.ts`.
  // Producenti obou front přitom existovali dřív než obsluhy, takže se do nich
  // úlohy zařazovaly a nikdo si je nevyzvedl.

  // --- P08 a P12: obsah a šablony -----------------------------------------
  'content.revalidate_templates': 'obsluhu dodá P08, modul jobu zatím není',
  'content.cleanup_versions': 'obsluhu dodá P08, modul jobu zatím není',

  // --- P13: doména kampaní ------------------------------------------------
  //
  // Čtyři fronty s prefixem `campaign.` obsluhu MAJÍ (`campaign.materialize`
  // složenou doopravdy, tři přes `needsDependencies`). Tyhle tři jsou vedle
  // toho: jméno fronty začíná jiným prefixem, takže by podle konvence
  // `handlerModulePath` patřily do `src/outbox/jobs`, `src/provider/jobs`
  // a `src/domain/jobs`. Zakládat tři nové domény jen pro hlášku o chybějící
  // závislosti nemá smysl, dokud se ta závislost nedá dodat.
  'provider.refresh_quota':
    'obsluha refreshQuotaHandler existuje, ale RefreshQuotaDeps.loadProvider musí vrátit osm ProviderSignals a repozitář má zdroj jen pro dva',
  'domain.recheck':
    'obsluha domainRecheckHandler existuje, ale DomainRecheckDeps.listDue potřebuje výčet domén napříč projekty a ten pod rolí mlain_app RLS nepustí',
  'provider_event.process': 'obsluhu dodá P13, modul jobu zatím není',
  'provider_event.rematch': 'obsluhu dodá P13, modul jobu zatím není',
  'deliverability.rollup': 'obsluhu dodá P13, modul jobu zatím není',
  // `retention.drop_message_partitions` z tohohle seznamu ZMIZELA i s frontou.
  // Nebyla to nedodaná obsluha, byla to fronta, která obsluhu mít nemohla:
  // odpojení oddílu je DDL a `mlain_app` schéma nevlastní. Úklid dělá příkaz
  // `mlain partitions` pod migrátorskou rolí.

  // --- P10: tracking a identity -------------------------------------------
  //
  // Sedm front téhle domény obsluhu MÁ. Zbylé tři jsou tady i s důvodem
  // a všechny tři mají společné to, že jim chybí ZDROJ, ne zápis.
  //
  // `event.process` z tohohle seznamu ZMIZELA: příjmový povrch `/e/**` už
  // v produktu je, veřejný klíč se ověřuje, dávka se zařadí a obsluha ji
  // zapíše do `web_events`. Ověřeno na běžící instalaci od SDK v prohlížeči
  // až po časovou osu kontaktu.
  // `tracking.enforce_retention` z tohohle seznamu ZMIZELA i s frontou, ze
  // stejného důvodu. Důvod, který tu stál („patří k migrátorovi"), byl správný
  // a přestal být výjimkou: retenci `web_events` i `message_events` dělá
  // `mlain partitions` pod migrátorskou rolí.
  'tracking.refresh_proxy_ranges':
    'stahování rozsahů Apple relay z internetu. TRACKING_APPLE_RELAY_RANGES je ve výchozím stavu vypnuté a ProxyRangeIndex si vestavěný rozsah nese sám, takže bez zdroje adres by úloha jen dělala prázdné kolo',
  // `tracking.erase_contact` z tohohle seznamu ZMIZELA i s frontou, a je to
  // správný konec téhle položky. Důvod, který tu stál, byl totiž důvod, proč
  // ta fronta nemá existovat, ne proč nemá mít obsluhu: stopu kontaktu odpojuje
  // `gdpr.sever_links` a druhá cesta k témuž by znamenala dva výklady toho, co
  // znamená vymazat kontakt. Seznam nedodaných obsluh není místo, kde se
  // schovávají fronty navíc.
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

  /**
   * ZAPOJENÍ, ne funkce.
   *
   * Předchozí testy hlídají, že se o frontě ROZHODLO. Tenhle hlídá, že u
   * vyjmenovaných front vede rozhodnutí až ke skutečně složené obsluze. Je to
   * jiná otázka než „existuje modul s logikou": moduly existovaly u všech těchhle
   * front měsíce a jejich vlastní testy byly zelené, jen je nikdo nezapsal do
   * `<domena>/jobs/queue-handlers.ts`, takže se do generované mapy nedostaly.
   *
   * Skutečná obsluha se od `needsDependencies` pozná podle značky
   * `missingDependencies`, kterou nedodaná obsluha nese. Kontrola
   * `typeof === 'function'` by obojí propustila, přestože druhá každou úlohu
   * shodí, a spustit obsluhu naprázdno jako rozlišovač nejde: obal `once`
   * (zálohy) by při tom udělal skutečnou práci.
   */
  const MUSI_BYT_ZAPOJENE: readonly string[] = [
    'platform.backup',
    'platform.backup_verify',
    'contacts.bulk_tag',
    'contacts.strip_attribute',
    'consents.rebuild_state',
    'gdpr.erase',
    'gdpr.sever_links',
    'inbound.process',
    'retention.run',
    // `tracking.rebuild_engagement` z výčtu ZMIZELA i s frontou. Nebyla to
    // nedodaná obsluha, byla to obsluha, kterou nikdo nikdy nespustil:
    // rekonstrukci dělá `mlain rebuild-engagement` přímým voláním dávkovače.
    // Tenhle výčet hlídá fronty, které MUSÍ být zapojené; fronta, která nemá
    // existovat, do něj nepatří.
    // Tlačítko a dialog v rozhraní existovaly dřív než trasa: potvrzení mazání
    // končilo na 404 a úloha se ani nezařadila. Test drží obojí pohromadě.
    'contacts.bulk_delete',
    // Zákonná lhůta podle článku 20 GDPR. Dokud nebylo úložiště, archiv se
    // sestavil a zahodil, takže navenek vypadal export jako splněný.
    'gdpr.export_subject',
    // Nová doména `tracking` v codegenu. Držená hlavně proto, že klíč
    // `./tracking/jobs` v mapě exports mířil na soubor, který neexistoval:
    // takový rozpor se pozná až při stavbě produkční image.
    'identity.merge',
    // Extrakce značky. Držená proto, že tahle fronta v mapě CELOU DOBU BYLA,
    // jen na náhradní obsluze, takže se tvářila zapojeně a v seznamu nedodaných
    // se nikdy neobjevila. Test se ptá na značku `missingDependencies`, takže
    // takový návrat pozná.
    'content.brand_extract',
    // Doména assetů. `process_asset` dnes nikdo neplní (varianty se generují
    // synchronně při nahrání), ale obsluhu mít musí: jakmile se přidá varianta
    // do registru, dogeneruje ji ke stávajícím assetům.
    'content.process_asset',
    'content.cleanup_assets',
    'content.verify_asset_refcounts',
    // Poslední čtyři fronty domény kontaktů, které do teď neměly modul jobu.
    // recompute_greeting je z nich nejcitlivější: zařazuje ho uložení nastavení
    // projektu a musí ctít zámek ručně potvrzeného oslovení.
    'contacts.recompute_greeting',
    'contacts.bulk_vocative_review',
    'contacts.refingerprint',
    'contacts.cleanup_pending',
    // Držená hlavně kvůli jménu: registr znal `build_index`, producent zařazoval
    // `verify_index`, takže úloha chodila do fronty, kterou nikdo neznal, a index
    // se tiše nepřestavoval. Jakmile by se jména zase rozešla, spadne tenhle test.
    'contact_fields.verify_index',
    // Fronty, které tenhle stav držely už dřív. Jsou tu, aby se nedaly odpojit
    // zpátky: obojí se v tomhle repozitáři už jednou stalo.
    'campaign.materialize',
    'contacts.import',
    'contacts.export',
    // Dvě fronty, které přímo souvisely s tím, že produkt neodeslal e-mail.
    // `outbox.stall_watch` je jediné místo, které si napříč instalací všimne,
    // že kampaň má co odesílat a nikdo si to nebere; přesně tenhle stav trval
    // čtyři dny, protože sender neběžel a nikde se to neprojevilo.
    // `sender.credentials_refresh` je cesta zpátky z pauzy
    // `credentials_undecryptable` a do teď neměla ani obsluhu, ani producenta.
    'outbox.stall_watch',
    'sender.credentials_refresh',
    // Řetěz měření kampaně. Otevření i proklik se do `message_events` zapisovaly
    // celou dobu správně, jenže `tracking.process_engagement` neměla obsluhu,
    // takže z těch řádků nikdo nespočítal `campaign_stats` a report ukazoval
    // samé nuly. Vypadalo to jako rozbité měření, přitom šlo o nezapojené
    // počítání. `tracking.refresh_campaign_progress` je druhá půlka téhož:
    // bez ní nevznikne řádek souhrnu vůbec, takže je nula i „doručeno"
    // a „odesláno".
    'tracking.process_engagement',
    'tracking.process_provider_events',
    'tracking.refresh_campaign_progress',
    'tracking.recompute_engagement_windows',
    'tracking.cleanup_token_uses',
    // Dvě fronty domény segmentů, které měly PRODUCENTA A ŽÁDNOU OBSLUHU.
    // `segments.recalc_for_contact` plnila každá webová událost s rozpoznaným
    // kontaktem, `segments.mark_invalid` každé smazání vlastního pole; obojí se
    // hromadilo ve frontě a nikdo si to nevyzvedl, takže se segment po události
    // nikdy nezneplatnil a segment nad smazaným polem se tvářil, že je v pořádku.
    'segments.recalc_for_contact',
    'segments.mark_invalid',
  ];

  it.each(MUSI_BYT_ZAPOJENE)('fronta %s má složenou obsluhu, ne jen záznam v mapě', (name) => {
    const handler = HANDLERS[name];
    expect(handler, `fronta ${name} v generované mapě obsluh vůbec není`).toBeTypeOf('function');
    expect(UNDELIVERED[name], `fronta ${name} má obsluhu, nesmí být v UNDELIVERED`).toBeUndefined();
    expect(registryNames, `fronta ${name} není v registru`).toContain(name);
    expect(
      missingDependenciesOf(handler!),
      `${name} má v mapě jen needsDependencies, tedy obsluhu, která každou úlohu shodí`,
    ).toBeUndefined();
  });

  /**
   * Obal `perJob` nebo `once` je POVINNÝ: pg-boss volá obsluhu s DÁVKOU úloh,
   * kdežto doménové funkce berou jednu. Bez obalu dostane funkce pole, sáhne na
   * `.data` a dostane `undefined`; fronta se přitom zaregistruje a worker
   * naběhne, takže se to pozná teprve na první skutečně zpracované úloze.
   *
   * Prázdná dávka to odhalí bez databáze: obal ji přijme a neudělá nic, kdežto
   * neobalená funkce na ní spadne.
   *
   * VYJMUTÉ JSOU OBSLUHY S OBALEM `once`, a ne proto, že by je nebylo potřeba
   * hlídat. `once` má u cronových úloh smysl přesně obrácený než `perJob`:
   * náklad je prázdný a víc úloh v dávce znamená víc tiků, ne víc práce, takže
   * obal práci NEODLOŽÍ, ale spustí ji rovnou. U záloh by to nad prázdnou
   * dávkou znamenalo skutečný dump, u úklidu nepotvrzených přihlášení sáhnutí
   * do konfigurace a databáze. Test by tedy neměřil obal, ale prostředí.
   *
   * Že jsou obalené, drží test výš přes značku `missingDependencies`; tenhle
   * měří jen tvar volání.
   */
  const OBALENE_ONCE = new Set([
    'platform.backup',
    'platform.backup_verify',
    'contacts.cleanup_pending',
    // Cronové úlohy domény assetů. Prázdná dávka by u nich spustila skutečný
    // úklid, ne jen ověřila obal.
    'content.cleanup_assets',
    'content.verify_asset_refcounts',
    // Cronový sken zaseknutých dávek. Prázdná dávka by u něj spustila skutečný
    // dotaz napříč projekty, ne ověřila obal.
    'outbox.stall_watch',
    // Tři cronové úlohy trackingu. U prázdné dávky by sáhly na výčet projektů
    // pod rolí mlain_maintenance, respektive rovnou do databáze, takže by test
    // měřil prostředí, ne obal.
    'tracking.refresh_campaign_progress',
    'tracking.recompute_engagement_windows',
    'tracking.cleanup_token_uses',
  ]);
  const OBALENE_PER_JOB: readonly string[] = MUSI_BYT_ZAPOJENE.filter(
    (name) => !OBALENE_ONCE.has(name),
  );

  it.each(OBALENE_PER_JOB)('obsluha %s bere dávku úloh, ne jednu úlohu', async (name) => {
    await expect(
      HANDLERS[name]!([]),
      `${name} nejspíš není obalená perJob: prázdná dávka ji shodila`,
    ).resolves.toBeUndefined();
  });

  it('registr ani mapa obsluh nemá duplicity', () => {
    expect(new Set(registryNames).size).toBe(registryNames.length);
    for (const name of Object.keys(HANDLERS)) {
      expect(registryNames, `obsluha ${name} nemá frontu v registru`).toContain(name);
    }
  });
});
