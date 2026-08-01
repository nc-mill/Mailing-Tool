import type { PreparedDataSchema } from '@mlain/contracts/liquid/prepare-render-data';
import type { CompileResult, RenderSchema } from '@mlain/emails/compile/types';
import type { Tx } from '../tx';
import type { FieldCatalog } from '../contacts/fields/catalog';
import type { CampaignAudience } from './types';

/**
 * Jedenact klicu, ne deset. `excluded_sample` je pozadavek R-P07.6 a cte ho
 * `sampleAudienceState`. Kdyz v tomhle typu chybi, ochrana ukazkovych kontaktu
 * se NEZKOMPILUJE, protoze si ten klic bere pres `Pick<AudienceGateCounts, ...>`.
 *
 * Soucet vsech `excluded_*` plus `eligible` plus `duplicates_removed` musi dat `raw`.
 * Na tom stoji pojmenovany rozpad v kontrolnim seznamu (cast 6, 8.6.2), ktery
 * VYSLOVNE zakazuje souhrnny radek „Vyloučeno".
 */
export type AudienceGateCounts = {
  raw: number;
  eligible: number;
  excluded_suppressed: number;
  excluded_unsubscribed: number;
  excluded_unconfirmed: number;
  excluded_snoozed: number;
  excluded_processing_restricted: number;
  excluded_invalid_email: number;
  excluded_deleted: number;
  excluded_sample: number;
  duplicates_removed: number;
};

/**
 * Jediná podporovaná cesta k publiku. Cast 2 vyslovne zakazuje, aby si cast 4
 * psala vlastni SQL nad contacts, list_subscriptions a suppressions: podminky
 * zpusobilosti by pak existovaly na dvou mistech a za pul roku by se rozesly.
 */
export type AudiencePort = {
  compileToSql(input: {
    workspaceId: string;
    selection: { listIds?: string[]; segmentIds?: string[] };
    alias: string;
    paramOffset: number;
    asOf: Date;
  }): Promise<{ sql: string; params: unknown[] }>;

  /**
   * Rozpad po branach. Pocita ho cast 2, protoze poradi a pojmenovani bran vlastni
   * ona (jeji 4.1.6) a obalka kompilatoru je odecita uvnitr sebe, takze z jeho
   * vystupu nejde zjistit, kolik lidi kterou branou vypadlo. Viz pozadavek R-P07.1.
   */
  countGates(input: {
    workspaceId: string;
    audience: CampaignAudience;
    asOf: Date;
    timeoutMs?: number;
  }): Promise<AudienceGateCounts>;
};

/**
 * Kompilace sablony. Port je TENKY obal nad `compileTemplate` z domeny sablon
 * a jeho tvar je DOSLOVA tvar kontraktu 5 z P08. Zadne prekladani, zadne zuzovani.
 */
export type TemplatePort = {
  /**
   * Vraci `CompileResult` z P08 beze zmeny, tedy rozliseny svazek: pri `ok: false` nese
   * `issues` a NIKDY ne html. Kdo si z nej vezme `html` bez kontroly `ok`, nezkompiluje se.
   */
  compileTemplate(input: {
    tx: Tx;
    workspaceId: string;
    document: unknown;
    templateKind: 'campaign' | 'transactional' | 'system';
    fields: FieldCatalog;
    language: string;
    assetBaseUrl: string;
    /** Pro kampan vzdy 'send'; pri 'send' je `campaignId` POVINNE, jinak P08 vraci tvrdou chybu. */
    purpose: 'send' | 'preview' | 'test';
    campaignId?: string;
    trackOpens: boolean;
    trackClicks: boolean;
    preheader?: string;
    now?: Date;
  }): Promise<CompileResult>;

  /**
   * Zuzeni `renderSchema` z kontraktu 5 na tvar, ktery bere `prepareRenderData`.
   * Obe strany pouzivaji jmeno `RenderSchema` pro NECO JINEHO, takze prevod musi
   * projit touhle funkci; pretypovanim by se ztratila kontrola uplne.
   */
  toPreparedSchema(schema: RenderSchema): PreparedDataSchema;

  /** Ukazkova data pro testovaci odeslani, kdyz je publikum prazdne (R3.6). */
  sampleContact(): Record<string, unknown>;
};

export type SuppressionPort = {
  add(input: {
    workspaceId: string;
    email: string;
    reason: 'hard_bounce' | 'complaint' | 'soft_bounce_threshold' | 'ses_suppressed';
    source: 'ses_event';
    metadata: Record<string, unknown>;
  }): Promise<{ created: boolean; suppressionId: string }>;
  isSuppressed(input: { workspaceId: string; email: string }): Promise<boolean>;
};

export type AuditPort = {
  write(input: {
    workspaceId: string;
    action: string;
    actor: 'system' | { userId: string };
    target?: { type: string; id: string };
    detail?: unknown;
  }): Promise<void>;
};

export type OutgoingWebhookPort = {
  emit(input: {
    workspaceId: string;
    type: string;
    occurredAt: Date;
    data: unknown;
  }): Promise<void>;
};

type PortMap = {
  audience: AudiencePort;
  template: TemplatePort;
  suppression: SuppressionPort;
  audit: AuditPort;
  webhook: OutgoingWebhookPort;
};

export function createPortRegistry() {
  const ports: Partial<PortMap> = {};
  function get<K extends keyof PortMap>(key: K): PortMap[K] {
    const p = ports[key];
    if (!p) throw new Error(`${key} port není zaregistrovaný. Zaregistruj ho při startu procesu.`);
    return p;
  }
  return {
    register<K extends keyof PortMap>(key: K, impl: PortMap[K]) {
      ports[key] = impl;
    },
    audience: () => get('audience'),
    template: () => get('template'),
    suppression: () => get('suppression'),
    audit: () => get('audit'),
    webhook: () => get('webhook'),
  };
}

export type PortRegistry = ReturnType<typeof createPortRegistry>;
