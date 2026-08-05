import { createHash } from 'node:crypto';
import type { PreparedDataSchema } from '@mlain/contracts/liquid/prepare-render-data';
import type { CompileMeta, CompiledLink, RenderSchema } from '@mlain/emails/compile/types';
import { ApiError } from '../errors/api-error';
import type { RenderPlan } from './repo/outbox';

/**
 * Čistá logika kompilace kampaně: převod výstupu P08 na tvar k uložení a tři
 * kontroly kontraktu. Nic tady nesahá na databázi, aby to šlo otestovat bez ní.
 *
 * ODCHYLKA OD PLÁNU, VĚDOMÁ. Plán psal `AppError` z `@mlain/core/errors`. Taková
 * třída v repozitáři není, chybu domény nese `ApiError` a kódy `contract_mismatch`
 * i `campaign_not_compiled` v jeho registru jsou. Registr je vlastnictví P01
 * a mění se v něm i stavový kód, takže `contract_mismatch` vychází jako 422,
 * ne jako 409 z textu rozhodnutí D17. Význam je týž: kampaň se neodešle.
 */

/**
 * Podmnožina `CompileMeta` z kontraktu 5, kterou P13 UKLÁDÁ do `campaigns.compile_meta`.
 *
 * Neukládá se celý `CompileMeta`: `warnings` jsou diagnostika jedné kompilace
 * a `htmlBytes` s `textBytes` jde dopočítat ze samotného `compiled_html`. Ukládá
 * se přesně to, co někdo další ČTE za běhu:
 *  - `clickMarkerCount` čte SENDER podle kritéria AK-6.21 a porovnává ho proti
 *    skutečnému nálezu značek v HTML,
 *  - `links` je zdroj pravdy pro párování prokliků (rozhodnutí D17),
 *  - `renderSchema` a `usedPaths` potřebuje MATERIALIZACE, aby mohla zavolat
 *    `prepareRenderData`. Bez nich by se kořen `_present` neměl z čeho naplnit,
 *  - `rendererVersion` a `contractVersion` říkají, která verze výstup vyrobila.
 *
 * Jméno typu je jiné než `CompileMeta` z P08 SCHVÁLNĚ. Jsou to dva různé tvary
 * a shodné jméno by svádělo k přetypování, které by rozdíl zamlčelo.
 */
export type StoredCompileMeta = {
  contractVersion: number;
  rendererVersion: string;
  clickMarkerCount: number;
  links: CompiledLink[];
  usedPaths: string[];
  renderSchema: RenderSchema;
  hasUnsubscribeLink: boolean;
};

/** Výsledek kompilace kampaně připravený k uložení. */
export type CampaignCompilation = {
  html: string;
  text: string;
  compileMeta: StoredCompileMeta;
  compiledHash: string;
};

/**
 * `compiled_hash` se počítá z designu, předmětu a preheaderu. Preflight podle něj
 * pozná, že se šablona po kompilaci změnila. Kompilace je podle požadavku R3.3
 * deterministická, takže stejný vstup dá bajtově stejný výstup a hash je porovnatelný.
 */
export function computeCompiledHash(input: {
  design: unknown;
  subject: string;
  preheader: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ d: input.design, s: input.subject, p: input.preheader }))
    .digest('hex');
}

/**
 * Převod výstupu kompilace na tvar k uložení, se třemi kontrolami kontraktu.
 *
 * Vstup je `CompileMeta` z P08 DOSLOVA, ne přeložený mezitvar.
 */
export function normalizeCompileOutput(
  meta: CompileMeta,
  compiled: { html: string; text: string },
  source: { design: unknown; subject: string; preheader: string },
): CampaignCompilation {
  if (meta.contractVersion !== 1) {
    throw new ApiError('contract_mismatch', {
      params: { contract_version: meta.contractVersion },
    });
  }

  for (const link of meta.links) {
    if (!link.id) {
      throw new ApiError('contract_mismatch', {
        params: { reason: 'link_id_missing', url: link.url, position: link.position },
      });
    }
    if (link.position < 1) {
      throw new ApiError('contract_mismatch', {
        params: { reason: 'link_position_zero', url: link.url, position: link.position },
      });
    }
  }

  // `clickMarkerCount` počítá značky v HTML I v textu dohromady, kdežto `links` je
  // seznam RŮZNÝCH odkazů. Netrackovaný odkaz (mailto, kotva) značku nemá. Rovnost
  // by tedy byla špatná kontrola; drží nerovnost s počty trackovaných odkazů.
  const trackable = meta.links.filter((l) => l.trackable).length;
  if (meta.clickMarkerCount < trackable) {
    throw new ApiError('contract_mismatch', {
      params: { reason: 'click_markers_missing', markers: meta.clickMarkerCount, trackable },
    });
  }

  return {
    html: compiled.html,
    text: compiled.text,
    compileMeta: {
      contractVersion: meta.contractVersion,
      rendererVersion: meta.rendererVersion,
      clickMarkerCount: meta.clickMarkerCount,
      links: meta.links,
      usedPaths: meta.usedPaths,
      renderSchema: meta.renderSchema,
      hasUnsubscribeLink: meta.hasUnsubscribeLink,
    },
    compiledHash: computeCompiledHash(source),
  };
}

/**
 * Porovnání uložené `compile_meta` s čerstvým výstupem kompilace. Při neshodě se
 * kampaň NEODEŠLE. Důvod je v rozhodnutí D17: rozejitá ID odkazů se projeví až tím,
 * že report kliků zůstane prázdný, tedy týdny po odeslání a bez jediné chybové hlášky.
 */
export function assertCompileMetaMatches(
  stored: StoredCompileMeta | null,
  fresh: StoredCompileMeta,
): void {
  if (!stored) {
    throw new ApiError('contract_mismatch', { params: { reason: 'compile_meta_missing' } });
  }
  const key = (m: StoredCompileMeta): string =>
    JSON.stringify({
      c: m.clickMarkerCount,
      l: m.links.map((x) => [x.id, x.position, x.url]),
    });
  if (key(stored) !== key(fresh)) {
    throw new ApiError('contract_mismatch', {
      params: {
        reason: 'links_changed',
        stored_links: stored.links.length,
        fresh_links: fresh.links.length,
      },
    });
  }
}

/**
 * Plán pro render, který si z uložené `compile_meta` bere MATERIALIZACE.
 *
 * Zúžení `renderSchema` musí projít `toPreparedSchema`, protože kontrakt používá
 * jméno `RenderSchema` pro NĚCO JINÉHO než P08. Přetypováním by se ta různost
 * zamlčela.
 */
export function renderPlanFrom(
  meta: StoredCompileMeta,
  toPreparedSchema: (schema: RenderSchema) => PreparedDataSchema,
): RenderPlan {
  return { usedPaths: meta.usedPaths, preparedSchema: toPreparedSchema(meta.renderSchema) };
}

/**
 * Je uložená hodnota použitelná jako `StoredCompileMeta`?
 *
 * Kontroluje se tvar, ne jen `!== null`: prázdný `usedPaths` by vyrobil zprávy
 * s prázdnou `render_data` a prázdný `presence` by nechal mapu `_present` prázdnou,
 * takže by se každý podmíněný blok v odeslaném mailu tiše skryl (požadavek R11).
 */
export function isStoredCompileMeta(value: unknown): value is StoredCompileMeta {
  const meta = value as Partial<StoredCompileMeta> | null;
  return (
    meta !== null &&
    typeof meta === 'object' &&
    Array.isArray(meta.usedPaths) &&
    Array.isArray(meta.links) &&
    meta.renderSchema !== undefined &&
    Array.isArray(meta.renderSchema.fields) &&
    Array.isArray(meta.renderSchema.presence)
  );
}
