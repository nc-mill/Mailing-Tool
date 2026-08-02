import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptEnvelope, encryptEnvelope, envelopeKeyId } from '@mlain/contracts/crypto';
import { parseKeyring } from '@mlain/contracts/keyring';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { rotateCredentials } from '../../src/ops/rotate-credentials';

const KEY_1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const KEY_2 = 'HxwdGxoZGBcWFRQTEhEQDw4NDAsKCQgHBgUEAwIBAAE';
const keyring1 = parseKeyring({ secretKey: `1:${KEY_1}` });
let pg: TestPostgres;
let workspaceA: string;
let workspaceB: string;

const rotateInput = () => ({
  adminUrl: pg.ownerUrl,
  secretKey: `2:${KEY_2}`,
  secretKeyPrevious: `1:${KEY_1}`,
});

beforeAll(async () => {
  pg = await startTestPostgres();
  ({ workspaceId: workspaceA } = await pg.seedMinimalInstallation({ contacts: 1 }));
  // Druhý projekt je tu schválně. Obálka je přes AAD vázaná na workspace_id,
  // takže rotace, která by projekt nebrala v potaz, uspěje u prvního řádku
  // a u druhého selže na dešifrování. S jedním projektem by ta chyba prošla.
  ({ workspaceId: workspaceB } = await pg.seedMinimalInstallation({
    contacts: 1,
    ownerEmail: 'druhy@example.test',
  }));
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

async function seedProviderWithOldKey(workspaceId: string): Promise<string> {
  // POZOR na tvar volání. Kontrakt P02 bere jeden objekt, `plaintext` je
  // ŘETĚZEC (ne Buffer), klíč se předává jako `keyring`, ne `master`,
  // a `workspaceId` je POVINNÉ, protože vstupuje do AAD.
  const { stored } = encryptEnvelope({
    plaintext: '{"accessKeyId":"AKIA"}',
    keyId: 1,
    keyring: keyring1,
    context: 'sending_provider',
    workspaceId,
  });
  const [row] = await pg.sql<{ id: string }>(
    `INSERT INTO sending_providers (workspace_id, name, type, config_encrypted)
     VALUES ($1, 'Testovací provider', 'smtp', $2)
     RETURNING id`,
    [workspaceId, stored],
  );
  return row!.id;
}

describe('rotateCredentials', () => {
  it('přešifruje všechny obálky na aktuální pokolení (kritérium 55)', async () => {
    const id = await seedProviderWithOldKey(workspaceA);
    const report = await rotateCredentials(rotateInput());
    expect(report.rotated).toBeGreaterThanOrEqual(1);
    const [row] = await pg.sql<{ config_encrypted: string }>(
      'SELECT config_encrypted FROM sending_providers WHERE id = $1',
      [id],
    );
    expect(envelopeKeyId(row!.config_encrypted)).toBe(2);
  });

  it('přešifruje i řádky druhého projektu, tedy AAD bere z řádku', async () => {
    // Kdyby rotace předávala do encryptEnvelope pevný nebo chybný workspaceId,
    // dešifrování téhle obálky by skončilo v `failed` a report by přesto
    // vypadal jako částečný úspěch.
    const id = await seedProviderWithOldKey(workspaceB);
    const report = await rotateCredentials(rotateInput());
    expect(report.failed).toEqual([]);
    const [row] = await pg.sql<{ config_encrypted: string }>(
      'SELECT config_encrypted FROM sending_providers WHERE id = $1',
      [id],
    );
    expect(envelopeKeyId(row!.config_encrypted)).toBe(2);
  });

  it('přešifrovanou hodnotu jde přečíst zpátky se stejným obsahem', async () => {
    // Bez tohohle testu by prošla i rotace, která obálku vyrobí správně
    // tvarovanou, ale s jiným obsahem. Dešifrování je jediný důkaz.
    const id = await seedProviderWithOldKey(workspaceA);
    await rotateCredentials(rotateInput());
    const [row] = await pg.sql<{ config_encrypted: string; workspace_id: string }>(
      'SELECT config_encrypted, workspace_id FROM sending_providers WHERE id = $1',
      [id],
    );
    const plaintext = decryptEnvelope({
      stored: row!.config_encrypted,
      context: 'sending_provider',
      workspaceId: row!.workspace_id,
      keyring: parseKeyring({ secretKey: `2:${KEY_2}`, secretKeyPrevious: `1:${KEY_1}` }),
    });
    expect(JSON.parse(plaintext)).toEqual({ accessKeyId: 'AKIA' });
  });

  it('je idempotentní, druhý běh nic nepřešifruje', async () => {
    await rotateCredentials(rotateInput());
    const second = await rotateCredentials(rotateInput());
    expect(second.rotated).toBe(0);
    expect(second.alreadyCurrent).toBeGreaterThanOrEqual(1);
  });

  it('nikdy nehlásí, že staré klíče jdou odebrat', async () => {
    const report = await rotateCredentials(rotateInput());
    expect(report.notice).toMatch(/SECRET_KEY_PREVIOUS/);
    expect(report.notice).not.toMatch(/můžete odebrat|lze odebrat|už nejsou potřeba/i);
  });

  it('obálku, kterou nejde dešifrovat, přeskočí a nahlásí, místo aby ji zahodila', async () => {
    await pg.sql(
      `INSERT INTO sending_providers (workspace_id, name, type, config_encrypted)
       VALUES ($1, 'Rozbitý', 'smtp', 'enc:v1:AAAA')`,
      [workspaceA],
    );
    const report = await rotateCredentials(rotateInput());
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toContain('sending_providers');
    // Řádek zůstal nedotčený. Rotace nesmí poškodit to, co nepřečetla.
    const [row] = await pg.sql<{ config_encrypted: string }>(
      `SELECT config_encrypted FROM sending_providers WHERE name = 'Rozbitý'`,
    );
    expect(row!.config_encrypted).toBe('enc:v1:AAAA');
    await pg.sql(`DELETE FROM sending_providers WHERE name = 'Rozbitý'`);
  });

  it('odmítne běžet, když ve schématu je neregistrovaný šifrovaný sloupec', async () => {
    await pg.sql(`CREATE TABLE pokus2 (id uuid primary key, x_encrypted text)`);
    await expect(rotateCredentials(rotateInput())).rejects.toThrow(/pokus2/);
    await pg.sql('DROP TABLE pokus2');
  });

  it('zapíše do auditu akci credentials.rotated', async () => {
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'credentials.rotated'",
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
