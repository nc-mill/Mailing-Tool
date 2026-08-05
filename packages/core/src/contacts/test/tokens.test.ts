import { describe, expect, it } from 'vitest';
import { GLOBAL_LIST_ID, buildToken } from '@mlain/contracts/token';
import { type Keyring } from '@mlain/contracts/keyring';
import { ENDPOINT_TOKEN_TYPES, issueUnsubscribeToken, readPublicToken } from '../tokens';

/**
 * Test se NEptá mocku, ale skutečného kodeku z kontraktu. Mock by potvrdil jen to,
 * že adaptér volá funkci, kterou si test sám vymyslel; dřívější znění tohohle testu
 * mockovalo `encodeToken` a `decodeToken`, tedy dvě jména, která v kontraktu vůbec
 * nejsou. Prošel by a v provozu by spadl import.
 */
const keyring: Keyring = new Map([[1, new Uint8Array(32).fill(7)]]);

const fields = {
  workspace_id: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  message_id: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
  contact_id: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
  list_id: '0192f3a0-1c2d-7e45-8f60-718293a4b5c6',
  message_created_at: 1_785_000_000,
};

const tokenFor = (over: Partial<typeof fields> = {}) =>
  buildToken({ type: 'u', keyId: 1, fields: { ...fields, ...over }, keyring }).token;

describe('tabulka povolených typů', () => {
  it('všechny čtyři veřejné endpointy berou jen typ u', () => {
    // `/v/**` (zobrazení zprávy v prohlížeči) přibylo a jiný typ ani dostat nemůže:
    // odesílač skládá `webview_url` z TÉHOŽ odhlašovacího tokenu jako `preferences_url`.
    expect(ENDPOINT_TOKEN_TYPES).toEqual({
      '/u/**': ['u'],
      '/p/**': ['u'],
      '/r/**': ['u'],
      '/v/**': ['u'],
    });
  });
});

describe('readPublicToken', () => {
  it('vrátí data tokenu typu u', () => {
    const result = readPublicToken(tokenFor(), '/u/**', keyring);
    expect(result).toEqual({
      ok: true,
      data: {
        workspaceId: fields.workspace_id,
        messageId: fields.message_id,
        contactId: fields.contact_id,
        listId: fields.list_id,
        messageCreatedAt: new Date(fields.message_created_at * 1000),
        keyId: 1,
      },
    });
  });

  it.each(['o', 'c', 'i'] as const)('odmítne typ %s na endpointu /u/**', (type) => {
    // Krok 4 ověření z kontraktu. Kodek shodu typu s endpointem kontroluje sám,
    // adaptér mu jen předá, na kterém endpointu token dorazil.
    const foreign = buildToken({
      type,
      keyId: 1,
      keyring,
      fields:
        type === 'o'
          ? {
              workspace_id: fields.workspace_id,
              message_id: fields.message_id,
              message_created_at: fields.message_created_at,
            }
          : type === 'c'
            ? {
                workspace_id: fields.workspace_id,
                message_id: fields.message_id,
                link_id: fields.list_id,
                message_created_at: fields.message_created_at,
              }
            : {
                workspace_id: fields.workspace_id,
                contact_id: fields.contact_id,
                campaign_id: fields.list_id,
                nonce: '0011223344556677',
                expires_at: 4_000_000_000,
              },
    }).token;
    expect(readPublicToken(foreign, '/u/**', keyring)).toEqual({
      ok: false,
      code: 'token_type_mismatch',
    });
  });

  it('odmítne cizí typ i na /p/** a /r/**', () => {
    const opened = buildToken({
      type: 'o',
      keyId: 1,
      keyring,
      fields: {
        workspace_id: fields.workspace_id,
        message_id: fields.message_id,
        message_created_at: fields.message_created_at,
      },
    }).token;
    expect(readPublicToken(opened, '/p/**', keyring)).toEqual({
      ok: false,
      code: 'token_type_mismatch',
    });
    expect(readPublicToken(opened, '/r/**', keyring)).toEqual({
      ok: false,
      code: 'token_type_mismatch',
    });
  });

  it('list_id samých nul znamená globální rozsah, tedy listId null', () => {
    const result = readPublicToken(tokenFor({ list_id: GLOBAL_LIST_ID }), '/u/**', keyring);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.listId).toBeNull();
  });

  it('převádí TokenError na kód, nehází výjimku ven', () => {
    // verifyToken HÁZÍ, nevrací { ok: false }. Kdyby to adaptér nechytal, spadla by
    // veřejná stránka na neošetřené výjimce místo toho, aby ukázala "odkaz neplatí".
    expect(readPublicToken('nesmysl', '/u/**', keyring)).toEqual({
      ok: false,
      code: 'token_malformed',
    });
    const otherKeyring: Keyring = new Map([[1, new Uint8Array(32).fill(9)]]);
    expect(readPublicToken(tokenFor(), '/u/**', otherKeyring)).toEqual({
      ok: false,
      code: 'token_signature_invalid',
    });
    expect(
      readPublicToken(tokenFor(), '/u/**', new Map([[2, new Uint8Array(32).fill(7)]])),
    ).toEqual({
      ok: false,
      code: 'token_unknown_key',
    });
  });

  it('podepsaný token přežije rotaci klíče, dokud je staré pokolení v keyringu', () => {
    // KRITÉRIUM 60. Token vydaný pod pokolením 1 musí projít i po rotaci na 2.
    const afterRotation: Keyring = new Map([
      [1, new Uint8Array(32).fill(7)],
      [2, new Uint8Array(32).fill(8)],
    ]);
    expect(readPublicToken(tokenFor(), '/u/**', afterRotation).ok).toBe(true);
  });
});

describe('issueUnsubscribeToken', () => {
  it('globální odkaz zapíše list_id samých nul, ne vynechané pole', () => {
    const token = issueUnsubscribeToken({
      workspaceId: fields.workspace_id,
      messageId: fields.message_id,
      contactId: fields.contact_id,
      listId: null,
      messageCreatedAt: new Date(fields.message_created_at * 1000),
      keyring,
    });
    const read = readPublicToken(token, '/u/**', keyring);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.listId).toBeNull();
  });

  it('odkaz na seznam zapíše jeho id', () => {
    const token = issueUnsubscribeToken({
      workspaceId: fields.workspace_id,
      messageId: fields.message_id,
      contactId: fields.contact_id,
      listId: fields.list_id,
      messageCreatedAt: new Date(fields.message_created_at * 1000),
      keyring,
    });
    const read = readPublicToken(token, '/u/**', keyring);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.listId).toBe(fields.list_id);
  });

  it('čas zprávy se ukládá v celých sekundách, ne v milisekundách', () => {
    const token = issueUnsubscribeToken({
      workspaceId: fields.workspace_id,
      messageId: fields.message_id,
      contactId: fields.contact_id,
      listId: null,
      messageCreatedAt: new Date(fields.message_created_at * 1000 + 750),
      keyring,
    });
    const read = readPublicToken(token, '/u/**', keyring);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // u32 v payloadu nese sekundy. Milisekundy by přetekly a token by odkazoval
    // na úplně jiný čas, což by rozbilo atribuci odhlášení ke kampani.
    expect(read.data.messageCreatedAt.getTime()).toBe(fields.message_created_at * 1000);
  });
});
