import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import { hasContentBlocks } from '@mlain/emails/document/content-stats';
import type { Document } from '@mlain/emails/document/types';
import { toPreparedSchema } from '@mlain/emails/paths';
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
import { getFieldCatalog } from '../fields/catalog';
import type { FormRow } from '../repo/forms';

/**
 * Odeslání e-mailu, který si uživatel nastavil u formuláře.
 *
 * PROČ TO EXISTUJE. Nejběžnější důvod, proč si někdo dá formulář na web, není
 * „sbírat adresy", ale „nech mi adresu a já ti pošlu e-book". Bez téhle cesty
 * formulář kontakt zapsal a člověk nedostal nic.
 *
 * JDE PŘES OUTBOX A PŘES SKRYTOU KAMPAŇ, ne přímo přes providera. Je to táž
 * úvaha jako u testovacího odeslání šablony (`templates/test-send.ts`): mimo
 * outbox by se obešel seznam potlačených adres, kvóty, sledování i rekonciliace
 * a všechno by se muselo napsat podruhé.
 *
 * `messages.kind = 'test'` NENÍ PŘEKLEP a stálo to rozvahu. Sloupec zná jen
 * dvě hodnoty, `campaign` a `test`, a `campaign` tady být nesmí: nese cizí klíč
 * na materializované publikum kampaně, které tahle zpráva nemá, a počítala by se
 * do statistik kampaně, která nikdy neproběhla. Hodnota `test` znamená v senderu
 * „zpráva mimo kampaň, ber ji přednostně", což je pro zprávu, na kterou člověk
 * čeká na webu, přesně žádoucí. Třetí hodnota by znamenala změnu v senderu v Go,
 * tedy v kódu, který tenhle plán nevlastní.
 *
 * Vrací DŮVOD, ne boolean. Volající (odeslání formuláře, potvrzení přihlášení)
 * na výsledku nesmí spadnout: kontakt už je zapsaný a nedoručený e-mail se řeší
 * záznamem, ne zahozením přihlášení.
 */
export type DeliveryOutcome =
  | 'sent'
  /** Formulář žádný e-mail nastavený nemá. Legitimní stav, ne chyba. */
  | 'no_template'
  /** Šablona byla mezitím smazaná. Cizí klíč ji nastaví na NULL, tohle je závod. */
  | 'template_missing'
  /** Šablona nemá jediný obsahový blok. Prázdný e-mail se neposílá. */
  | 'template_empty'
  | 'template_not_compilable'
  /** Adresa je na seznamu potlačených. Nesmí jí odejít nic, ani slíbený soubor. */
  | 'suppressed'
  /** Projekt nemá odesílací účet ani jednu odeslanou kampaň, ze které ho vzít. */
  | 'sending_not_configured';

export type DeliveryInput = {
  form: FormRow;
  contactId: string;
  email: string;
  /** Z konfigurace (`ASSET_BASE_URL`). Doména ji nečte sama, aby šla otestovat bez prostředí. */
  assetBaseUrl: string;
};

/** Jméno skryté kampaně. Není to identifikátor, ten nese `kind` a `template_id`. */
const SYSTEM_CAMPAIGN_NAME = 'E-mail z formuláře';

export async function sendFormDeliveryEmail(
  ctx: WorkspaceContext,
  input: DeliveryInput,
): Promise<DeliveryOutcome> {
  const templateId = input.form.deliveryTemplateId;
  if (templateId === null) return 'no_template';

  const fields = await getFieldCatalog(ctx);
  const now = new Date();

  return withWorkspace(ctx, async (tx) => {
    const template = await findTemplateById(tx, ctx, templateId);
    if (template === undefined) return 'template_missing';

    // Potlačená adresa nedostane ani slíbený soubor. Je to táž brána jako
    // u přihlášení: kdo si vyžádal výmaz nebo nahlásil spam, nesmí dostat nic.
    //
    // OBĚ VĚTVE DISJUNKCE JSOU POVINNÉ, ne jedna nebo druhá. Dřív tu byla jen
    // ta přes adresu a byla to díra: po výmazu podle článku 17 plaintextová
    // adresa v řádku suppression NENÍ, zůstane jen otisk. Vymazaný člověk
    // touhle branou prošel a zachytil ho až sender, tedy o krok později, než
    // měl. Kanonický predikát `suppressedExistsSql` obě větve má odjakživa;
    // tohle místo si ho opsalo neúplně.
    //
    // Otisk se hledá přes `contacts.email_fingerprints`, tedy přes VŠECHNA
    // pokolení klíče. Řádek suppression nese jedno a přepočítat mu ho nejde,
    // protože plaintext je pryč; kontakt nese všechna, protože ten plaintext
    // máme. S jedním otiskem by první rotace SECRET_KEY ochranu tiše odřízla.
    const email = input.email.toLowerCase();
    const suppressed = await tx
      .select({ id: schema.suppressions.id })
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
      )
      .limit(1);
    if (suppressed.length > 0) return 'suppressed';

    const document = template.design as Document;
    // Prázdná šablona se neposílá, stejně jako se neodešle prázdná kampaň.
    // Dokument s pouhou patičkou je platný a zkompiluje se bez výhrady, takže
    // tuhle kontrolu nikdo jiný neudělá.
    if (!hasContentBlocks(document)) return 'template_empty';

    const identity = await resolveSenderIdentity(tx, ctx);
    if (identity === null) return 'sending_not_configured';

    const compiled = await compileTemplate({
      tx,
      ctx,
      document,
      templateKind: validationProfileFor(template.kind),
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

    const campaignId = await upsertSystemCampaign(tx, ctx, {
      formId: input.form.id,
      templateId: template.id,
      subject: subjectFor(template.name, document),
      preheader: document.meta.previewText,
      html: compiled.html,
      text: compiled.text,
      compileMeta: compiled.meta,
      identity,
      now,
    });

    const language = document.meta.language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
    const sample = await contactPreviewData(tx, ctx, language, input.contactId);
    if (sample === null) return 'template_missing';

    await tx.insert(schema.messages).values({
      workspaceId: ctx.workspaceId,
      campaignId,
      contactId: input.contactId,
      kind: 'test',
      email: input.email,
      // Mapu `_present` plní `prepareRenderData` podle `renderSchema.presence`,
      // stejně jako ostrá materializace. Bez ní by se podmíněné bloky chovaly
      // jinak než v kampani.
      renderData: prepareRenderData(
        sample as unknown as Record<string, unknown>,
        toPreparedSchema(compiled.meta.renderSchema),
      ),
      status: 'pending',
      nextAttemptAt: now,
      createdAt: now,
    });

    return 'sent';
  });
}

/** Předmět. Vlastní pole na něj šablona nemá, bere se jméno z dokumentu. */
function subjectFor(fallback: string, document: Document): string {
  const fromDocument = document.meta.name;
  return (fromDocument !== '' ? fromDocument : fallback).slice(0, 400);
}

/**
 * Skrytá kampaň je JEDNA NA FORMULÁŘ a přepisuje se při každém odeslání.
 *
 * Ne jedna na šablonu: tutéž šablonu smí použít víc formulářů a sender čte obsah
 * z hlavičky kampaně, takže by si dva formuláře přepisovaly obsah navzájem.
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
    formId: string;
    templateId: string;
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

  // Formulář se pozná podle jména skryté kampaně: `campaigns` vlastní sloupec
  // pro odkaz na formulář nemá a přidávat ho kvůli jednomu vyhledání by znamenalo
  // migraci v cizí doméně. Jméno je proto složené a nikde se neukazuje, protože
  // kampaně s `kind = 'system'` výpis vynechává.
  const name = `${SYSTEM_CAMPAIGN_NAME} · ${input.formId}`;

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
