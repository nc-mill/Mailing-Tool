import { describe, expect, it } from 'vitest';
import { GLOBAL_LIST_ID, buildToken, verifyToken } from '@mlain/contracts/token';
import { PAYLOAD_BYTES, TOKEN_CHARS, fromContractFields, toContractFields } from './codec';
import { buildTrackingKeyring } from './keyring';
import type { TrackingTokenFields } from '../types';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const MSG = '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182';
const LINK = '0192f3a0-1c2d-7e42-9c3d-4e5f60718293';
const CONTACT = '0192f3a0-1c2d-7e43-8d4e-5f60718293a4';
const CAMPAIGN = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});

/**
 * Round-trip vede přes SKUTEČNÝ kontraktní kodek, tedy přes bajty i MAC.
 * Adaptér se nesmí testovat sám proti sobě: kdyby si obě strany mapování
 * pletly stejně, test by prošel a token by se rozešel s Go senderem.
 */
function roundTrip(fields: TrackingTokenFields): { fields: TrackingTokenFields; token: string } {
  const contract = toContractFields(fields);
  const { token } = buildToken({
    type: contract.type,
    keyId: 1,
    fields: contract.fields,
    keyring: ring,
  });
  const verified = verifyToken({
    token,
    endpointType: contract.type,
    keyring: ring,
    now: 0,
    isNonceUsed: () => false,
  });
  return { fields: fromContractFields(verified.type, verified.fields), token };
}

describe('token codec adapter', () => {
  it('délky payloadů přebírá z kontraktu, délky tokenů z nich dopočítává', () => {
    expect(PAYLOAD_BYTES).toEqual({ o: 36, c: 52, i: 60, u: 68 });
    expect(TOKEN_CHARS).toEqual({ o: 74, c: 96, i: 106, u: 117 });
  });

  it('open pole projdou kontraktním kodekem beze změny', () => {
    const fields = {
      type: 'o',
      workspaceId: WS,
      messageId: MSG,
      messageCreatedAt: 1784995200,
    } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect(result.token).toHaveLength(TOKEN_CHARS.o);
  });

  it('click pole nesou link_id jako UUID', () => {
    const fields = {
      type: 'c',
      workspaceId: WS,
      messageId: MSG,
      linkId: LINK,
      messageCreatedAt: 1784995200,
    } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect(result.token).toHaveLength(TOKEN_CHARS.c);
  });

  it('identity pole přeloží nonce mezi osmi bajty a hexem', () => {
    const fields = {
      type: 'i',
      workspaceId: WS,
      contactId: CONTACT,
      campaignId: CAMPAIGN,
      nonce: new Uint8Array(Buffer.from('0011223344556677', 'hex')),
      expiresAt: 1785000600,
    } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect((result.fields as typeof fields).nonce).toBeInstanceOf(Uint8Array);
    expect((result.fields as typeof fields).nonce).toHaveLength(8);
    // Kontrakt drží nonce jako hex řetězec, doména jako bajty. Kdyby se
    // překlad vynechal, prošlo by to typovou kontrolou a rozešlo se v MACu.
    expect(toContractFields(fields).fields['nonce']).toBe('0011223344556677');
  });

  it('nonce jiné délky než osm bajtů se odmítne při překladu, ne až v kontraktu', () => {
    expect(() =>
      toContractFields({
        type: 'i',
        workspaceId: WS,
        contactId: CONTACT,
        campaignId: CAMPAIGN,
        nonce: new Uint8Array(7),
        expiresAt: 1785000600,
      }),
    ).toThrow(/8 bajt/);
  });

  it('unsubscribe pole s nulovým list_id znamenají globální odhlášení', () => {
    const fields = {
      type: 'u',
      workspaceId: WS,
      messageId: MSG,
      contactId: CONTACT,
      listId: GLOBAL_LIST_ID,
      messageCreatedAt: 1784995200,
    } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect(result.token).toHaveLength(TOKEN_CHARS.u);
  });

  it('hraniční uint32 projde v obou směrech', () => {
    const fields = {
      type: 'o',
      workspaceId: WS,
      messageId: MSG,
      messageCreatedAt: 4294967295,
    } as const;
    expect(roundTrip(fields).fields).toEqual(fields);
    const zero = { ...fields, messageCreatedAt: 0 };
    expect(roundTrip(zero).fields).toEqual(zero);
  });

  it('message_created_at se vrací jako číslo, ne jako řetězec', () => {
    const fields = {
      type: 'o',
      workspaceId: WS,
      messageId: MSG,
      messageCreatedAt: 1784995200,
    } as const;
    // Kontraktní TokenFields je Record<string, string | number>. Bez přetypování
    // by se hodnota tiše dostala do jsonb metadata jako řetězec.
    expect(typeof (roundTrip(fields).fields as typeof fields).messageCreatedAt).toBe('number');
  });
});
