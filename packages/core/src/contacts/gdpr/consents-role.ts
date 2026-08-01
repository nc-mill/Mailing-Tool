import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';

/**
 * Smazání souhlasů pod rolí `mlain_gdpr`, viz rozhodnutí R13 plánu.
 *
 * PROČ TENHLE PORT EXISTUJE. Migrace 0006 odebírá `mlain_app` právo UPDATE i DELETE
 * na `consents` a migrace 0005 dává DELETE jedině roli `mlain_gdpr`. P03 ale vystavuje
 * `PoolKind` jen jako `'app' | 'readOnly'` (ověřeno v `packages/db/src/client.ts`),
 * takže produkční cesta k té roli dnes NEEXISTUJE a `DELETE FROM consents` pod
 * aplikačním poolem skončí na 42501 při KAŽDÉM výmazu v režimu anonymize.
 *
 * Plán proto výslovně říká, že se nemá dělat, že problém není:
 *
 *  1. Dokud P04 nedodá `withGdpr` nad rozšířeným `PoolKind`, výmaz selže HLASITĚ
 *     a se srozumitelným důvodem `gdpr_role_unavailable`, ne tichým 42501 uprostřed
 *     transakce.
 *  2. Volá se jako POSLEDNÍ krok anonymizace, takže při chybějící roli se zruší celá
 *     transakce a po výmazu nezůstane polovina anonymizovaného kontaktu.
 *  3. Až obálka vznikne, zaregistruje se sem jedním řádkem při startu procesu a nic
 *     jiného se měnit nebude.
 */
export type ConsentEraser = (input: {
  workspaceId: string;
  contactId: string;
}) => Promise<{ deleted: number }>;

let eraser: ConsentEraser | null = null;

export function registerConsentEraser(fn: ConsentEraser): void {
  eraser = fn;
}

/** Jen pro testy: vrátí port do výchozího, tedy nedostupného stavu. */
export function resetConsentEraser(): void {
  eraser = null;
}

export function isConsentEraserAvailable(): boolean {
  return eraser !== null;
}

export async function eraseConsentsUnderGdprRole(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<number> {
  if (eraser === null) {
    throw new ApiError('not_implemented', {
      params: {
        detail: 'gdpr_role_unavailable',
        requirement:
          'PoolKind potřebuje hodnotu "gdpr" a adaptér packages/core/src/tx obálku withGdpr. ' +
          'Bez nich nemá aplikační role právo DELETE na consents a výmaz podle článku 17 ' +
          'nelze dokončit.',
      },
    });
  }
  const result = await eraser({ workspaceId: ctx.workspaceId, contactId });
  return result.deleted;
}
