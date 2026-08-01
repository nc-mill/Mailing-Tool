import { compileDocument } from '@mlain/emails/compile/compile';
import type { CompileContext, CompileResult } from '@mlain/emails/compile/types';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';
import { assetIdsInDocument, loadAssetRefs } from './assets';
import { validateTemplateDocument } from './validate';

export type CompileTemplateInput = {
  tx: Tx;
  ctx: WorkspaceContext;
  document: Document;
  templateKind: 'campaign' | 'transactional' | 'system';
  fields: FieldCatalog;
  language: string;
  assetBaseUrl: string;
  purpose: 'send' | 'preview' | 'test';
  campaignId?: string | undefined;
  trackOpens: boolean;
  trackClicks: boolean;
  preheader?: string | undefined;
  now?: Date;
};

/**
 * Obal nad kontraktem: dohledá assety, znovu zvaliduje a teprve pak kompiluje.
 * Validace před kompilací je tvrdá brána z 3.8.4 C: kampaň s rozbitou šablonou
 * nesmí odejít ani tehdy, když se kontaktní pole smazalo až po uložení šablony.
 */
export async function compileTemplate(input: CompileTemplateInput): Promise<CompileResult> {
  const assetIds = assetIdsInDocument(input.document);
  const assets = await loadAssetRefs(input.tx, input.ctx, assetIds);

  const validation = validateTemplateDocument(input.document, {
    templateKind: input.templateKind,
    fields: input.fields,
    assetIds: new Set(Object.keys(assets)),
  });
  if (validation.state === 'invalid') {
    return { ok: false, issues: validation.issues.filter((issue) => issue.severity === 'error') };
  }

  const ctx: CompileContext = {
    workspaceId: input.ctx.workspaceId,
    campaignId: input.campaignId,
    templateKind: input.templateKind,
    fields: input.fields,
    language: input.language,
    assetBaseUrl: input.assetBaseUrl,
    assets,
    purpose: input.purpose,
    trackOpens: input.trackOpens,
    trackClicks: input.trackClicks,
    // `CompileContext.preheader` je `?: string` BEZ `| undefined`, takže se pod
    // `exactOptionalPropertyTypes` nesmí předat výslovné undefined, jen vynechat.
    ...(input.preheader === undefined ? {} : { preheader: input.preheader }),
    currentYear: (input.now ?? new Date()).getUTCFullYear(),
  };
  return compileDocument(validation.document!, ctx);
}
