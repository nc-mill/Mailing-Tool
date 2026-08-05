import { toAssetRow, type ApiAsset, type AssetRow, type AssetUsageRef } from './types';

/**
 * Hromadné mazání a zjištění, kde se obrázek používá.
 *
 * PROČ SE MAŽE PO JEDNOM. Doména nabízí `DELETE /assets/{id}` a hromadnou
 * obdobu nemá. Doplnit ji by znamenalo novou trasu, změnu OpenAPI dokumentu
 * a nové rozhodnutí, co má vrátit dávka, ve které tři položky projdou a dvě
 * ne. Sekvenční mazání dá TÝŽ výsledek a navíc přesně tu informaci, kterou
 * uživatel potřebuje: který obrázek neprošel a proč. Počty jsou desítky, ne
 * tisíce, protože maže člověk z mřížky, kterou vidí.
 *
 * Mazání je z pohledu API SKRYTÍ (`hidden_at`), ne smazání souboru. Soubor
 * leží dál 30 dní a veřejná adresa funguje, takže obrázek nezmizí lidem, kteří
 * už e-mail dostali. Fyzicky ho odstraní noční `content.cleanup_assets`, a jen
 * tehdy, když na něj mezitím nikdo neodkázal.
 */

export type DeleteOutcome =
  | { kind: 'deleted'; id: string; name: string }
  /** 409: odkazuje na něj kampaň, která odesílá, odešla nebo je pozastavená. */
  | { kind: 'blocked'; id: string; name: string; code: string }
  | { kind: 'failed'; id: string; name: string; code: string };

async function problemCode(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body !== null && typeof body === 'object' && 'code' in body) {
    const code = (body as { code: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  if (response.status === 403) return 'forbidden';
  return 'unknown';
}

export async function deleteMany(input: {
  assets: readonly Pick<AssetRow, 'id' | 'originalFilename'>[];
  workspaceId: string;
  onProgress?: (done: number, total: number) => void;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<DeleteOutcome[]> {
  const doFetch = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const outcomes: DeleteOutcome[] = [];

  for (const [index, asset] of input.assets.entries()) {
    input.onProgress?.(index, input.assets.length);
    const name = asset.originalFilename;
    try {
      const response = await doFetch(`/api/v1/assets/${asset.id}`, {
        method: 'DELETE',
        headers: { 'X-Workspace-Id': input.workspaceId },
      });
      if (response.status === 204) {
        outcomes.push({ kind: 'deleted', id: asset.id, name });
        continue;
      }
      const code = await problemCode(response);
      outcomes.push({
        // 409 je jediný stav, který znamená „tenhle smazat NELZE", ne „nepovedlo
        // se to". Rozlišení jde do hlášky: opakovat 409 nemá smysl.
        kind: response.status === 409 ? 'blocked' : 'failed',
        id: asset.id,
        name,
        code,
      });
    } catch {
      outcomes.push({ kind: 'failed', id: asset.id, name, code: 'unknown' });
    }
  }

  input.onProgress?.(input.assets.length, input.assets.length);
  return outcomes;
}

export type UsageReport = { asset: AssetRow; usedBy: AssetUsageRef[] };

/**
 * Kde se vybrané obrázky používají. Volá se PŘED potvrzením mazání.
 *
 * Výpis knihovny nese jen `reference_count`, tedy číslo. Číslo stačí na
 * rozsvícení štítku v dlaždici, ale ne na větu „přijdeš o obrázek v šabloně
 * Newsletter", a přesně tuhle větu musí uživatel vidět, než něco smaže.
 * Jména dodává až detail (`GET /assets/{id}`, pole `used_by`), takže se
 * dotahuje, a jen pro obrázky, které vůbec nějakou referenci mají.
 */
export async function loadUsage(input: {
  assets: readonly AssetRow[];
  workspaceId: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<UsageReport[]> {
  const doFetch = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const reports: UsageReport[] = [];

  for (const asset of input.assets) {
    if (asset.referenceCount === 0) {
      reports.push({ asset, usedBy: [] });
      continue;
    }
    try {
      const response = await doFetch(`/api/v1/assets/${asset.id}`, {
        headers: { 'X-Workspace-Id': input.workspaceId },
      });
      if (response.status >= 400) {
        // Detail se nepodařilo načíst. Obrázek se NEPROHLÁSÍ za nepoužitý:
        // `reference_count` je nenulový, takže se ukáže aspoň počtem. Tichý
        // převod na nulu by uživateli slíbil bezpečné smazání, které bezpečné není.
        reports.push({ asset, usedBy: [] });
        continue;
      }
      const body = (await response.json().catch(() => null)) as ApiAsset | null;
      const detail = body === null ? asset : toAssetRow(body);
      reports.push({ asset: detail, usedBy: detail.usedBy });
    } catch {
      reports.push({ asset, usedBy: [] });
    }
  }

  return reports;
}
