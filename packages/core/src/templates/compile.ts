import { compileDocument } from '@mlain/emails/compile/compile';
import type { CompileContext, CompileResult } from '@mlain/emails/compile/types';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { readContactsSettings } from '../contacts/settings';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';
import { assetIdsInDocument, loadAssetRefs } from './assets';
import { validateTemplateDocument } from './validate';

export type CompileTemplateInput = {
  tx: Tx;
  ctx: WorkspaceContext;
  document: Document;
  /**
   * PROFIL, ne `templates.kind`. Volající sem posílá `validationProfileFor(kind)`,
   * takže vedle `campaign` a `transactional` sem chodí i `page` (veřejná
   * stránka). Typ je ten z emitoru, aby doména neměla druhý seznam profilů.
   */
  templateKind: ValidationProfile;
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
 *
 * Nastavení projektu se čte TADY, protože kompilace je poslední místo, kde jde
 * do patičky sáhnout. Odesílač už interpoluje hotové HTML a odkaz z něj vyříznout
 * nedokáže; podrobně v `CompileContext.preferenceCenterEnabled`.
 */
export async function compileTemplate(input: CompileTemplateInput): Promise<CompileResult> {
  const assetIds = assetIdsInDocument(input.document);
  const [assets, settings] = await Promise.all([
    loadAssetRefs(input.tx, input.ctx, assetIds),
    readContactsSettings(input.tx, input.ctx),
  ]);

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
    // Vypnuté centrum předvoleb vyřadí odkaz „Nastavit předvolby" z patičky,
    // z HTML i z prostého textu. Odhlašovací odkaz zůstává vždy.
    preferenceCenterEnabled: settings.public_preference_center,
  };
  return compileDocument(validation.document!, ctx);
}
