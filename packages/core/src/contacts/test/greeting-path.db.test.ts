import { createHtmlEngine } from '@mlain/contracts/liquid/engine';
import { describe, expect, it } from 'vitest';
import { contactPreviewData } from '../../templates/api/preview-data';
import { withWorkspace } from '../../tx';
import { recomputeGreeting } from '../jobs/recompute-greeting';
import { subscribeToList } from '../lists/subscribe-service';
import { clearGreetingOverride, setGreetingOverride } from '../repo/greeting-override';
import { upsertContacts, writeContact } from '../repo/contacts';
import { asMigrator, createList, findByEmail, testContext } from './support/db';

/**
 * CELÁ CESTA OD ULOŽENÍ KONTAKTU PO TVAR V NÁHLEDU ŠABLONY.
 *
 * Tenhle soubor vznikl z konkrétního hlášení: „Uložím kontakt Petr Novák a v šablonách,
 * když se podívám na náhled, kde by mělo být oslovení v 5. pádě, mi to stejně zobrazí
 * Dobrý den, Petr." Funkce na vokativ přitom fungovala a měla vlastní zelené testy.
 * Rozbité bylo PROPOJENÍ, a to testy jednotlivých funkcí ukázat neumí.
 *
 * Proto se tady netvrdí nic o mezikrocích. Kontakt se uloží skutečnou cestou zápisu,
 * data náhledu se přečtou skutečnou funkcí `contactPreviewData` a text se vyrenderuje
 * skutečným Liquid strojem, tedy trojicí, kterou používá endpoint
 * `POST /templates/{id}/preview`. Tvrdí se o výsledném řetězci.
 */

/** Tělo odstavce tak, jak ho skládá ukázková šablona: JEDINÁ značka, hotová věta. */
const CORRECT_TEMPLATE = '{{ contact.greeting }}, tady je přehled toho, co je u nás nového.';

/**
 * Tělo, které si uživatel složil sám v editoru: literál s čárkou plus surovina.
 * Přesně tohle bylo v jeho šabloně v databázi a přesně tohle vyrábí hlášený příznak.
 */
const FRAGMENT_TEMPLATE = 'Dobrý den,{{ contact.first_name_vocative }} tady je přehled.';

async function renderFor(
  ctx: Awaited<ReturnType<typeof testContext>>,
  contactId: string,
  template: string,
): Promise<string> {
  const data = await withWorkspace(ctx, (tx) => contactPreviewData(tx, ctx, 'cs', contactId));
  if (data === null) throw new Error('kontakt pro náhled nenalezen');
  return createHtmlEngine().parseAndRender(template, data as unknown as Record<string, unknown>);
}

/**
 * Jazyk projektu se přepíná pod migrátorskou rolí, protože `testContext` zakládá
 * projekt vždycky s češtinou. Reprodukce hlášené vady ale potřebuje projekt
 * v angličtině, tedy přesně to, co vzniklo z průvodce prvním spuštěním.
 */
async function setWorkspaceLocale(
  ctx: Awaited<ReturnType<typeof testContext>>,
  locale: string,
): Promise<void> {
  await asMigrator().query('UPDATE workspaces SET locale = $1 WHERE id = $2', [
    locale,
    ctx.workspaceId,
  ]);
}

describe('od uložení kontaktu po tvar v náhledu šablony', () => {
  it('kontakt Petr Novák v českém projektu vyjde v náhledu jako „Dobrý den, Petře“', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'petr.cesky@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    // Nejdřív co je ve sloupcích. Kdyby se ptalo jen na náhled, nešlo by rozlišit
    // „nespočítal se vokativ" od „náhled bere jiné pole".
    const row = await findByEmail(ctx, 'petr.cesky@example.cz');
    expect(row.first_name_vocative).toBe('Petře');
    expect(row.greeting).toBe('Dobrý den, Petře');

    expect(await renderFor(ctx, written.id, CORRECT_TEMPLATE)).toBe(
      'Dobrý den, Petře, tady je přehled toho, co je u nás nového.',
    );
  });

  /**
   * REPRODUKCE HLÁŠENÉ VADY, obě její poloviny najednou.
   *
   * Projekt založený s jazykem `en` uloží kontaktu `locale = 'en'`. Vokativ se
   * v jazyce bez 5. pádu NEPOČÍTÁ, do sloupce se uloží nominativ a jistota zůstane
   * `high`, takže nic nevypadá rozbitě. Šablona složená z literálu „Dobrý den,"
   * a značky `contact.first_name_vocative` pak vyrenderuje přesně to, co uživatel
   * hlásil.
   */
  it('projekt v angličtině vyrobí „Dobrý den,Petr“, i když je značka pojmenovaná „v 5. pádu“', async () => {
    const ctx = await testContext();
    await setWorkspaceLocale(ctx, 'en');

    const written = await writeContact(ctx, {
      email: 'petr.anglicky@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    const row = await findByEmail(ctx, 'petr.anglicky@example.cz');
    expect(row.locale).toBe('en');
    expect(row.first_name_vocative).toBe('Petr');
    expect(row.vocative_confidence).toBe('high');

    expect(await renderFor(ctx, written.id, FRAGMENT_TEMPLATE)).toBe(
      'Dobrý den,Petr tady je přehled.',
    );
  });

  /**
   * DRUHÁ POLOVINA TÉŽE VADY: i kdyby se vokativ spočítal správně, šablona složená
   * z fragmentů vyrobí u kontaktu bez jména visící čárku. Hotová věta ze sloupce
   * `greeting` ji vyrobit NEUMÍ, protože `buildGreeting` spadne na neutrální
   * oslovení bez čárky. Tohle je důvod, proč nabídka značek napříště doporučuje
   * pole Oslovení.
   */
  it('u kontaktu bez jména vyrobí fragmentová šablona visící čárku, hotové oslovení ne', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'objednavky@example.cz',
      firstName: null,
      lastName: null,
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    expect(await renderFor(ctx, written.id, FRAGMENT_TEMPLATE)).toBe('Dobrý den, tady je přehled.');
    expect(await renderFor(ctx, written.id, CORRECT_TEMPLATE)).toBe(
      'Dobrý den, tady je přehled toho, co je u nás nového.',
    );

    // A hlavně: ve sloupci není „Dobrý den, " s visící čárkou.
    expect((await findByEmail(ctx, 'objednavky@example.cz')).greeting).toBe('Dobrý den');
  });
});

describe('ruční oprava oslovení dojde až do náhledu', () => {
  it('zapsaný tvar se objeví v náhledu a kontakt se zamkne', async () => {
    const ctx = await testContext();
    await setWorkspaceLocale(ctx, 'en');
    const written = await writeContact(ctx, {
      email: 'petr.oprava@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    // Výchozí stav je ten hlášený: nominativ.
    expect(await renderFor(ctx, written.id, CORRECT_TEMPLATE)).toContain('Hello Petr');

    const updated = await setGreetingOverride(ctx, written.id, { firstNameVocative: 'Petře' });
    expect(updated).not.toBeNull();
    expect(updated!.vocative_locked).toBe(true);
    expect(updated!.vocative_confidence).toBe('high');

    // Oslovení se PŘEPOČÍTALO, nezůstala v něm stará věta.
    const row = await findByEmail(ctx, 'petr.oprava@example.cz');
    expect(row.first_name_vocative).toBe('Petře');
    expect(row.greeting).toBe('Hello Petře');
    expect(await renderFor(ctx, written.id, CORRECT_TEMPLATE)).toBe(
      'Hello Petře, tady je přehled toho, co je u nás nového.',
    );
  });

  /**
   * SMYSL CELÉHO ZÁMKU. Kdyby ho import přepsal, byla by ruční oprava k ničemu:
   * první nahrání souboru se stejným jménem by ji smazalo a uživatel by o tom
   * nevěděl.
   */
  it('pozdější import zamknutý tvar NEPŘEPÍŠE', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'petr.zamek@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    await setGreetingOverride(ctx, written.id, { firstNameVocative: 'Peťulko' });

    await upsertContacts(ctx, {
      rows: [
        {
          email: 'petr.zamek@example.cz',
          firstName: 'Petr',
          lastName: 'Novák',
          firstNameVocative: 'Petře',
          greeting: 'Dobrý den, Petře',
          greetingNeutral: 'Dobrý den',
          attributes: {},
        },
      ],
      mode: 'update',
    });

    const row = await findByEmail(ctx, 'petr.zamek@example.cz');
    expect(row.first_name_vocative).toBe('Peťulko');
    expect(row.vocative_locked).toBe(true);
  });

  it('prázdný tvar znamená oslovit bez jména, ne visící čárku', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'petr.bezjmena@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    await setGreetingOverride(ctx, written.id, { firstNameVocative: '   ' });

    const row = await findByEmail(ctx, 'petr.bezjmena@example.cz');
    expect(row.first_name_vocative).toBeNull();
    expect(row.greeting).toBe('Dobrý den');
    expect(await renderFor(ctx, written.id, CORRECT_TEMPLATE)).toBe(
      'Dobrý den, tady je přehled toho, co je u nás nového.',
    );
  });

  it('zrušení ručního tvaru vrátí kontakt pod automatický výpočet', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'petr.zpet@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    await setGreetingOverride(ctx, written.id, { firstNameVocative: 'Peťulko' });
    const released = await clearGreetingOverride(ctx, written.id);

    expect(released).not.toBeNull();
    expect(released!.vocative_locked).toBe(false);
    const row = await findByEmail(ctx, 'petr.zpet@example.cz');
    expect(row.first_name_vocative).toBe('Petře');
    expect(row.greeting).toBe('Dobrý den, Petře');
  });

  it('neexistující kontakt vrací null, ne výjimku', async () => {
    const ctx = await testContext();
    expect(
      await setGreetingOverride(ctx, '00000000-0000-0000-0000-000000000000', {
        firstNameVocative: 'Petře',
      }),
    ).toBeNull();
  });
});

/**
 * REPRODUKCE HLÁŠENÉ VADY „přesun kontaktů do seznamu shodí oslovení".
 *
 * Doslovné hlášení: „Když přesunu kontakty do seznamu, tak najednou je oslovení
 * u všech oštítkováno (bez 5. pádu), přitom ho mají."
 *
 * Příznak byl v odznaku, ne v samotné větě: hromadné přidání do seznamu shodilo
 * `vocative_locked`, odznak spadl ze stavu „Potvrzeno ručně" na „Bez 5. pádu"
 * a jediná náprava byla otevřít kontakt a tvar uložit znovu. V auditu po sobě
 * operace nechala `contact.vocative_lock_released` s důvodem `name_changed`,
 * přestože se jméno nezměnilo.
 *
 * Testuje se SKUTEČNOU cestou zápisu (`subscribeToList`, tedy to, co pod sebou
 * volá `POST /lists/{id}/subscribe:bulk`), ne čistou funkcí: vada byla právě
 * v propojení, kde se `undefined` cestou k zápisu změnilo na `null`.
 */
describe('přihlášení do seznamu se oslovení nedotkne', () => {
  async function auditReleases(ctx: Awaited<ReturnType<typeof testContext>>): Promise<number> {
    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_log
        WHERE workspace_id = $1 AND action = 'contact.vocative_lock_released'`,
      [ctx.workspaceId],
    );
    return Number(rows[0]!.count);
  }

  it('hromadné přidání do seznamu nechá zamknutý tvar i odznak beze změny', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'petr.seznam@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    await setGreetingOverride(ctx, written.id, { firstNameVocative: 'Petře' });
    const before = await findByEmail(ctx, 'petr.seznam@example.cz');
    expect(before.vocative_locked).toBe(true);
    expect(before.greeting).toBe('Dobrý den, Petře');
    const releasesBefore = await auditReleases(ctx);

    const list = await createList(ctx, { name: 'Novinky' });
    // Přesně to, co posílá hromadná akce z tabulky kontaktů: jen adresa, žádné jméno.
    const result = await subscribeToList(ctx, {
      listId: list.id,
      email: 'petr.seznam@example.cz',
      source: 'api',
    });
    expect(result.contactId).toBe(written.id);

    const after = await findByEmail(ctx, 'petr.seznam@example.cz');
    expect(after.first_name).toBe('Petr');
    expect(after.first_name_vocative).toBe('Petře');
    expect(after.greeting).toBe('Dobrý den, Petře');
    expect(after.vocative_confidence).toBe('high');
    // Jádro vady: zámek přežil, takže odznak dál říká „Potvrzeno ručně".
    expect(after.vocative_locked).toBe(true);
    expect(await auditReleases(ctx)).toBe(releasesBefore);
  });

  it('přihlášení nezmění ani spočítaný tvar u kontaktu bez zámku', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'jana.seznam@example.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');
    const before = await findByEmail(ctx, 'jana.seznam@example.cz');
    expect(before.first_name_vocative).toBe('Jano');

    const list = await createList(ctx, { name: 'Novinky bez zámku' });
    await subscribeToList(ctx, {
      listId: list.id,
      email: 'jana.seznam@example.cz',
      source: 'api',
    });

    const after = await findByEmail(ctx, 'jana.seznam@example.cz');
    expect(after.first_name_vocative).toBe('Jano');
    expect(after.greeting).toBe(before.greeting);
    expect(after.vocative_confidence).toBe(before.vocative_confidence);
  });

  it('přihlášení nepřepíše jazyk kontaktu jazykem projektu', async () => {
    const ctx = await testContext();
    await setWorkspaceLocale(ctx, 'en');
    const written = await writeContact(ctx, {
      email: 'petr.jazyk@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      locale: 'cs',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');
    expect((await findByEmail(ctx, 'petr.jazyk@example.cz')).greeting).toBe('Dobrý den, Petře');

    const list = await createList(ctx, { name: 'Novinky jazyk' });
    await subscribeToList(ctx, { listId: list.id, email: 'petr.jazyk@example.cz', source: 'api' });

    const after = await findByEmail(ctx, 'petr.jazyk@example.cz');
    expect(after.locale).toBe('cs');
    expect(after.greeting).toBe('Dobrý den, Petře');
  });

  /**
   * Zámek chrání i HOTOVOU VĚTU. Import se stejným jménem dřív nechal zamknutý tvar
   * ve sloupci vokativu, ale větu v `greeting` přepsal automatickým výpočtem, takže
   * kontakt měl uložené „Peťulko" a rozeslalo se mu „Dobrý den, Petře".
   */
  it('import nepřepíše ani větu zamknutého kontaktu', async () => {
    const ctx = await testContext();
    const written = await writeContact(ctx, {
      email: 'petr.veta@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');
    await setGreetingOverride(ctx, written.id, { firstNameVocative: 'Peťulko' });

    await upsertContacts(ctx, {
      rows: [
        {
          email: 'petr.veta@example.cz',
          firstName: 'Petr',
          lastName: 'Novák',
          firstNameVocative: 'Petře',
          greeting: 'Dobrý den, Petře',
          greetingNeutral: 'Dobrý den',
          attributes: {},
        },
      ],
      mode: 'update',
    });

    const row = await findByEmail(ctx, 'petr.veta@example.cz');
    expect(row.first_name_vocative).toBe('Peťulko');
    expect(row.greeting).toBe('Dobrý den, Peťulko');
  });
});

/**
 * DRUHÁ HLÁŠENÁ VADA: „když ho uložím a zamknu, tak se mi tam zobrazí Oslovujeme
 * 'Hello Petře'. Místo Dobrý den, Petře."
 *
 * Kontakty zdědily `locale = 'en'` z projektu, který vznikl anglickým průvodcem.
 * Oslovení se proto skládalo anglickou předlohou, zatímco 5. pád byl český.
 * Opravou je sjednocení jazyka, které přepočítá i vokativ.
 */
describe('sjednocení jazyka oslovení', () => {
  it('z „Hello Petře" udělá „Dobrý den, Petře" a zamknutý tvar nechá být', async () => {
    const ctx = await testContext();
    await setWorkspaceLocale(ctx, 'en');
    const written = await writeContact(ctx, {
      email: 'petr.align@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');
    await setGreetingOverride(ctx, written.id, { firstNameVocative: 'Petře' });
    expect((await findByEmail(ctx, 'petr.align@example.cz')).greeting).toBe('Hello Petře');

    await setWorkspaceLocale(ctx, 'cs');
    await recomputeGreeting({
      workspaceId: ctx.workspaceId,
      alignLocale: { to: 'cs', from: 'en' },
    });

    const row = await findByEmail(ctx, 'petr.align@example.cz');
    expect(row.locale).toBe('cs');
    expect(row.greeting).toBe('Dobrý den, Petře');
    // Ručně potvrzený tvar ani zámek se nepřepsaly.
    expect(row.first_name_vocative).toBe('Petře');
    expect(row.vocative_locked).toBe(true);
  });

  it('kontaktu bez zámku dopočítá 5. pád, který v angličtině nikdy nevznikl', async () => {
    const ctx = await testContext();
    await setWorkspaceLocale(ctx, 'en');
    const written = await writeContact(ctx, {
      email: 'jana.align@example.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');
    const before = await findByEmail(ctx, 'jana.align@example.cz');
    expect(before.first_name_vocative).toBe('Jana');
    expect(before.greeting).toBe('Hello Jana');

    await setWorkspaceLocale(ctx, 'cs');
    await recomputeGreeting({
      workspaceId: ctx.workspaceId,
      alignLocale: { to: 'cs', from: 'en' },
    });

    const row = await findByEmail(ctx, 'jana.align@example.cz');
    expect(row.locale).toBe('cs');
    expect(row.first_name_vocative).toBe('Jano');
    expect(row.greeting).toBe('Dobrý den, Jano');
  });

  it('kontakt s vlastním jazykem se sjednocením podle starého jazyka projektu nemění', async () => {
    const ctx = await testContext();
    await setWorkspaceLocale(ctx, 'en');
    const written = await writeContact(ctx, {
      email: 'peter.align@example.sk',
      firstName: 'Peter',
      lastName: 'Novák',
      locale: 'sk',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');
    const before = await findByEmail(ctx, 'peter.align@example.sk');
    expect(before.greeting).toContain('Dobrý deň');

    await setWorkspaceLocale(ctx, 'cs');
    await recomputeGreeting({
      workspaceId: ctx.workspaceId,
      alignLocale: { to: 'cs', from: 'en' },
    });

    const row = await findByEmail(ctx, 'peter.align@example.sk');
    expect(row.locale).toBe('sk');
    expect(row.greeting).toBe(before.greeting);
    expect(row.first_name_vocative).toBe(before.first_name_vocative);
  });

  it('bez sjednocení jazyka se přepočet vokativu ani jazyka nedotkne', async () => {
    const ctx = await testContext();
    await setWorkspaceLocale(ctx, 'en');
    const written = await writeContact(ctx, {
      email: 'petr.jenveta@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
      attributes: {},
    });
    if (written.rejected !== null) throw new Error('kontakt byl potlačený');

    await recomputeGreeting({ workspaceId: ctx.workspaceId });

    const row = await findByEmail(ctx, 'petr.jenveta@example.cz');
    expect(row.locale).toBe('en');
    expect(row.first_name_vocative).toBe('Petr');
  });
});
