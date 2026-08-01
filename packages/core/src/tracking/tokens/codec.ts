import {
  PAYLOAD_BYTES,
  TOKEN_MAC_BYTES,
  TOKEN_PREFIX,
  type TokenFields,
  type TokenType,
} from '@mlain/contracts/token';
import type { TrackingTokenFields, TrackingTokenType } from '../types';

/**
 * Délky payloadů pocházejí z kontraktu 4.10.3 a jen se propouštějí dál, aby
 * v téhle doméně neexistovalo druhé místo, kde je někdo napíše ručně.
 */
export { PAYLOAD_BYTES };

/** type + key_id před payloadem. Součást zmrazeného layoutu. */
const HEADER_BYTES = 2;
const NONCE_BYTES = 8;

/**
 * Délka hotového tokenu ve ZNACÍCH, ne v bajtech. Kontrakt ji neexportuje
 * a nemá proč: plyne z PAYLOAD_BYTES a z base64url bez paddingu. Dopočítává
 * se proto tady a nikdy se nepíše ručně, jinak vznikne druhé místo, které
 * se při změně layoutu tiše rozejde.
 */
export const TOKEN_CHARS: Readonly<Record<TrackingTokenType, number>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(PAYLOAD_BYTES) as TrackingTokenType[]).map((type) => {
      const rawBytes = HEADER_BYTES + PAYLOAD_BYTES[type] + TOKEN_MAC_BYTES;
      const remainder = rawBytes % 3;
      const bodyChars = Math.ceil(rawBytes / 3) * 4 - (remainder === 0 ? 0 : 3 - remainder);
      return [type, TOKEN_PREFIX.length + bodyChars];
    }),
  ) as Record<TrackingTokenType, number>,
);

function nonceToHex(nonce: Uint8Array): string {
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce musí mít ${NONCE_BYTES} bajtů, dostal jsem ${nonce.length}`);
  }
  return Buffer.from(nonce).toString('hex');
}

/**
 * Doménový tvar na kontraktní. Jména polí jsou snake_case, protože jsou
 * součástí zmrazeného layoutu, a nonce jde jako hex řetězec.
 * Tahle funkce nesestavuje bajty, to dělá buildToken uvnitř kontraktu.
 */
export function toContractFields(fields: TrackingTokenFields): {
  type: TokenType;
  fields: TokenFields;
} {
  switch (fields.type) {
    case 'o':
      return {
        type: 'o',
        fields: {
          workspace_id: fields.workspaceId,
          message_id: fields.messageId,
          message_created_at: fields.messageCreatedAt,
        },
      };
    case 'c':
      return {
        type: 'c',
        fields: {
          workspace_id: fields.workspaceId,
          message_id: fields.messageId,
          link_id: fields.linkId,
          message_created_at: fields.messageCreatedAt,
        },
      };
    case 'i':
      return {
        type: 'i',
        fields: {
          workspace_id: fields.workspaceId,
          contact_id: fields.contactId,
          campaign_id: fields.campaignId,
          nonce: nonceToHex(fields.nonce),
          expires_at: fields.expiresAt,
        },
      };
    case 'u':
      return {
        type: 'u',
        fields: {
          workspace_id: fields.workspaceId,
          message_id: fields.messageId,
          contact_id: fields.contactId,
          list_id: fields.listId,
          message_created_at: fields.messageCreatedAt,
        },
      };
  }
}

/**
 * Kontraktní tvar na doménový. Kontraktní TokenFields je
 * `Record<string, string | number>`, takže se hodnoty musí přetypovat: bez toho
 * by se `message_created_at` dostalo do jsonb jako řetězec a nikdo by si toho
 * nevšiml, dokud by se nad ním nepočítalo.
 */
export function fromContractFields(type: TokenType, fields: TokenFields): TrackingTokenFields {
  const text = (name: string): string => String(fields[name]);
  const u32 = (name: string): number => Number(fields[name]);

  switch (type) {
    case 'o':
      return {
        type: 'o',
        workspaceId: text('workspace_id'),
        messageId: text('message_id'),
        messageCreatedAt: u32('message_created_at'),
      };
    case 'c':
      return {
        type: 'c',
        workspaceId: text('workspace_id'),
        messageId: text('message_id'),
        linkId: text('link_id'),
        messageCreatedAt: u32('message_created_at'),
      };
    case 'i':
      return {
        type: 'i',
        workspaceId: text('workspace_id'),
        contactId: text('contact_id'),
        campaignId: text('campaign_id'),
        nonce: new Uint8Array(Buffer.from(text('nonce'), 'hex')),
        expiresAt: u32('expires_at'),
      };
    case 'u':
      return {
        type: 'u',
        workspaceId: text('workspace_id'),
        messageId: text('message_id'),
        contactId: text('contact_id'),
        listId: text('list_id'),
        messageCreatedAt: u32('message_created_at'),
      };
  }
}
