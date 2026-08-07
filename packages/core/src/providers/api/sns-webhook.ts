/**
 * Čtvrtý povrch API (část 1, 4.1): `POST /api/webhooks/ses/{provider_id}`.
 *
 * Bez autentizace, bez CSRF, bez rate limitu. Ochranu dělá ověření podpisu,
 * ne autentizace, protože SNS žádnou nemá. Rate limit by znamenal, že provider
 * doručení opakuje, a vznikla by lavina.
 *
 * Tělo se čte SYROVĚ a podpis se ověřuje nad ním, ne nad znovu serializovaným
 * JSONem. Kanonizace „string to sign" je přesně to místo, kde se dělá chyba,
 * kterou nikdo nenajde, dokud nepřijde útok.
 *
 * STAV KE DNI PSANÍ, ohlášeno nahlas: ověření podpisu dodává fáze H plánu
 * (úkoly 38 a 39, `providers/sns/verify.ts`) a potřebuje k tomu balíček
 * `sns-validator`, který v `packages/core/package.json` NENÍ. Dokud verifikátor
 * nikdo nezaregistruje přes `setSnsWebhookDeps`, endpoint odpovídá 503 a NIC
 * nezpracuje. Alternativa, tedy přijímat neověřené zprávy, by znamenala, že
 * kdokoliv na světě může projektu zapsat odraz na libovolnou adresu a tím ji
 * dostat na seznam blokovaných.
 *
 * POŽADAVEK PRO TOHO, KDO DODĚLÁ ZPRACOVÁNÍ (riziko RZ3 plánu systémové pošty):
 * událost, ke které se nenajde zpráva, se musí ZAHODIT, ne shodit dávku. Od
 * doplnění odesílání systémové pošty přes SES odchází z instalace pošta, která
 * v `messages` řádek NEMÁ a mít nebude (`contact_id` je NOT NULL a příjemce není
 * kontakt). Odraz nebo stížnost na pozvánku tedy přijde přes SNS a nespáruje se
 * s ničím. Systémová cesta proto ani neposílá message tagy `ml_msg` a `ml_mday`
 * (`platform/system-mail-ses.ts`), takže taková událost nenese žádný identifikátor
 * a od neznámé zprávy se nedá odlišit. Dnes to nemá jak spadnout, protože
 * `setSnsWebhookDeps` nikdo nevolá a fronta `provider_event.process` obsluhu nemá.
 */

export type SnsVerdict = { ok: true } | { ok: false; reason: string; accept?: boolean };

export type SnsWebhookDeps = {
  findProvider(providerId: string): Promise<{
    workspaceId: string;
    snsTopicArn: string | null;
  } | null>;
  verify(input: {
    message: Record<string, unknown>;
    expectedTopicArn: string | null;
    now: Date;
  }): Promise<SnsVerdict>;
  recordInvalid(input: {
    workspaceId: string;
    providerId: string;
    snsMessageId: string;
    reason: string;
  }): Promise<void>;
  insertOnce(input: {
    workspaceId: string;
    providerId: string;
    message: Record<string, unknown>;
  }): Promise<string | null>;
  confirmSubscription(input: {
    workspaceId: string;
    providerId: string;
    message: Record<string, unknown>;
  }): Promise<void>;
  markEventsStopped(input: { workspaceId: string; providerId: string }): Promise<void>;
  enqueueProcess(input: {
    workspaceId: string;
    providerId: string;
    receiptId: string;
  }): Promise<void>;
  securityEvent(input: {
    workspaceId: string;
    reason: string;
    topicArn: unknown;
    ip: string | null;
  }): Promise<void>;
  log(message: string, detail: Record<string, unknown>): void;
};

let registered: SnsWebhookDeps | null = null;

/** Zaregistruje doménové závislosti. Volá ji fáze H, dokud to neudělá, endpoint mlčí. */
export function setSnsWebhookDeps(deps: SnsWebhookDeps | null): void {
  registered = deps;
}

export function snsWebhookDeps(): SnsWebhookDeps | null {
  return registered;
}

export const MAX_SNS_BODY_BYTES = 256 * 1024;

export type WebhookResult = { status: number; body: string | null };

const EMPTY: WebhookResult = { status: 200, body: null };

export async function handleSnsWebhook(
  deps: SnsWebhookDeps | null,
  input: { providerId: string; rawBody: string; ip: string | null; now?: Date },
): Promise<WebhookResult> {
  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_SNS_BODY_BYTES) {
    return { status: 413, body: JSON.stringify({ code: 'payload_too_large' }) };
  }

  let message: Record<string, unknown>;
  try {
    message = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    return {
      status: 422,
      body: JSON.stringify({ code: 'validation_failed', detail: 'Tělo není platný JSON.' }),
    };
  }

  if (!deps) {
    return {
      status: 503,
      body: JSON.stringify({
        code: 'service_unavailable',
        detail: 'Ověření podpisu SNS není v této instalaci zapojené.',
      }),
    };
  }

  // workspace_id se bere z provider_id v CESTĚ, nikdy z těla požadavku.
  const provider = await deps.findProvider(input.providerId);
  // Neznámý provider dostane 200 a ticho: 404 by prozradilo, které identifikátory platí.
  if (!provider) return EMPTY;

  const verdict = await deps.verify({
    message,
    expectedTopicArn: provider.snsTopicArn,
    now: input.now ?? new Date(),
  });

  if (!verdict.ok && verdict.accept !== true) {
    await deps.securityEvent({
      workspaceId: provider.workspaceId,
      reason: verdict.reason,
      topicArn: message['TopicArn'],
      ip: input.ip,
    });
    return {
      status: 401,
      body: JSON.stringify({ code: 'signature_invalid', params: { reason: verdict.reason } }),
    };
  }

  if (!verdict.ok) {
    // stale_timestamp: přijme se, zaznamená jako neplatná, nezpracuje.
    await deps.recordInvalid({
      workspaceId: provider.workspaceId,
      providerId: input.providerId,
      snsMessageId: String(message['MessageId'] ?? ''),
      reason: verdict.reason,
    });
    return EMPTY;
  }

  const type = String(message['Type'] ?? '');
  if (type === 'SubscriptionConfirmation') {
    await deps.confirmSubscription({
      workspaceId: provider.workspaceId,
      providerId: input.providerId,
      message,
    });
    return EMPTY;
  }
  if (type === 'UnsubscribeConfirmation') {
    await deps.markEventsStopped({
      workspaceId: provider.workspaceId,
      providerId: input.providerId,
    });
    return EMPTY;
  }

  try {
    const receiptId = await deps.insertOnce({
      workspaceId: provider.workspaceId,
      providerId: input.providerId,
      message,
    });
    // Prázdné receiptId znamená, že zpráva už byla přijata. Endpoint vrátí 200
    // a nic dalšího nedělá.
    if (receiptId) {
      await deps.enqueueProcess({
        workspaceId: provider.workspaceId,
        providerId: input.providerId,
        receiptId,
      });
    }
  } catch (err) {
    // Chyby zpracování NIKDY nevracejí 500: SNS opakuje doručení při každém non-2xx
    // a exponenciálně, takže bychom si vyrobili zesílení provozu. Řeší se uložením
    // do provider_event_receipts a vlastním opakováním.
    deps.log('zpracování SNS události selhalo', { providerId: input.providerId, err });
  }

  // Žádné echo těla, aby endpoint neposloužil jako reflektor.
  return EMPTY;
}
