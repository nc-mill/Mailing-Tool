import { perJob } from '../../queues';
import { credentialsRefreshHandler, type CredentialsRefreshPayload } from './credentials-refresh';
import { systemCredentialsRefreshDeps } from './system-deps';

/**
 * Vstupní bod, který hledá codegen workeru (P01, rozhodnutí D4).
 *
 * Jméno souboru i jméno exportu `handlers` jsou ZÁVAZNÁ: codegen globuje
 * `packages/core/src/<domena>/jobs/queue-handlers.ts`. Nová doména navíc musí
 * mít v `packages/core/package.json` klíč `./sender/jobs` v mapě `exports`,
 * jinak codegen skončí chybou a build workeru se nesestaví.
 *
 * Doména `sender` má jedinou frontu a jinou už mít nebude: sender je proces
 * v Go s vlastní smyčkou nad outboxem a pg-boss nepoužívá. Tahle jediná fronta
 * je práce, kterou za něj musí udělat aplikace, protože sahá na šifrovaný
 * sloupec a k tomu má granty ona, ne on.
 */
export const handlers = {
  /**
   * `perJob`, ne `once`: náklad nese `workspace_id` a `provider_id`, takže každá
   * úloha je jiná práce nad jiným účtem. S `once` by se z dávky vyřídil jeden
   * účet a na zbytek by se zapomnělo.
   */
  'sender.credentials_refresh': perJob<CredentialsRefreshPayload>(async (job) => {
    await credentialsRefreshHandler(systemCredentialsRefreshDeps(), job.data);
  }),
} as const;
