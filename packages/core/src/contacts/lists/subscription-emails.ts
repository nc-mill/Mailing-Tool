import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import { hasContentBlocks } from '@mlain/emails/document/content-stats';
import type { Document } from '@mlain/emails/document/types';
import { toPreparedSchema } from '@mlain/emails/paths';
import { applyWorkspaceBrandTheme } from '../../brand/theme';
import { loadConfig } from '../../config';
import { createWorkspaceContext } from '../../identity/context';
import { wsEq } from '../../identity/scope';
import type { WorkspaceContext } from '../../identity/types';
import { compileTemplate } from '../../templates/compile';
import { findTemplateById, validationProfileFor } from '../../templates/repository';
import { contactPreviewData } from '../../templates/api/preview-data';
import {
  resolveSenderIdentity,
  type ResolvedSenderIdentity,
} from '../../sender-identities/resolve';
import { withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { getFieldCatalog } from '../fields/catalog';
import { buildConfirmationRef } from '../public/confirm';
import { transactionalVerdict } from '../suppression/transactional';
import {
  CONFIRM_URL_PATH,
  defaultSubscriptionEmail,
  subscriptionEmailLanguage,
  type SubscriptionEmailKind,
} from './default-emails';
import { registerSubscriptionEmails, type SubscriptionEmailPort } from './subscribe-service';

/**
 * Odeslání tří e-mailů seznamu: potvrzení přihlášení, uvítání a rozloučení.
 *
 * PROČ TO EXISTUJE. `SubscribePorts.sendConfirmationEmail` volá port, který dosud
 * nikdo nezaregistroval, takže `emails?.sendConfirmation(...)` byl no-op. Produkt
 * uživateli hlásil úspěch a e-mail nikam neodešel: veřejný formulář, potvrzovací
 * stránka, centrum předvoleb i tlačítko „Poslat potvrzení znovu" mlčely stejně.
 *
 * NEJDE TO PŘES SYSTÉMOVOU POŠTU, a nemá. Závěr platí, ZDŮVODNĚNÍ se ale 7. 8. změnilo.
 *
 * Dřív tu stálo, že `queueSystemMail` umí jedině SMTP a TS klient pro SES neexistuje.
 * To už NEPLATÍ: `SYSTEM_MAIL_CAPABLE_TYPES` je od 7. 8. `['smtp', 'ses']` a odesílání
 * přes SES je v `platform/system-mail-ses.ts`. Projekt s pouhým SES tedy systémovou
 * poštu dostane.
 *
 * Skutečný důvod je jiný a trvalý: **systémová pošta je provozní zpráva instalace**
 * (pozvánka, obnova hesla) a schválně nenese odhlašovací odkaz ani `List-Unsubscribe`.
 * E-maily seznamu jsou naopak zprávy odběrateli, patří do outboxu, počítají se do
 * statistik zásilky a mají svoje závory na odhlašovací odkaz. Poslat je systémovou
 * poštou by je vyňalo z evidence i z těch závor.
 *
 * VZOREM JE `forms/delivery-email.ts`, tedy skrytá kampaň jako nosič obsahu plus
 * řádek v `messages`. Rozdíly jsou dva a oba věcné:
 *
 * 1. `messages.kind = 'transactional'`, ne `'test'`. Sender u transakčního druhu
 *    sám vypne měření a nepřidá hlavičku `List-Unsubscribe`, což je pro potvrzovací
 *    e-mail přesně žádoucí: odhlásit se z e-mailu, kterým se teprve přihlašuju,
 *    nedává smysl, a bezpečnostní skener ve schránce by měřený odkaz otevřel
 *    a token spotřeboval dřív než člověk.
 * 2. Potvrzovací odkaz jde jako `data.confirm_url`. Kořen `data` je pro
 *    `kind = 'transactional'` v Liquidu povolený, takže do Go senderu se NESAHÁ.
 *
 * VRACÍ DŮVOD, NE BOOLEAN, a nikdy nevyhodí výjimku. Přihlášení je v tu chvíli
 * zapsané a neodeslaný e-mail ho nesmí shodit. Neúspěch se nezahazuje: zapíše se
 * do auditu jako `list.email_send_failed`, protože přesně tohle tiché mlčení
 * stálo celý tenhle plán.
 */

export type SubscriptionEmailOutcome =
  | 'sent'
  /** Seznam mezitím zmizel, nebo je archivovaný. */
  | 'list_missing'
  /** Kontakt mezitím zmizel. */
  | 'contact_missing'
  /** Šablona byla mezitím smazaná. Cizí klíč ji nastaví na NULL, tohle je závod. */
  | 'template_missing'
  /** Šablona nemá jediný obsahový blok. Prázdný e-mail se neposílá. */
  | 'template_empty'
  | 'template_not_compilable'
  /**
   * Potvrzovací e-mail bez odkazu na potvrzení. Odeslat ho by znamenalo poslat
   * člověku zprávu, ze které se přihlášení dokončit nedá, a čekat, až to vzdá.
   */
  | 'confirm_link_missing'
  /** Adresa je blokovaná z důvodu, který platí i pro transakční poštu. */
  | 'suppressed'
  /** Projekt nemá odesílací identitu ani jednu odeslanou kampaň, ze které ji vzít. */
  | 'sending_not_configured';

export type SubscriptionEmailInput = {
  kind: SubscriptionEmailKind;
  contactId: string;
  listId: string;
  /** Jen u potvrzení. Bez něj se potvrzovací e-mail neposílá. */
  token?: string | undefined;
  /** Z konfigurace. Doména ji nečte sama, aby šla otestovat bez prostředí. */
  appUrl: string;
  assetBaseUrl: string;
};

/** Jméno skryté kampaně. Není to identifikátor, ten se skládá ze seznamu a druhu. */
const SYSTEM_CAMPAIGN_NAME = 'E-mail seznamu';

/** Sloupec s šablonou podle druhu e-mailu. */
const TEMPLATE_COLUMN = {
  confirmation: 'confirmationTemplateId',
  welcome: 'welcomeTemplateId',
  goodbye: 'goodbyeTemplateId',
} as const satisfies Record<SubscriptionEmailKind, string>;

/**
 * Potvrzovací odkaz. Tvar drží veřejná trasa `apps/web/src/app/(public)/s/c/[token]`.
 *
 * V ADRESE NENÍ HOLÝ TOKEN, ale VEŘEJNÝ ODKAZ z `buildConfirmationRef`, tedy
 * token složený s projektem. Stálo to jeden ztracený proklik: s holým tokenem
 * odpověděla stránka „Tenhle odkaz neplatí", protože `lookupConfirmation` ho
 * nejdřív rozebírá přes `decodePublicRef` a bez projektu neví, ve kterém
 * projektu má token hledat. Nic přitom nespadlo, chyba se pozná jedině
 * otevřením odkazu, což je přesně ten druh vady, kvůli které je tenhle plán.
 *
 * NEEXPORTUJE SE. `workspaceId` je tu OBSAH adresy, ne rozsah, pod kterým se
 * sahá na data, ale disciplinární test `identity/scope.test.ts` to u exportované
 * funkce v souboru, který na databázi sahá, rozlišit nedokáže a odmítne ji.
 * Volající je jediný, a je v tomhle souboru.
 */
function confirmUrl(appUrl: string, workspaceId: string, token: string): string {
  const ref = buildConfirmationRef({ workspaceId, token });
  return `${appUrl.replace(/\/+$/, '')}/s/c/${ref}`;
}

export async function sendSubscriptionEmail(
  ctx: WorkspaceContext,
  input: SubscriptionEmailInput,
): Promise<SubscriptionEmailOutcome> {
  const outcome = await send(ctx, input);
  if (outcome !== 'sent') {
    // Neodeslaný e-mail nesmí zmizet beze stopy. Audit je jediné místo, kam se
    // uživatel může podívat; log procesu při hledání „proč mi nepřišlo potvrzení"
    // nikdo neotevře.
    try {
      await withWorkspace(ctx, async (tx) => {
        await writeAudit(tx, ctx, {
          action: 'list.email_send_failed',
          targetType: 'list',
          targetId: input.listId,
          metadata: { kind: input.kind, reason: outcome, contact_id: input.contactId },
        });
      });
    } catch {
      // Ani zápis do auditu nesmí shodit přihlášení, které je už zapsané.
    }
  }
  return outcome;
}

async function send(
  ctx: WorkspaceContext,
  input: SubscriptionEmailInput,
): Promise<SubscriptionEmailOutcome> {
  const fields = await getFieldCatalog(ctx);
  const now = new Date();

  return withWorkspace(ctx, async (tx) => {
    const [list] = await tx
      .select({
        id: schema.lists.id,
        name: schema.lists.name,
        confirmationTemplateId: schema.lists.confirmationTemplateId,
        welcomeTemplateId: schema.lists.welcomeTemplateId,
        goodbyeTemplateId: schema.lists.goodbyeTemplateId,
      })
      .from(schema.lists)
      .where(and(wsEq(ctx, schema.lists), eq(schema.lists.id, input.listId)))
      .limit(1);
    if (list === undefined) return 'list_missing';

    const [contact] = await tx
      .select({ email: schema.contacts.email, locale: schema.contacts.locale })
      .from(schema.contacts)
      .where(
        and(
          wsEq(ctx, schema.contacts),
          eq(schema.contacts.id, input.contactId),
          isNull(schema.contacts.deletedAt),
        ),
      )
      .limit(1);
    if (contact === undefined) return 'contact_missing';
    const email = String(contact.email).toLowerCase();

    /*
     * BRÁNA BLOKOVANÝCH ADRES SE ŘÍDÍ `transactionalVerdict`, ne prostým „je
     * v suppression".
     *
     * Kdyby stačila existence řádku, rozloučení by neodešlo NIKDY: odhlášení samo
     * zapisuje suppression `global_unsubscribe`, takže by e-mail o odhlášení
     * zablokovala právě ta věc, kterou potvrzuje. Totéž platí pro potvrzení
     * přihlášení po dřívějším odhlášení, což je legitimní návrat.
     *
     * Tvrdé důvody (stížnost, výmaz podle článku 17, odraz) blokují dál a musí.
     *
     * OBĚ VĚTVE DISJUNKCE JSOU POVINNÉ. Po výmazu plaintextová adresa v řádku
     * suppression NENÍ, zůstane jen otisk, takže porovnání podle adresy na
     * vymazaného člověka nedosáhne. Otisky se hledají přes
     * `contacts.email_fingerprints`, tedy přes všechna pokolení klíče.
     */
    const suppressions = await tx
      .select({ reason: schema.suppressions.reason })
      .from(schema.suppressions)
      .where(
        and(
          wsEq(ctx, schema.suppressions),
          isNull(schema.suppressions.removedAt),
          sql`(lower(${schema.suppressions.email}::text) = ${email}
            OR ${schema.suppressions.fingerprint} IN (
              SELECT unnest(c.email_fingerprints) FROM contacts c
              WHERE c.workspace_id = ${ctx.workspaceId} AND c.id = ${input.contactId}
            ))`,
        ),
      );
    if (suppressions.some((row) => transactionalVerdict(row.reason) === 'block')) {
      return 'suppressed';
    }

    const templateId = templateIdFor(input.kind, list);
    const template = templateId === null ? undefined : await findTemplateById(tx, ctx, templateId);
    if (templateId !== null && template === undefined) return 'template_missing';

    /*
     * OBECNÉ ZNĚNÍ VZNIKÁ AŽ TADY, při odeslání, a nikde se neukládá. Proto se
     * mu značka projektu musí doplnit na tomhle místě: cestou přes
     * `createTemplate` neprochází, takže by potvrzovací e-mail odešel
     * v modré výchozí paletě i projektu, který má značku nastavenou.
     *
     * Připojené vlastní znění se nechává, jak je: to je uložený dokument,
     * kterému značku doplnilo už jeho založení, a od té doby o jeho barvách
     * rozhoduje autor.
     */
    const document =
      template === undefined
        ? await applyWorkspaceBrandTheme(
            tx,
            defaultSubscriptionEmail(input.kind, subscriptionEmailLanguage(contact.locale)),
          )
        : (template.design as Document);

    // Prázdný e-mail se neposílá. Dokument s pouhou patičkou je platný
    // a zkompiluje se bez výhrady, takže tuhle kontrolu nikdo jiný neudělá.
    if (!hasContentBlocks(document)) return 'template_empty';

    const identity = await resolveSenderIdentity(tx, ctx);
    if (identity === null) return 'sending_not_configured';

    const compiled = await compileTemplate({
      tx,
      ctx,
      document,
      // Vždy transakční profil, i když si autor připojil kampaňovou šablonu:
      // zpráva odchází jako `kind = 'transactional'` a jen ten profil povoluje
      // kořen `data`, bez kterého by potvrzovací odkaz nešel dosadit.
      templateKind: validationProfileFor('transactional'),
      fields,
      language: document.meta.language,
      assetBaseUrl: input.assetBaseUrl,
      // `test`, ne `send`: `send` odvozuje `link_id` z kampaně, kterou tahle
      // zpráva nemá. Výstup přitom opravdu odchází příjemci, takže ani `preview`.
      purpose: 'test',
      trackOpens: false,
      trackClicks: false,
      preheader: document.meta.previewText,
      now,
    });
    if (!compiled.ok) return 'template_not_compilable';

    /*
     * ZÁVORA: potvrzovací e-mail bez odkazu na potvrzení neodejde.
     *
     * Chybějící proměnná by se s `strictVariables: false` tiše proměnila
     * v prázdný řetězec, takže by člověk dostal e-mail s tlačítkem, které nikam
     * nevede, a přihlášení by zůstalo viset navždy. Kontroluje se to i při
     * připojení šablony na seznamu, ale sem to patří taky: šablona se dá
     * upravit potom, co se připojila.
     */
    if (input.kind === 'confirmation') {
      if (input.token === undefined || input.token === '') return 'confirm_link_missing';
      if (!compiled.meta.usedPaths.includes(CONFIRM_URL_PATH)) return 'confirm_link_missing';
    }

    const campaignId = await upsertSystemCampaign(tx, ctx, {
      listId: list.id,
      kind: input.kind,
      templateId: template?.id ?? null,
      subject: subjectFor(template?.name ?? document.meta.name, document),
      preheader: document.meta.previewText,
      html: compiled.html,
      text: compiled.text,
      compileMeta: compiled.meta,
      identity,
      now,
    });

    const language = document.meta.language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
    const sample = await contactPreviewData(tx, ctx, language, input.contactId);
    if (sample === null) return 'contact_missing';

    const data =
      input.token === undefined || input.token === ''
        ? {}
        : { confirm_url: confirmUrl(input.appUrl, ctx.workspaceId, input.token) };

    await tx.insert(schema.messages).values({
      workspaceId: ctx.workspaceId,
      campaignId,
      contactId: input.contactId,
      kind: 'transactional',
      email: String(contact.email),
      // Mapu `_present` plní `prepareRenderData` podle `renderSchema.presence`,
      // stejně jako ostrá materializace. Bez ní by se podmíněné bloky chovaly
      // jinak než v kampani. Kořen `data` se přidává k datům kontaktu, ne místo
      // nich: potvrzovací e-mail smí použít `{{ contact.greeting }}`.
      renderData: prepareRenderData(
        { ...(sample as unknown as Record<string, unknown>), data },
        toPreparedSchema(compiled.meta.renderSchema),
      ),
      status: 'pending',
      nextAttemptAt: now,
      createdAt: now,
    });

    return 'sent';
  });
}

/**
 * Šablona připojená k seznamu, nebo `null` pro vestavěné znění.
 *
 * Čte se přes mapu, ne přes tři větve: přidání dalšího druhu e-mailu tak
 * znamená jeden řádek v `TEMPLATE_COLUMN`, ne další `if` uprostřed odesílání.
 */
function templateIdFor(
  kind: SubscriptionEmailKind,
  list: Record<(typeof TEMPLATE_COLUMN)[SubscriptionEmailKind], string | null>,
): string | null {
  return list[TEMPLATE_COLUMN[kind]];
}

/** Předmět. Vlastní pole na něj šablona nemá, bere se jméno z dokumentu. */
function subjectFor(fallback: string, document: Document): string {
  const fromDocument = document.meta.name;
  return (fromDocument !== '' ? fromDocument : fallback).slice(0, 400);
}

/**
 * Skrytá kampaň je JEDNA NA DVOJICI (seznam, druh e-mailu) a přepisuje se při
 * každém odeslání.
 *
 * Ne jedna na šablonu: tutéž šablonu smí použít víc seznamů a sender čte obsah
 * z hlavičky kampaně, takže by si dva seznamy přepisovaly obsah navzájem.
 * Ne nová na každé odeslání: kampaní by přibývalo bez omezení a každá by držela
 * odkaz na providera cizím klíčem s ON DELETE RESTRICT.
 *
 * `revision` se zvyšuje, protože sender si hlavičku cachuje podle dvojice
 * (campaign_id, revision). Bez toho by po úpravě šablony odešel starý obsah
 * a nic by přitom nespadlo.
 */
async function upsertSystemCampaign(
  tx: Tx,
  ctx: WorkspaceContext,
  input: {
    listId: string;
    kind: SubscriptionEmailKind;
    templateId: string | null;
    subject: string;
    preheader: string;
    html: string;
    text: string;
    compileMeta: unknown;
    identity: ResolvedSenderIdentity;
    now: Date;
  },
): Promise<string> {
  const content = {
    subject: input.subject,
    preheader: input.preheader,
    fromName: input.identity.fromName,
    fromEmail: input.identity.fromEmail,
    replyTo: input.identity.replyTo,
    providerId: input.identity.providerId,
    senderDomainId: input.identity.senderDomainId,
    templateId: input.templateId,
    compiledHtml: input.html,
    compiledText: input.text,
    compileMeta: input.compileMeta,
    compiledAt: input.now,
    trackOpens: false,
    trackClicks: false,
    updatedAt: input.now,
  };

  // Seznam a druh se poznají podle jména skryté kampaně: `campaigns` sloupec pro
  // tenhle vztah nemá a přidávat ho kvůli jednomu vyhledání by znamenalo migraci
  // v cizí doméně. Jméno se nikde neukazuje, protože výpis kampaní `kind = 'system'`
  // vynechává.
  const name = `${SYSTEM_CAMPAIGN_NAME} · ${input.kind} · ${input.listId}`;

  const [existing] = await tx
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(
        wsEq(ctx, schema.campaigns),
        eq(schema.campaigns.kind, 'system'),
        eq(schema.campaigns.name, name),
        isNull(schema.campaigns.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    await tx
      .update(schema.campaigns)
      .set({ ...content, revision: sql`${schema.campaigns.revision} + 1` })
      .where(eq(schema.campaigns.id, existing.id));
    return existing.id;
  }

  const [created] = await tx
    .insert(schema.campaigns)
    .values({
      workspaceId: ctx.workspaceId,
      name,
      kind: 'system',
      // Zůstává v draftu navždy. Sender zprávy mimo kampaň claimuje bez ohledu
      // na stav kampaně, takže ji není proč posouvat.
      status: 'draft',
      ...content,
    })
    .returning({ id: schema.campaigns.id });
  return created!.id;
}

/**
 * Port nad skutečnou databází.
 *
 * KONTEXT SE SKLÁDÁ Z `workspaceId`, protože port dostává jen jeho. Aktér je
 * `system` s pojmenovanou úlohou, ať je v auditu poznat, že řádek nezaložil
 * člověk. Jiná cesta k `WorkspaceContext` neexistuje, typ je branded.
 *
 * ŽÁDNÁ METODA NEVYHAZUJE VÝJIMKU. Volající je `subscribe()`, `confirm()` nebo
 * `unsubscribe()`, tedy funkce, které mají zápis hotový; neodeslaný e-mail
 * nesmí ten zápis shodit.
 */
export function outboxSubscriptionEmails(): SubscriptionEmailPort {
  async function run(
    workspaceId: string,
    input: Omit<SubscriptionEmailInput, 'appUrl' | 'assetBaseUrl'>,
  ): Promise<void> {
    try {
      const config = loadConfig();
      const ctx = await createWorkspaceContext({
        kind: 'system',
        job: 'contacts.subscription_email',
        workspaceId,
      });
      await sendSubscriptionEmail(ctx, {
        ...input,
        appUrl: config.APP_URL,
        assetBaseUrl: config.ASSET_BASE_URL,
      });
    } catch {
      // Viz hlavička. Důvod, který se dá zapsat, zapisuje `sendSubscriptionEmail`
      // do auditu; sem se dostane jen porucha pod ním (nedostupná databáze,
      // nenačtená konfigurace) a ta nesmí shodit hotové přihlášení.
    }
  }

  return {
    async sendConfirmation(input) {
      await run(input.workspaceId, {
        kind: 'confirmation',
        contactId: input.contactId,
        listId: input.listId,
        token: input.token,
      });
    },
    async sendWelcome(input) {
      await run(input.workspaceId, {
        kind: 'welcome',
        contactId: input.contactId,
        listId: input.listId,
      });
    },
    async sendGoodbye(input) {
      await run(input.workspaceId, {
        kind: 'goodbye',
        contactId: input.contactId,
        listId: input.listId,
      });
    },
    /**
     * Vyžádaná věc (e-book, kupon) TUDY NECHODÍ a je to schválně. Posílá ji
     * `forms/delivery-email.ts` přímo z odeslání formuláře a z potvrzení
     * přihlášení, protože zná formulář, ze kterého požadavek přišel; port
     * nese jen jméno seznamu. Druhá cesta k téže věci by znamenala dvě různá
     * pravidla, kdy se slíbený soubor doručí.
     */
    async deliverRequestedItem() {
      return Promise.resolve();
    },
  };
}

/**
 * Zapojení portu při startu procesu. Volá se tam, kde se volá `installSystemMailer()`,
 * tedy v `apps/web/src/instrumentation.ts` a v `apps/worker/src/main.ts`.
 *
 * NENÍ TO PODMÍNKA FUNKČNOSTI a je to schválně, přesně jako u systémové pošty:
 * `subscriptionEmails()` si odesílatel sestaví líně sama, takže e-mail odejde
 * i z procesu, který tuhle funkci nezavolá. Modulový singleton nastavený odjinud
 * je v Next.js křehký předpoklad a v běžící instalaci to opravdu nestačilo.
 *
 * K čemu tedy je: sestaví odesílatel DŘÍV, než přijde první požadavek, a hlavně
 * je v kompozičním kořeni vidět, že tahle cesta existuje.
 *
 * Druhé volání nic nepřepíše, aby test, který si zaregistroval vlastní port,
 * nepřišel o svůj falešný odesílatel jen proto, že se mezitím načetl runtime.
 */
let installed = false;

export function installSubscriptionEmails(): void {
  if (installed) return;
  registerSubscriptionEmails(outboxSubscriptionEmails());
  installed = true;
}

/** Jen pro testy: dovolí zapojit port znovu. */
export function resetSubscriptionEmailInstallation(): void {
  installed = false;
}
