import { z } from 'zod';
import type { ProviderConfig, ProviderPublicConfig } from './types';

const sesSchema = z
  .object({
    kind: z.literal('ses'),
    region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
    access_key_id: z.string().min(16).max(128),
    secret_access_key: z.string().min(16).max(256),
    configuration_set_name: z.string().min(1).max(64),
    sns_topic_arn: z.string().nullable(),
    max_send_rate: z.number().positive(),
    max_24h_send: z.number().int().positive().nullable(),
  })
  .strict();

const smtpSchema = z
  .object({
    kind: z.literal('smtp'),
    host: z.string().min(1).max(255),
    port: z.union([z.literal(25), z.literal(465), z.literal(587), z.literal(2525)]),
    username: z.string().min(1).max(255),
    password: z.string().min(1).max(512),
    encryption: z.enum(['starttls', 'tls', 'none']),
    max_send_rate: z.number().int().min(1).max(500).default(10),
    max_connections: z.number().int().min(1).max(50).default(5),
    max_messages_per_connection: z.number().int().min(1).max(10_000).default(100),
  })
  .strict();

export const providerConfigSchema = z.discriminatedUnion('kind', [sesSchema, smtpSchema]);

export function mask(value: string): string {
  if (value.length < 9) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/**
 * config_public je ODVOZENA kopie pro UI a preflight, kterou aplikace prepisuje pri
 * kazdem zapisu ze stejneho vstupu. Zdrojem pravdy je sifrovana obalka; sender cte
 * jen ji, aby se dva zdroje nemohly rozejit.
 */
export function derivePublicConfig(config: ProviderConfig): ProviderPublicConfig {
  switch (config.kind) {
    case 'ses':
      return {
        kind: 'ses',
        region: config.region,
        configuration_set_name: config.configuration_set_name,
        sns_topic_arn: config.sns_topic_arn,
        access_key_id_masked: mask(config.access_key_id),
      };
    case 'smtp':
      return {
        kind: 'smtp',
        host: config.host,
        port: config.port,
        encryption: config.encryption,
        username_masked: mask(config.username),
      };
    default: {
      // Zadny switch nad typem provideru nesmi byt bez vetve default. Neznamy typ
      // se ohlasi jako nepodporovany a zbytek systemu bezi dal.
      const unknown = config as { kind: string };
      throw new Error(`Nepodporovaný typ odesílacího účtu: ${unknown.kind}`);
    }
  }
}
