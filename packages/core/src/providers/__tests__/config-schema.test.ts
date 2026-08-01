import { describe, expect, it } from 'vitest';
import { providerConfigSchema, derivePublicConfig, mask } from '../config-schema';

const ses = {
  kind: 'ses',
  region: 'eu-central-1',
  access_key_id: 'AKIAIOSFODNN7ABCD',
  secret_access_key: 'x'.repeat(40),
  configuration_set_name: 'mlain-acme',
  sns_topic_arn: null,
  max_send_rate: 14,
  max_24h_send: 50_000,
};

const smtp = {
  kind: 'smtp',
  host: 'smtp.wedos.net',
  port: 587,
  username: 'jana@firma.cz',
  password: 'tajne',
  encryption: 'starttls',
  max_send_rate: 10,
  max_connections: 5,
  max_messages_per_connection: 100,
};

describe('konfigurace provideru', () => {
  it('klice jsou snake_case, protoze JSON cte TypeScript i Go', () => {
    expect(providerConfigSchema.parse(ses)).toHaveProperty('access_key_id');
  });

  it('SMTP port mimo povolenou sadu neprojde', () => {
    expect(providerConfigSchema.safeParse({ ...smtp, port: 12345 }).success).toBe(false);
    for (const port of [25, 465, 587, 2525]) {
      expect(providerConfigSchema.safeParse({ ...smtp, port }).success).toBe(true);
    }
  });

  it('SMTP rozsahy: rate 1 az 500, spojeni 1 az 50, zprav na spojeni 1 az 10000', () => {
    expect(providerConfigSchema.safeParse({ ...smtp, max_send_rate: 501 }).success).toBe(false);
    expect(providerConfigSchema.safeParse({ ...smtp, max_connections: 51 }).success).toBe(false);
    expect(
      providerConfigSchema.safeParse({ ...smtp, max_messages_per_connection: 10_001 }).success,
    ).toBe(false);
  });

  it('verejna kopie nikdy neobsahuje tajemstvi', () => {
    const pub = derivePublicConfig(providerConfigSchema.parse(ses));
    expect(JSON.stringify(pub)).not.toContain('x'.repeat(40));
    expect(pub).toMatchObject({ kind: 'ses', access_key_id_masked: 'AKIA****ABCD' });
  });

  it('maskuje prvni ctyri a posledni ctyri znaky', () => {
    expect(mask('AKIAIOSFODNN7ABCD')).toBe('AKIA****ABCD');
    expect(mask('abc')).toBe('****');
  });

  it('u SMTP se maskuje uzivatelske jmeno, heslo se nezobrazi nikdy', () => {
    const pub = derivePublicConfig(providerConfigSchema.parse(smtp));
    expect(pub).toMatchObject({ kind: 'smtp', host: 'smtp.wedos.net', port: 587 });
    expect(JSON.stringify(pub)).not.toContain('tajne');
  });

  it('neznamy kind se odmita, ale kod nikde nema switch bez default', () => {
    expect(providerConfigSchema.safeParse({ ...ses, kind: 'postmark' }).success).toBe(false);
  });
});
