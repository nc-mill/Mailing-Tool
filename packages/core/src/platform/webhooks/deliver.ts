import { sql } from 'drizzle-orm';
import { decryptEnvelope } from '@mlain/contracts/crypto';
import { withWorkspace } from '../../tx';
import { createSystemContext } from '../../identity/context';
import { SsrfBlockedError, WEBHOOK_SSRF_POLICY } from '../../net/ssrf';
import { safeRequest } from '../../net/safe-request';
import { serializeEnvelope } from './envelope';
import { signatureHeader } from './signature';
import { isFinalAttempt, nextAttemptAt } from './backoff';
import { applyDeliveryOutcome, DELIVER_JOB } from './disable';

/** 3.8, tabulka limitů. */
export const CONNECT_TIMEOUT_MS = 5_000;
export const TOTAL_TIMEOUT_MS = 10_000;
export const SNIPPET_BYTES = 2 * 1024;

export type DeliveryOutcome = {
  status: 'succeeded' | 'failed' | 'abandoned';
  responseStatus: number | null;
  errorCode: string | null;
  attempt: number;
  disabledReason: string | null;
};

/**
 * Klasifikace odpovědi podle 3.8.
 * Přesměrování se NENÁSLEDUJE, takže 3xx je prostě neúspěch.
 */
export function classifyResponse(status: number): {
  ok: boolean;
  abandon: boolean;
  disable: string | null;
} {
  if (status >= 200 && status < 300) return { ok: true, abandon: false, disable: null };
  // 410 Gone znamená, že endpoint už neexistuje a opakování nemá smysl.
  if (status === 410) return { ok: false, abandon: true, disable: 'endpoint_gone' };
  return { ok: false, abandon: false, disable: null };
}

export type DeliverInput = { deliveryId: string; workspaceId: string; createdAt: Date };

/**
 * Jedno doručení. Vrací výsledek a zapisuje ho, takže job je jen tenký obal
 * a celá logika jde otestovat přímým voláním.
 *
 * Doručení je NEJMÉNĚ JEDNOU: při restartu workeru uprostřed HTTP requestu
 * neexistuje způsob, jak zjistit, jestli protistrana request přijala. Job se
 * proto zopakuje a příjemce musí deduplikovat podle ML-Event-Id.
 *
 * ODCHYLKA OD PLÁNU: plán předával do `withWorkspace` řetězec `workspaceId`.
 * Obálka podle rozhodnutí R2 bere `WorkspaceContext`, jinak by první vrstva
 * izolace šla obejít. Doručení běží z jobu, takže je kontext systémový.
 */
export async function deliverWebhook(input: DeliverInput): Promise<DeliveryOutcome> {
  const ctx = createSystemContext(input.workspaceId, DELIVER_JOB);

  const loaded = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT d.id::text AS id, d.attempt, d.event_id::text AS event_id, d.event_type,
             e.url AS url, e.secret_encrypted AS secret_encrypted, e.id::text AS endpoint_id,
             ev.payload AS payload, ev.occurred_at AS occurred_at
        FROM webhook_deliveries d
        JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.deleted_at IS NULL
        JOIN webhook_events ev ON ev.id = d.event_id
       WHERE d.id = ${input.deliveryId}::uuid AND d.created_at = ${input.createdAt}
       LIMIT 1
    `);
    return rows[0] ?? null;
  });

  if (!loaded) {
    return {
      status: 'abandoned',
      responseStatus: null,
      errorCode: 'delivery_not_found',
      attempt: 0,
      disabledReason: null,
    };
  }

  const attempt = Number(loaded.attempt) + 1;
  const endpointId = loaded.endpoint_id as string;

  // decryptEnvelope je SYNCHRONNÍ, vrací plaintext nebo hodí CryptoError.
  const secret = decryptEnvelope({
    stored: loaded.secret_encrypted as string,
    context: 'webhook_secret',
    workspaceId: input.workspaceId,
  });

  const body = serializeEnvelope({
    id: loaded.event_id as string,
    type: loaded.event_type as string,
    occurredAt: new Date(loaded.occurred_at as Date),
    workspaceId: input.workspaceId,
    data: (loaded.payload as Record<string, unknown>) ?? {},
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'MlainMailer-Webhooks/1.0',
    'ML-Event-Id': loaded.event_id as string,
    'ML-Event-Type': loaded.event_type as string,
    'ML-Delivery-Id': loaded.id as string,
    'ML-Attempt': String(attempt),
    'ML-Signature': signatureHeader(secret, timestamp, body),
  };

  let responseStatus: number | null = null;
  let snippet: string | null = null;
  let durationMs: number | null = null;
  let errorCode: string | null = null;
  let classification = { ok: false, abandon: false, disable: null as string | null };

  try {
    // SSRF kontrola probíhá uvnitř safeRequest při KAŽDÉM doručení, ne jen při
    // ukládání. Bez toho existuje DNS rebinding (kritérium 39).
    const res = await safeRequest({
      url: loaded.url as string,
      method: 'POST',
      headers,
      body,
      policy: WEBHOOK_SSRF_POLICY,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
    });
    responseStatus = res.status;
    snippet = res.body.slice(0, SNIPPET_BYTES);
    durationMs = res.durationMs;
    classification = classifyResponse(res.status);
    if (!classification.ok) errorCode = `http_${res.status}`;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      // Trvalá chyba konfigurace, žádné retry.
      errorCode = 'blocked_target';
      classification = { ok: false, abandon: true, disable: null };
    } else {
      // Klient rozlišuje dvě různé poruchy a hlásí je jménem: `connect_timeout`
      // (protistrana se vůbec neozvala) a `total_timeout` (ozvala se, ale
      // odpověď nedoběhla do stropu). Slít je do jednoho `timeout` znamená
      // zahodit přesně ten rozdíl, podle kterého se pozná, jestli je endpoint
      // nedostupný, nebo jen pomalý, a to je první otázka při ladění webhooku,
      // který zákazníkovi přestal chodit. Hodnota jde do
      // `webhook_deliveries.error_code`, takže se na ni kouká i podpora.
      const message = (err as Error).message;
      errorCode =
        message === 'connect_timeout' || message === 'total_timeout' ? message : 'connection_error';
    }
  }

  const final = classification.abandon || (!classification.ok && isFinalAttempt(attempt));
  const next = classification.ok || final ? null : nextAttemptAt(attempt, new Date());
  const status: DeliveryOutcome['status'] = classification.ok
    ? 'succeeded'
    : final
      ? 'abandoned'
      : 'failed';

  await applyDeliveryOutcome({
    workspaceId: input.workspaceId,
    deliveryId: input.deliveryId,
    createdAt: input.createdAt,
    endpointId,
    attempt,
    status,
    responseStatus,
    snippet,
    durationMs,
    errorCode,
    nextAttemptAt: next,
    disableReason: classification.disable,
  });

  return { status, responseStatus, errorCode, attempt, disabledReason: classification.disable };
}
