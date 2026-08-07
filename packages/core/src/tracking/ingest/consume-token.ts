import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BindOutcome } from '../identity/bind';
import { withTrackingTx } from '../repo/tx';
import type { TrackingKeyring } from '../tokens/keyring';
import { verifyTrackingToken } from '../tokens/verify';
import type { PublicKeyOwner } from './public-key';
import { SUPPORTED_PAYLOAD_VERSIONS } from './schema';

/**
 * Spotřebování `ml_token` na `/e/identify`, viz plán P10 Task 31.
 *
 * Jednorázovost vynucuje UNIKÁTNÍ PRIMÁRNÍ KLÍČ nad `nonce`, ne kontrola
 * „existuje, tak odmítni". Rozdíl je v souběhu: dva požadavky s týmž tokenem
 * ve stejný okamžik projdou kontrolou oba, ale `INSERT` uspěje právě jednomu.
 *
 * Ve VŠECH chybových případech uživatel na webu nic nepozná a měření
 * pokračuje anonymně.
 *
 * Kontrola `Origin` je slabší, než by měla být, a je to vědomé: token podle
 * zmrazeného kontraktu neváže cílový host, takže se ověřuje jen to, že
 * `Origin` je NĚKTERÁ z registrovaných domén projektu.
 *
 * ODCHYLKA OD PLÁNU, UMÍSTĚNÍ: plán chtěl
 * `tracking/identity/consume-token.ts`. Adresář `identity/` patří vazbě
 * a slučování, tenhle soubor je HTTP služba nad příjmem, takže leží
 * v `tracking/ingest/` vedle zbytku povrchu `/e/**`.
 */

const IdentifyBodySchema = z
  .object({
    v: z.number().int(),
    key: z.string().min(1).max(64),
    anonymous_id: z.uuid(),
    token: z.string().min(3).max(512),
  })
  .strict();

export type IdentifyResponse = {
  status: 202 | 400 | 403 | 409 | 410 | 429;
  body?: { ok: boolean; reason?: string };
  problem?: { code: string };
};

export type IdentifyServiceDeps = {
  keyring: TrackingKeyring;
  resolvePublicKey: (key: string) => Promise<PublicKeyOwner | null>;
  isOriginAllowed: (workspaceId: string, origin: string) => boolean;
  bind: (input: {
    workspaceId: string;
    anonymousId: string;
    contactId: string;
    source: 'email_click';
    evidence: Record<string, unknown>;
    now: Date;
  }) => Promise<BindOutcome>;
  now: () => Date;
};

async function claimNonce(
  workspaceId: string,
  nonce: Uint8Array,
  expiresAt: Date,
): Promise<boolean> {
  return withTrackingTx({ workspaceId, job: 'tracking.consume_token' }, async (tx) => {
    const { rows } = await tx.execute<{ nonce: Buffer }>(sql`
      INSERT INTO identity_token_uses (nonce, expires_at)
      VALUES (${Buffer.from(nonce)}, ${expiresAt})
      ON CONFLICT (nonce) DO NOTHING
      RETURNING nonce
    `);
    return rows.length > 0;
  });
}

export function createIdentifyService(deps: IdentifyServiceDeps) {
  return {
    async identify(
      input: unknown,
      meta: { origin: string | undefined },
    ): Promise<IdentifyResponse> {
      const version = (input as { v?: unknown } | null)?.v;
      if (typeof version !== 'number' || !SUPPORTED_PAYLOAD_VERSIONS.includes(version as 1)) {
        return { status: 400, problem: { code: 'tracking_payload_version_unsupported' } };
      }

      const parsed = IdentifyBodySchema.safeParse(input);
      if (!parsed.success) return { status: 400, problem: { code: 'validation_failed' } };

      const owner = await deps.resolvePublicKey(parsed.data.key);
      if (owner === null) return { status: 403, problem: { code: 'origin_not_allowed' } };

      const now = deps.now();
      const verified = verifyTrackingToken(parsed.data.token, ['i'], {
        keyring: deps.keyring,
        now,
      });
      if (!verified.ok) return { status: 400, problem: { code: verified.code } };
      if (verified.fields.type !== 'i') {
        return { status: 400, problem: { code: 'token_type_mismatch' } };
      }
      const fields = verified.fields;

      // Token musí patřit témuž projektu jako veřejný klíč, jinak jde o záměnu.
      if (fields.workspaceId !== owner.workspaceId) {
        return { status: 403, problem: { code: 'origin_not_allowed' } };
      }

      // Origin se kontroluje DŘÍV než spotřebování nonce, aby špatná doména
      // token nespálila a člověk ho mohl použít na té správné.
      if (meta.origin === undefined || !deps.isOriginAllowed(owner.workspaceId, meta.origin)) {
        return { status: 403, problem: { code: 'origin_not_allowed' } };
      }

      const expiresAt = new Date(fields.expiresAt * 1000);
      if (expiresAt.getTime() <= now.getTime()) {
        return { status: 410, problem: { code: 'token_expired' } };
      }

      if (!(await claimNonce(fields.workspaceId, fields.nonce, expiresAt))) {
        return { status: 409, problem: { code: 'token_already_used' } };
      }

      const outcome = await deps.bind({
        workspaceId: fields.workspaceId,
        anonymousId: parsed.data.anonymous_id,
        contactId: fields.contactId,
        source: 'email_click',
        // Token nese kampaň, ne zprávu, takže evidence je `campaign_id`.
        evidence: { campaign_id: fields.campaignId },
        now,
      });

      // Vazba se nepovedla, a SDK se to dozví i s důvodem. `ok: true` by tvrdilo,
      // že je prohlížeč navázaný na kontakt, a odvolaný souhlas s měřením by se
      // tvářil jako úspěch. Důvod nic neprozrazuje: token, který si volající sám
      // přinesl, ten kontakt beztak pojmenovává.
      if (
        outcome === 'contact_not_found' ||
        outcome === 'restricted' ||
        outcome === 'measurement_withdrawn'
      ) {
        return { status: 202, body: { ok: false, reason: outcome } };
      }
      return { status: 202, body: { ok: true } };
    },
  };
}
