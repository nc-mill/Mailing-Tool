import { z } from 'zod';
import { platformShape } from './schema-platform';
import { campaignsShape, contactsShape, contentShape, trackingShape } from './schema-domains';

export const configShape = {
  ...platformShape,
  ...contactsShape,
  ...contentShape,
  ...campaignsShape,
  ...trackingShape,
};

export const ConfigSchema = z.object(configShape);

export type MlainConfig = z.infer<typeof ConfigSchema> & {
  UPLOADS_DIR: string;
  BACKUP_DIR: string;
  DATABASE_URL_SENDER: string;
  TRACKING_DOMAIN: string;
  ASSET_BASE_URL: string;
};

/** Seznam všech názvů proměnných. Používá ho podpora _FILE i generátor manifestu. */
export function configVariableNames(): string[] {
  return Object.keys(configShape).sort();
}
