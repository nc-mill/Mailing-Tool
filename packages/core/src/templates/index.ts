import { registerRepoModule } from '@mlain/db';
import { findTemplateById, findTemplateIdsUsingField, listTemplates } from './repository';
import { listVersions } from './versions';
import { loadAssetRefs } from './assets';

export { assetIdsInDocument, loadAssetRefs } from './assets';
export {
  ASSET_REF_TYPES,
  clearAssetReferences,
  syncAssetReferences,
  type AssetRefType,
} from './asset-references';
export { compileTemplate, type CompileTemplateInput } from './compile';
/**
 * Převlečení uložených e-mailů do barev značky. Volá ho uložení značky
 * v `apps/web`, takže musí být vidět z veřejné plochy domény.
 */
export { redressTemplatesToBrand, type RedressResult } from './redress';
export {
  assertSendable,
  preSendCheck,
  PreSendBlockedError,
  type PreSendFinding,
  type PreSendInput,
  type PreSendResult,
} from './precheck';
export {
  copyName,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  renameTemplate,
  restoreTemplate,
  restoreTemplateVersion,
  saveDesign,
  type CreateTemplateInput,
  type ServiceContext,
} from './service';
export {
  TEMPLATES_AUDIT_ACTIONS,
  TemplatesAuditActions,
  writeTemplatesAudit,
  type TemplatesAuditAction,
} from './audit';
export {
  categoryOf,
  countTemplatesByCategory,
  createTemplateRow,
  EMPTY_TEMPLATE_USAGE,
  findDeletedTemplateById,
  findTemplateById,
  findTemplateIdsUsingField,
  listTemplates,
  loadTemplateUsage,
  renameTemplateRow,
  restoreTemplateRow,
  setValidationState,
  softDeleteTemplate,
  updateTemplateDesign,
  type ListCursor,
  type TemplateCategory,
  type TemplateCategoryCounts,
  type TemplateKind,
  type TemplateRow,
  type TemplateUsage,
} from './repository';
export {
  sendTemplateTest,
  TestSendError,
  TEST_SEND_MAX_PER_WINDOW,
  TEST_SEND_MAX_RECIPIENTS,
  TEST_SEND_WINDOW_SECONDS,
  type TestSendInput,
  type TestSendResult,
} from './test-send';
export { validateTemplateDocument, type ValidateContext, type ValidationResult } from './validate';
export {
  createVersion,
  listVersions,
  pruneVersions,
  restoreVersion,
  type CreateVersionInput,
  type VersionReason,
  type VersionRow,
} from './versions';

// ODCHYLKA OD PLÁNU: plán tady reexportuje ještě `findTemplatesUsingField`
// z `./field-usage` a `exportTemplate`/`importTemplate` z `./transfer`.
// Oba soubory vznikají až v úkolech 40 a 41, tedy mimo rozsah téhle dodávky,
// a reexport neexistujícího modulu by shodil každý import domény.
// Doplní se spolu s těmi úkoly.

/**
 * Registrace do generického testu izolace z P03. Ten pod cizím kontextem zavolá
 * každou zapsanou čtecí funkci a ověří, že nevrátí nic.
 *
 * Bez registrace má vlastní izolační test jen `findTemplateById` a zbylé čtecí
 * funkce žádný. Přesně o tom je poznámka P03: „bez registru by každý doménový
 * plán musel na izolaci pamatovat sám, a to je právě ten druh ochrany, který
 * nic nevynucuje."
 *
 * Identifikátory jsou schválně náhodné: test nesmí potřebovat data, jen ověřuje,
 * že cizí kontext nevrátí řádek.
 */
const PROBE_ID = '00000000-0000-0000-0000-0000000000ff';

registerRepoModule({
  name: 'templates',
  readers: [
    // Registr transakci otevírá sám a předává hotové `tx` i kontext, takže se
    // tady `withWorkspace` nevolá; plán ho tu měl navíc a druhá transakce nad
    // týmž spojením je přesně to, co kapitola 0.7 zakazuje.
    { name: 'findTemplateById', call: (tx, ctx) => findTemplateById(tx, ctx, PROBE_ID) },
    { name: 'listTemplates', call: (tx, ctx) => listTemplates(tx, ctx, { limit: 5 }) },
    { name: 'listVersions', call: (tx, ctx) => listVersions(tx, ctx, PROBE_ID) },
    {
      name: 'findTemplateIdsUsingField',
      call: (tx, ctx) => findTemplateIdsUsingField(tx, ctx, 'contact.attr.city'),
    },
    { name: 'loadAssetRefs', call: (tx, ctx) => loadAssetRefs(tx, ctx, [PROBE_ID]) },
  ],
});
