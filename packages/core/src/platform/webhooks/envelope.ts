/**
 * 3.8: tato část vlastní obálku a garantuje, že se id, type, api_version,
 * occurred_at a workspace_id nezmění. Obsah `data` deklaruje ta část, které
 * událost patří.
 *
 * Pořadí klíčů je součástí kontraktu, ne kosmetika: HMAC se počítá nad syrovými
 * bajty, takže přeházení klíčů dá jiný podpis a příjemci by přestali ověřovat.
 */
export const ENVELOPE_KEY_ORDER = [
  'id',
  'type',
  'api_version',
  'occurred_at',
  'workspace_id',
  'data',
] as const;

export const WEBHOOK_API_VERSION = 'v1';

export type WebhookEventInput = {
  id: string;
  type: string;
  occurredAt: Date;
  workspaceId: string;
  data: Record<string, unknown>;
};

/**
 * Skládá JSON ručně v pevném pořadí. JSON.stringify nad objektem sice pořadí
 * vkládání zachovává, ale spoléhat na to napříč refaktory je křehké, a tady je
 * to podmínka správnosti podpisu.
 */
export function serializeEnvelope(event: WebhookEventInput): string {
  const parts = [
    `"id":${JSON.stringify(event.id)}`,
    `"type":${JSON.stringify(event.type)}`,
    `"api_version":${JSON.stringify(WEBHOOK_API_VERSION)}`,
    `"occurred_at":${JSON.stringify(event.occurredAt.toISOString())}`,
    `"workspace_id":${JSON.stringify(event.workspaceId)}`,
    `"data":${JSON.stringify(event.data ?? {})}`,
  ];
  return `{${parts.join(',')}}`;
}
