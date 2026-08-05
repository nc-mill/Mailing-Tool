import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeyring } from '../src/keyring';
import { buildToken, type TokenType } from '../src/token';
import { base32Lower, buildMessageId } from '../src/message-id';
import { encryptEnvelope, type CredentialContext } from '../src/crypto';
import { MESSAGES_CONTRACT_COLUMNS } from '../src/outbox';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const keyring = parseKeyring({
  secretKey: TEST_SECRET_KEY,
  secretKeyPrevious: `9:${TEST_SECRET_KEY}`,
});

const IDS = {
  workspace_id: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  message_id: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
  link_id: '0192f3a0-1c2d-7e42-9c3d-4e5f60718293',
  contact_id: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
  campaign_id: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
  list_id: '0192f3a0-1c2d-7e45-8f60-718293a4b5c6',
  message_created_at: 1_784_995_200,
  expires_at: 1_785_000_600,
  nonce: '0011223344556677',
};

/** Závazné hodnoty z kontraktu 4.10.3. Generátor se s nimi MUSÍ shodnout. */
const EXPECTED = {
  'TK-P1': 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g',
  'TK-P2':
    't1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2Aa8TprBxqhsgbR6l5AMMNpw',
  'TK-P3':
    't1aQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkONTl9gcYKTpAGS86AcLX5Enl9gcYKTpLUAESIzRFVmd2pk8pg7wFifQiBnNoxotJQLmO2S',
  'TK-P4':
    't1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QBkvOgHC1-RY9gcYKTpLXGamTdgE4PEWHmqWZZuZDCD6L2SMw',
  'TK-P5':
    't1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QAAAAAAAAAAAAAAAAAAAAAamTdgLfjJDF8FrY9mr1K2TawYXw',
};
const EXPECTED_MAC = {
  'TK-P1': 'd48e6713c0f62ed50f5ca6a9923ece20c1aa4f25d47e9ab6938c8d86d6eac5b5',
  'TK-P2': '6bc4e9ac1c6a86c81b47a97900c30da707294b163b6b84cdb238b9f88551ea2f',
  'TK-P3': '3bc0589f422067368c68b4940b98ed927cd9e33ec10058360f4af12a5d8d02f2',
  'TK-P4': '4e0f1161e6a96659b990c20fa2f648cc75bc9dd3bfaefc4f1a0ab35031e5dc9a',
};

/**
 * `sides` je součást fixture, ne úvaha runneru. Sender tokeny jen VYRÁBÍ, a to
 * jen tři typy: open, click a unsubscribe. Identity token (`i`) vydává aplikace
 * při přihlašování do preferencí, ověření tokenů dělá také aplikace. Go strana
 * proto zpracuje čtyři pozitivní vektory a žádný negativní. Zapsané je to tady,
 * aby check-parity věděl, kolik má na Go straně čekat, a aby přeskočení navíc
 * bylo vidět.
 */
function positive(
  id: string,
  type: TokenType,
  fields: Record<string, string | number>,
  sides: Array<'ts' | 'go'>,
) {
  const built = buildToken({ type, keyId: 1, fields, keyring });
  const expected = EXPECTED[id as keyof typeof EXPECTED];
  if (built.token !== expected) {
    throw new Error(
      `${id}: token se rozešel s kontraktem\n  vyrobeno: ${built.token}\n  kontrakt: ${expected}`,
    );
  }
  return {
    id,
    type,
    key_id: 1,
    fields,
    sides,
    expected_token: built.token,
    expected_mac_full: Buffer.from(built.macFull).toString('hex'),
  };
}

export async function generateTokenVectors(): Promise<void> {
  const BOTH: Array<'ts' | 'go'> = ['ts', 'go'];
  const TS_ONLY: Array<'ts' | 'go'> = ['ts'];

  const p1 = positive(
    'TK-P1',
    'o',
    {
      workspace_id: IDS.workspace_id,
      message_id: IDS.message_id,
      message_created_at: IDS.message_created_at,
    },
    BOTH,
  );
  const p2 = positive(
    'TK-P2',
    'c',
    {
      workspace_id: IDS.workspace_id,
      message_id: IDS.message_id,
      link_id: IDS.link_id,
      message_created_at: IDS.message_created_at,
    },
    BOTH,
  );
  // Identity token vydává aplikace, sender ho nikdy nestaví.
  const p3 = positive(
    'TK-P3',
    'i',
    {
      workspace_id: IDS.workspace_id,
      contact_id: IDS.contact_id,
      campaign_id: IDS.campaign_id,
      nonce: IDS.nonce,
      expires_at: IDS.expires_at,
    },
    TS_ONLY,
  );
  const p4 = positive(
    'TK-P4',
    'u',
    {
      workspace_id: IDS.workspace_id,
      message_id: IDS.message_id,
      contact_id: IDS.contact_id,
      list_id: IDS.list_id,
      message_created_at: IDS.message_created_at,
    },
    BOTH,
  );
  const p5 = positive(
    'TK-P5',
    'u',
    {
      workspace_id: IDS.workspace_id,
      message_id: IDS.message_id,
      contact_id: IDS.contact_id,
      list_id: '00000000-0000-0000-0000-000000000000',
      message_created_at: IDS.message_created_at,
    },
    BOTH,
  );
  for (const [id, mac] of Object.entries(EXPECTED_MAC)) {
    const found = [p1, p2, p3, p4].find((v) => v.id === id);
    if (!found) throw new Error(`${id}: vektor s plnou HMAC v generátoru chybí`);
    if (found.expected_mac_full !== mac)
      throw new Error(`${id}: plná HMAC se rozešla s kontraktem`);
  }

  const open = p1.expected_token;
  const unknownKey = buildToken({
    type: 'o',
    keyId: 9,
    keyring,
    fields: {
      workspace_id: IDS.workspace_id,
      message_id: IDS.message_id,
      message_created_at: IDS.message_created_at,
    },
  }).token;
  const expiredIdentity = buildToken({
    type: 'i',
    keyId: 1,
    keyring,
    fields: {
      workspace_id: IDS.workspace_id,
      contact_id: IDS.contact_id,
      campaign_id: IDS.campaign_id,
      nonce: IDS.nonce,
      expires_at: 1_700_000_000,
    },
  }).token;
  const truncated =
    't1' +
    Buffer.from(Buffer.from(open.slice(2), 'base64url').subarray(0, -1)).toString('base64url');

  const vectors = {
    contractVersion: 1,
    secret_key: TEST_SECRET_KEY,
    note: 'Vygenerováno scripts/generate-fixtures.ts. Pozitivní vektory se ověřují proti hodnotám z části 1, kapitoly 4.10.3.',
    positive: [p1, p2, p3, p4, p5],
    // Všechny negativní vektory jsou o OVĚŘENÍ tokenu, které dělá aplikace.
    // Sender ověřování nemá, proto sides: ['ts'].
    negative: [
      {
        id: 'TK-N1',
        token: open.slice(2),
        endpoint_type: 'o',
        expected_error: 'token_malformed',
        sides: TS_ONLY,
      },
      {
        id: 'TK-N2',
        token: open.slice(0, -1) + (open.endsWith('A') ? 'B' : 'A'),
        endpoint_type: 'o',
        expected_error: 'token_signature_invalid',
        sides: TS_ONLY,
      },
      {
        id: 'TK-N3',
        token: open,
        endpoint_type: 'c',
        expected_error: 'token_type_mismatch',
        sides: TS_ONLY,
      },
      {
        id: 'TK-N4',
        token: unknownKey,
        endpoint_type: 'o',
        expected_error: 'token_unknown_key',
        sides: TS_ONLY,
      },
      {
        id: 'TK-N5',
        token: truncated,
        endpoint_type: 'o',
        expected_error: 'token_malformed',
        sides: TS_ONLY,
      },
      {
        id: 'TK-N6',
        token: expiredIdentity,
        endpoint_type: 'i',
        expected_error: 'token_expired',
        now: 1_784_995_200,
        sides: TS_ONLY,
      },
      {
        id: 'TK-N7',
        token: p3.expected_token,
        endpoint_type: 'i',
        expected_error: 'token_already_used',
        now: 1_784_995_200,
        nonce_used: true,
        sides: TS_ONLY,
      },
      {
        id: 'TK-N8',
        token: 't1' + open.slice(2).replace(/-/g, '+').replace(/_/g, '/'),
        endpoint_type: 'o',
        expected_error: 'token_malformed',
        sides: TS_ONLY,
      },
      {
        id: 'TK-N9',
        token: open + '=',
        endpoint_type: 'o',
        expected_error: 'token_malformed',
        sides: TS_ONLY,
      },
    ],
  };

  await mkdir(path.join(packageRoot, 'fixtures', 'token'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'fixtures', 'token', 'vectors.json'),
    JSON.stringify(vectors, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Závazné hodnoty ověřené DVĚMA nezávislými výpočty (kapitola 6). Generátor je
 * zároveň kontraktní test: když se `base32Lower` rozejde s referenční tabulkou,
 * skončí chybou a fixture nevznikne.
 */
const MESSAGE_ID_EXPECTED: Record<string, string> = {
  'MI-001': 'agjphia4fv7edczmhvhf6ydrqi',
  'MI-002': 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
  'MI-003': '77777777777777777777777774',
  'MI-004': 'agjphia4fv7eaou2xds7byhdra',
};

export async function generateMessageIdVectors(): Promise<void> {
  const cases = [
    { id: 'MI-001', message_id: IDS.message_id, sending_domain: 'mail.example.cz' },
    {
      id: 'MI-002',
      message_id: '00000000-0000-0000-0000-000000000000',
      sending_domain: 'mail.example.cz',
    },
    {
      id: 'MI-003',
      message_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      sending_domain: 'mail.example.cz',
    },
    {
      id: 'MI-004',
      message_id: '0192f3a0-1c2d-7e40-3a9a-b8e5f0e0e388',
      sending_domain: 'zasilky.firma.cz',
    },
  ].map((item) => {
    const encoded = base32Lower(
      new Uint8Array(Buffer.from(item.message_id.replace(/-/g, ''), 'hex')),
    );
    const expected = MESSAGE_ID_EXPECTED[item.id];
    if (encoded !== expected) {
      throw new Error(
        `${item.id}: base32_lower se rozešel s referenční hodnotou\n  vyrobeno: ${encoded}\n  čeká se: ${expected}`,
      );
    }
    return {
      ...item,
      sides: ['ts', 'go'],
      expected_base32: encoded,
      expected_header: buildMessageId({
        messageId: item.message_id,
        sendingDomain: item.sending_domain,
      }),
    };
  });

  await mkdir(path.join(packageRoot, 'fixtures', 'message-id'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'fixtures', 'message-id', 'vectors.json'),
    JSON.stringify({ contractVersion: 1, cases }, null, 2) + '\n',
    'utf8',
  );
}

const CRYPTO_EXPECTED = {
  header_hex: '01011073656e64696e675f70726f7669646572',
  aad_hex:
    '6d61696c65722f637265642f763101011073656e64696e675f70726f76696465720192f3a01c2d7e409a1b2c3d4e5f6071',
  ciphertext_hex:
    'fae5c57114c84c4ec01591b018af427e916c8c3c557225764cf65a3051382d8128c6de1ac3e38c79c5e2d42b5dc41388e' +
    '567310ccf2aefcb6251a2dfe3f944983da3c3481b0bfd18beb9a930aa089a1231c84ed1',
  tag_hex: '1ef74b99f8ae68049656d9240d8b8807',
  envelope_bytes: 131,
  stored:
    'enc:v1:AQEQc2VuZGluZ19wcm92aWRlcgABAgMEBQYHCAkKC/rlxXEUyExOwBWRsBivQn6RbIw8VXIldkz2WjBROC2BKMbeGs' +
    'PjjHnF4tQrXcQTiOVnMQzPKu/LYlGi3+P5RJg9o8NIGwv9GL65qTCqCJoSMchO0R73S5n4rmgEllbZJA2LiAc=',
};

export async function generateCryptoVectors(): Promise<void> {
  const BOTH: Array<'ts' | 'go'> = ['ts', 'go'];
  const workspaceId = IDS.workspace_id;
  const otherWorkspaceId = '0192f3a0-1c2d-7e47-9a1b-2c3d4e5f6099';
  const nonceHex = '000102030405060708090a0b';
  const plaintext =
    '{"access_key_id":"AKIAEXAMPLE","secret_access_key":"s3cr3t","region":"eu-central-1"}';

  const result = encryptEnvelope({
    plaintext,
    context: 'sending_provider',
    workspaceId,
    keyring,
    keyId: 1,
    nonce: new Uint8Array(Buffer.from(nonceHex, 'hex')),
  });

  const checks: Array<[string, string, string]> = [
    ['header', Buffer.from(result.header).toString('hex'), CRYPTO_EXPECTED.header_hex],
    ['aad', Buffer.from(result.aad).toString('hex'), CRYPTO_EXPECTED.aad_hex],
    ['ciphertext', Buffer.from(result.ciphertext).toString('hex'), CRYPTO_EXPECTED.ciphertext_hex],
    ['tag', Buffer.from(result.tag).toString('hex'), CRYPTO_EXPECTED.tag_hex],
    ['stored', result.stored, CRYPTO_EXPECTED.stored],
  ];
  for (const [name, got, want] of checks) {
    if (got !== want) {
      throw new Error(
        `krypto vektor ${name} se rozešel s kontraktem\n  vyrobeno: ${got}\n  kontrakt: ${want}\n` +
          'Pozor: AAD neovlivňuje ciphertext, jen tag. Když sedí ciphertext a nesedí tag, ' +
          'chyba je v AAD, ne v klíči ani v nonce.',
      );
    }
  }

  const envelope = Buffer.from(result.stored.slice('enc:v1:'.length), 'base64');
  const header = Buffer.from(result.header);
  const body = envelope.subarray(header.length); // nonce || ciphertext || tag

  const flipped = Buffer.from(envelope);
  flipped.writeUInt8(flipped.readUInt8(40) ^ 0x01, 40);

  // CR-N2 testuje, že AAD sváže HLAVIČKU: obálka se přepíše tak, aby nesla JINÝ,
  // ale PLATNÝ kontext, a dešifruje se s očekáváním právě toho jiného kontextu.
  // Krok 5 (shoda kontextu) tedy projde a selhat musí až ověření tagu.
  //
  // Dřívější znění sem psalo vymyšlený řetězec `ai_provider_____` jen proto, aby
  // měl stejnou délku jako `sending_provider`. Ten kontext v uzavřeném výčtu
  // CREDENTIAL_CONTEXTS není a schéma to nevynucovalo, takže fixture testovala
  // tvar, který v produktu nemůže vzniknout. Délka se lišit smí: `context_len`
  // je součástí hlavičky a obálka zůstane dobře utvořená.
  const rewrittenContext: CredentialContext = 'webhook_secret';
  const rewrittenHeader = Buffer.concat([
    Buffer.from([0x01, 1, Buffer.byteLength(rewrittenContext, 'ascii')]),
    Buffer.from(rewrittenContext, 'ascii'),
  ]);
  const wrongContext = Buffer.concat([rewrittenHeader, body]);

  const wrongVersion = Buffer.from(envelope);
  wrongVersion[0] = 0x02;
  const unknownKey = Buffer.from(envelope);
  unknownKey[1] = 7;
  const withoutTag = envelope.subarray(0, envelope.length - 16);

  const vectors = {
    contractVersion: 1,
    secret_key: TEST_SECRET_KEY,
    // Pozitivní vektor zpracují obě strany, ale každá jinou půlkou: TypeScript
    // obálku VYROBÍ a porovná bajt na bajt, Go ji jen DEŠIFRUJE a porovná
    // plaintext. Sender totiž šifrovat neumí a umět nemá, credentials šifruje
    // aplikace. Že Go přečte, co TypeScript zapsal, je přesně to tvrzení,
    // které kritérium 45 vyžaduje.
    positive: [
      {
        id: 'CR-P1',
        key_id: 1,
        context: 'sending_provider',
        workspace_id: workspaceId,
        nonce_hex: nonceHex,
        plaintext,
        sides: BOTH,
        expected_header_hex: CRYPTO_EXPECTED.header_hex,
        expected_aad_hex: CRYPTO_EXPECTED.aad_hex,
        expected_ciphertext_hex: CRYPTO_EXPECTED.ciphertext_hex,
        expected_tag_hex: CRYPTO_EXPECTED.tag_hex,
        expected_stored: CRYPTO_EXPECTED.stored,
        expected_envelope_bytes: CRYPTO_EXPECTED.envelope_bytes,
      },
    ],
    negative: [
      {
        id: 'CR-N1',
        stored: 'enc:v1:' + flipped.toString('base64'),
        context: 'sending_provider',
        workspace_id: workspaceId,
        expected_error: 'crypto_auth_failed',
        sides: BOTH,
      },
      {
        id: 'CR-N2',
        stored: 'enc:v1:' + wrongContext.toString('base64'),
        context: rewrittenContext,
        workspace_id: workspaceId,
        expected_error: 'crypto_auth_failed',
        sides: BOTH,
      },
      {
        id: 'CR-N3',
        stored: CRYPTO_EXPECTED.stored,
        context: 'webhook_secret',
        workspace_id: workspaceId,
        expected_error: 'crypto_context_mismatch',
        sides: BOTH,
      },
      {
        id: 'CR-N4',
        stored: 'enc:v1:' + wrongVersion.toString('base64'),
        context: 'sending_provider',
        workspace_id: workspaceId,
        expected_error: 'crypto_unsupported_version',
        sides: BOTH,
      },
      {
        id: 'CR-N5',
        stored: 'enc:v1:' + unknownKey.toString('base64'),
        context: 'sending_provider',
        workspace_id: workspaceId,
        expected_error: 'crypto_unknown_key',
        sides: BOTH,
      },
      {
        id: 'CR-N6',
        stored: envelope.toString('base64'),
        context: 'sending_provider',
        workspace_id: workspaceId,
        expected_error: 'crypto_envelope_malformed',
        sides: BOTH,
      },
      {
        id: 'CR-N7',
        stored: 'enc:v1:' + withoutTag.toString('base64'),
        context: 'sending_provider',
        workspace_id: workspaceId,
        expected_error: 'crypto_auth_failed',
        sides: BOTH,
      },
      {
        id: 'CR-N8',
        stored: CRYPTO_EXPECTED.stored,
        context: 'sending_provider',
        workspace_id: otherWorkspaceId,
        expected_error: 'crypto_auth_failed',
        sides: BOTH,
      },
    ],
  };

  await mkdir(path.join(packageRoot, 'fixtures', 'crypto'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'fixtures', 'crypto', 'vectors.json'),
    JSON.stringify(vectors, null, 2) + '\n',
    'utf8',
  );
}

export async function generateLoopLimitFixture(): Promise<void> {
  const items = Array.from({ length: 205 }, (_, i) => `i${i + 1}`);
  const expected = items
    .slice(0, 200)
    .map((item) => `[${item}]`)
    .join('');
  const fixture = {
    id: 'LQ-403',
    description: 'pole delší než 200 prvků se ořezává na vstupu, obě strany identicky',
    context: 'html',
    level: 'authored',
    template: '{% for item in contact.tags %}[{{ item }}]{% endfor %}',
    data: { contact: { tags: items } },
    expected,
  };
  await mkdir(path.join(packageRoot, 'fixtures', 'liquid'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'fixtures', 'liquid', 'LQ-403.json'),
    JSON.stringify(fixture, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Typy kontraktních sloupců cizích tabulek. Hodnoty jsou `information_schema.columns.data_type`
 * a jsou ODEČTENÉ Z BĚŽÍCÍ PostgreSQL 18.4 nad bootstrapem, ne odhadnuté.
 *
 * Tabulky `sending_providers`, `campaign_links` a `message_events` tu SCHVÁLNĚ NEJSOU.
 * Kontrakt u nich vyjmenovává sloupce, ale ne typy, a bootstrap je nezakládá,
 * takže P02 jejich typy nezná. Hádat je by znamenalo červený build z důvodu,
 * který si P02 vymyslel. Jejich kontraktní sloupce hlídá test výš na existenci
 * jména, což je všechno, co je doložitelné. Doplnění typů je požadavek na
 * vlastníky těch tabulek, ne na tenhle plán.
 */
const FOREIGN_COLUMN_TYPES: Record<string, Record<string, string>> = {
  campaigns: {
    id: 'uuid',
    workspace_id: 'uuid',
    status: 'text',
    pause_reason: 'jsonb',
    scheduled_at: 'timestamp with time zone',
    audience_built_at: 'timestamp with time zone',
    provider_id: 'uuid',
    compiled_html: 'text',
    compiled_text: 'text',
    subject: 'text',
    preheader: 'text',
    from_name: 'text',
    from_email: 'text',
    reply_to: 'text',
    track_opens: 'boolean',
    track_clicks: 'boolean',
    deleted_at: 'timestamp with time zone',
  },
  workspaces: {
    id: 'uuid',
    deleted_at: 'timestamp with time zone',
  },
  suppressions: {
    workspace_id: 'uuid',
    email: 'USER-DEFINED',
    fingerprint: 'bytea',
    fingerprint_key_id: 'smallint',
    // Sender ho čte kvůli transakční poště: odhlášení z marketingu ji blokovat
    // nesmí, tvrdý odraz a výmaz podle GDPR ano.
    reason: 'text',
    removed_at: 'timestamp with time zone',
    created_at: 'timestamp with time zone',
  },
};

export async function generateContractColumns(): Promise<void> {
  // Tvar je PŘESNĚ { tabulka: { sloupec: typ } } a nic víc. Jakýkoliv další klíč,
  // třeba contractVersion, by skript z P01 vzal jako jméno tabulky a hlásil by,
  // že tabulka "contractVersion" po migracích neexistuje.
  const manifest: Record<string, Record<string, string>> = {
    messages: { ...MESSAGES_CONTRACT_COLUMNS },
    ...FOREIGN_COLUMN_TYPES,
  };
  await mkdir(path.join(packageRoot, 'schema'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'schema', 'columns.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateTokenVectors();
  await generateCryptoVectors();
  await generateMessageIdVectors();
  await generateLoopLimitFixture();
  await generateContractColumns();
}
