import { isUrlFromUser } from './context';
import { listMergeTags, type MergeTagCatalog } from './list-merge-tags';
import {
  composeTemplateInput,
  extractBrandInput,
  listMergeTagsInput,
  suggestSubjectInput,
  writeCopyInput,
} from './schemas';

/**
 * Definice nástroje ve tvaru, který AI SDK v7 očekává: `description`,
 * `inputSchema` a `execute`.
 *
 * Doména schválně NEVOLÁ `tool()` z balíčku `ai`. Dva důvody, oba praktické:
 * 1) SDK typy by prosákly do veřejné deklarační plochy `@mlain/core` a
 *    `tsc` s `declaration: true` to odmítne jako nepřenositelné
 *    (TS2742, ověřeno, ne teoreticky),
 * 2) hranice SDK má být jeden adresář. Obalení helperem dělá adaptér
 *    funkcí `toSdkTools()` v `src/ai/sdk`, tedy přesně tam, kam patří.
 */
export type ToolDefinition = {
  description: string;
  inputSchema: unknown;
  execute: (input: never, options?: unknown) => Promise<unknown>;
};

export type ToolContext = {
  workspaceId: string;
  templateId: string;
  language: string;
  /** Adresy, které v téhle konverzaci napsal uživatel. */
  userUrls: ReadonlySet<string>;
  /**
   * Katalog polí z P07. Nikdy se z něj nečte nic jiného než `fields`, tedy
   * definice. Hodnoty kontaktů se do promptu nedostanou ani omylem.
   */
  fieldCatalog: MergeTagCatalog;
  startBrandExtraction: (params: { workspaceId: string; url: string }) => Promise<{
    brandProfileId: string;
    palette: unknown;
    logoAssetId: string | null;
    warnings: string[];
  }>;
  composeTemplate: (input: unknown) => Promise<{ templateDraftId: string; preview: unknown }>;
  writeCopy: (input: unknown) => Promise<{ text: string } | { items: string[] }>;
  suggestSubject: (input: unknown) => Promise<{
    variants: Array<{ subject: string; preheader: string; rationale: string }>;
  }>;
};

/** Chyba nástroje se modelu vrací jako výsledek, aby se z ní mohl zotavit sám. */
async function safely<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return { error: code ?? 'tool_failed' };
  }
}

export function buildTools(ctx: ToolContext) {
  return {
    listMergeTags: {
      description:
        'Vrátí seznam dostupných personalizačních polí projektu. Zavolej vždy, než použiješ jakékoliv pole.',
      inputSchema: listMergeTagsInput,
      execute: async () => safely(async () => listMergeTags(ctx.fieldCatalog, ctx.language)),
    },

    extractBrand: {
      description:
        'Stáhne z webu logo, barvy a písmo. URL musí pocházet od uživatele, nevymýšlej ji.',
      inputSchema: extractBrandInput,
      execute: async (input: { url: string }) => {
        if (!isUrlFromUser(input.url, ctx.userUrls)) {
          return {
            error: 'url_not_provided_by_user',
            hint: 'Zeptej se uživatele, ze které adresy má nástroj stáhnout značku.',
          };
        }
        return safely(async () =>
          ctx.startBrandExtraction({ workspaceId: ctx.workspaceId, url: input.url }),
        );
      },
    },

    composeTemplate: {
      description: 'Sestaví celou šablonu e-mailu. Použij, když uživatel chce nový e-mail.',
      inputSchema: composeTemplateInput,
      execute: async (input: unknown) => safely(async () => ctx.composeTemplate(input)),
    },

    writeCopy: {
      description: 'Napíše nebo přepíše text jedné části e-mailu.',
      inputSchema: writeCopyInput,
      execute: async (input: unknown) => safely(async () => ctx.writeCopy(input)),
    },

    suggestSubject: {
      description: 'Navrhne varianty předmětu a preheaderu.',
      inputSchema: suggestSubjectInput,
      execute: async (input: unknown) => safely(async () => ctx.suggestSubject(input)),
    },
  };
}

export type AssistantTools = ReturnType<typeof buildTools>;
