import { createSystemContext } from '../../identity/context';
import type { WorkspaceContext } from '../../identity/types';
import { applyMapping, type MappedDelivery } from '../inbound/mapping';
import { subscribeToList } from '../lists/subscribe-service';
import { unsubscribe } from '../lists/unsubscribe';
import { changeContactEmail, findByExternalId, writeContact } from '../repo/contacts';
import { recordConsent, type ConsentPurpose } from '../repo/consents';
import { loadDelivery, markDelivery, type DeliveryRef } from '../repo/inbound';
import { addTagsToContact, ensureTags } from '../repo/tags';

export type InboundProcessPayload = { workspaceId: string; deliveryId: string; createdAt: string };

export type InboundProcessResult = { status: 'processed' | 'unmapped' | 'ignored' | 'failed' };

/**
 * Zpracování doručení. Běží asynchronně, protože chyby mapování se nesmí promítnout
 * do HTTP odpovědi: pomalá nebo chybující databáze by jinak způsobila, že e-shop
 * bude donekonečna opakovat doručení.
 *
 * Idempotence: stav se mění podmíněně ze stavu received, takže druhý běh po pádu
 * workeru nezpracuje totéž dvakrát. Druhá vrstva je dedup podle external_id.
 */
export async function processInboundDelivery(
  payload: InboundProcessPayload,
): Promise<InboundProcessResult> {
  const ctx = createSystemContext(payload.workspaceId, 'inbound.process');
  const ref: DeliveryRef = payload;

  const delivery = await loadDelivery(ctx, ref);
  if (delivery === null || delivery.status !== 'received') return { status: 'processed' };

  const mapped = applyMapping(delivery.payload, delivery.mapping);
  if (!mapped.ok) {
    // Doručení se NEZTRATÍ. Uloží se jako unmapped s celým payloadem, aby ho uživatel
    // mohl v průvodci namapovat kliknutím na skutečnou hodnotu.
    await markDelivery(ctx, ref, 'unmapped', { errorCode: mapped.code });
    return { status: 'unmapped' };
  }

  if (mapped.action === 'ignore') {
    await markDelivery(ctx, ref, 'ignored', { action: 'ignore' });
    return { status: 'ignored' };
  }

  const contactId = await applyContactChange(ctx, mapped);
  await markDelivery(ctx, ref, 'processed', { contactId, action: mapped.action });
  return { status: 'processed' };
}

/**
 * Zapíše namapovaný kontakt a **uloží k němu `external_id`**.
 *
 * Sloupec `contacts.external_id` a částečný unikátní index `uq_contacts__ws_external_id`
 * zavedl P03 kvůli párování podle identifikátoru zákazníka z e-shopu. Dřívější znění
 * tohohle plánu identifikátor mapovalo jen do `inbound_dedup`, takže sloupec i index
 * zůstaly bez jediného zapisovatele: párování by nikdy nefungovalo a nikomu by nic nespadlo.
 *
 * Párování má přednost před adresou: když e-shop pošle změněný e-mail u téhož
 * zákazníka, je to změna adresy, ne nový člověk. Adresa se pak mění řízenou cestou
 * `changeContactEmail`, aby proběhla kontrola kolize, přepočet otisků a audit.
 */
async function applyContactChange(
  ctx: WorkspaceContext,
  mapped: MappedDelivery,
): Promise<string | null> {
  const email = mapped.contact.email;
  const attributes = mapped.contact.attributes;
  const firstName = asText(mapped.contact['first_name']);
  const lastName = asText(mapped.contact['last_name']);
  const locale = asText(mapped.contact['locale']);

  if (mapped.externalId !== null) {
    const existing = await findByExternalId(ctx, mapped.externalId);
    if (existing !== null && existing.email !== email) {
      await changeContactEmail(ctx, existing.id, email);
    }
  }

  if (mapped.action === 'unsubscribe') {
    const existing = await findByExternalId(ctx, mapped.externalId ?? '');
    const contactId = existing?.id ?? null;
    if (contactId !== null) {
      // Rozsah se předává vždy explicitně, i když je null. Vynechání by v části 4a
      // znamenalo jiný rozsah zrušení čekající pošty, viz kritérium 79.
      await unsubscribe(ctx, { contactId, listId: null, reason: 'api', campaignId: null });
    }
    return contactId;
  }

  const written = await writeContact(ctx, {
    email,
    firstName,
    lastName,
    ...(locale === null ? {} : { locale }),
    externalId: mapped.externalId,
    source: 'webhook',
    attributes,
    mode: mapped.onConflict === 'overwrite' ? 'overwrite' : 'update',
  });
  if (written.rejected === 'suppressed') return null;

  await attachListsAndTags(ctx, written.id, mapped, written.allowConsents);
  return written.id;
}

/**
 * Připojí kontakt na seznamy a štítky podle mapování.
 *
 * Přihlášení jde přes `subscribeToList`, ne přímým INSERTem do `list_subscriptions`:
 * stavový automat, dvojí potvrzení a zápis souhlasu jsou na něm závislé a přímý zápis
 * by je všechny obešel.
 */
async function attachListsAndTags(
  ctx: WorkspaceContext,
  contactId: string,
  mapped: MappedDelivery,
  allowConsents: boolean,
): Promise<void> {
  for (const listId of mapped.listIds) {
    await subscribeToList(ctx, {
      listId,
      email: mapped.contact.email,
      source: 'webhook',
    });
  }

  if (mapped.tags.length > 0) {
    const tagIds = await ensureTags(ctx, mapped.tags);
    await addTagsToContact(ctx, contactId, tagIds);
  }

  // Pravidlo 4: adresa na suppression listu nedostane udělený souhlas ani z webhooku.
  // Přihlášení do seznamu hlídá `subscribeToList` vlastní branou, souhlas nikdo, takže
  // bez téhle podmínky by odhlášený člověk dostal z e-shopu nový souhlas při každém nákupu.
  if (mapped.consent !== undefined && allowConsents) {
    await recordConsent(ctx, {
      contactId,
      purpose: mapped.consent.purpose as ConsentPurpose,
      status: 'granted',
      legalBasis: mapped.consent.legalBasis as
        'consent' | 'legitimate_interest' | 'contract' | 'soft_opt_in',
      scopeListId: null,
      source: 'webhook',
      ...(mapped.consent.consentText === undefined
        ? {}
        : { consentText: mapped.consent.consentText }),
    });
  }
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}
