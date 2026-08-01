/** Uzavreny vycet SCHVALNE, ale ne navzdy: MVP 2 slibuje pluginove providery. */
export const PROVIDER_TYPES = ['ses', 'smtp'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number] | (string & {});

export const PROVIDER_STATUSES = [
  'unverified',
  'verifying',
  'ready',
  'degraded',
  'blocked',
  'disabled',
] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number] | (string & {});

export type SesConfig = {
  kind: 'ses';
  region: string;
  access_key_id: string;
  secret_access_key: string;
  configuration_set_name: string;
  sns_topic_arn: string | null;
  max_send_rate: number;
  max_24h_send: number | null;
};

export type SmtpConfig = {
  kind: 'smtp';
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: 'starttls' | 'tls' | 'none';
  max_send_rate: number;
  max_connections: number;
  max_messages_per_connection: number;
};

export type ProviderConfig = SesConfig | SmtpConfig;

export type ProviderPublicConfig =
  | {
      kind: 'ses';
      region: string;
      configuration_set_name: string;
      sns_topic_arn: string | null;
      access_key_id_masked: string;
    }
  | { kind: 'smtp'; host: string; port: number; encryption: string; username_masked: string };
