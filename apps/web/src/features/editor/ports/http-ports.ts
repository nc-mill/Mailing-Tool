import type {
  AssetSummary,
  ContactSummary,
  EditorPorts,
  Finding,
  PreviewData,
  PreviewResult,
  SaveResult,
  TestSendResult,
} from './types';
import { PortError } from './types';

type Json = Record<string, unknown>;

/**
 * `workspaceId` je povinný pro každé volání z prohlížeče.
 *
 * Middleware `apps/web/src/lib/api/authenticate.ts` bere referenci na projekt
 * z hlavičky `X-Workspace-Id` nebo ze segmentu `/w/{slug}` V CESTĚ POŽADAVKU.
 * Cesty editoru začínají `/api/v1/`, takže bez hlavičky nemá požadavek projekt
 * a middleware vrací 404 ještě před handlerem. Doslovně z logu produkční image
 * při kroku „vytvoření šablony" zlaté cesty:
 *
 *   {"route":"/api/v1/templates","status":404,
 *    "workspace_id":null,"actor_type":null,"actor_id":null}
 *
 * Tlačítko „Vytvořit šablonu" tím bylo v prohlížeči úplně mrtvé: chytil se
 * `catch` a ukázala se obecná hláška o nezdaru. Parametr je proto povinný,
 * ne volitelný. Volitelný by se zase někde zapomněl.
 */
export function createHttpPorts(options: {
  workspaceId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): EditorPorts {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const call = async (path: string, init: RequestInit): Promise<{ status: number; body: Json }> => {
    const response = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'X-Workspace-Id': options.workspaceId,
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as Json;
    return { status: response.status, body };
  };

  const fail = (body: Json, status: number): never => {
    throw new PortError(
      String(body.code ?? 'unknown_error'),
      String(body.detail ?? ''),
      body.request_id ? String(body.request_id) : undefined,
      status,
    );
  };

  const ports: EditorPorts = {
    async createTemplate({ name, document }): Promise<{ id: string }> {
      const { status, body } = await call('/templates', {
        method: 'POST',
        body: JSON.stringify({ name, kind: 'campaign', document }),
      });
      if (status >= 400) fail(body, status);
      return { id: String(body.id) };
    },

    async save({ templateId, document, ifDesignHash }): Promise<SaveResult> {
      const { status, body } = await call(`/templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify({ design: document, if_design_hash: ifDesignHash }),
      });
      if (status === 412) {
        // Tělo odpovědi 412 je dnes obálka RFC 9457 **bez** aktuálního dokumentu:
        // vrací `type`, `title`, `status`, `detail`, `code`, `request_id`, nic víc.
        // Požadavek P08-R3 chce doplnit `design` a `design_hash`, ale spoléhat se
        // na to nejde: bez nich by konflikt nesl prázdný dokument a nabídka
        // „načíst novou verzi" by šablonu vymazala. Když v těle nejsou, dotáhne
        // se aktuální stav samostatným GET.
        if (body.design !== undefined && body.design_hash !== undefined) {
          return {
            ok: false,
            conflict: true,
            document: body.design as never,
            designHash: String(body.design_hash),
          };
        }
        const current = await call(`/templates/${templateId}`, { method: 'GET' });
        if (current.status >= 400) fail(current.body, current.status);
        return {
          ok: false,
          conflict: true,
          document: current.body.design as never,
          designHash: String(current.body.design_hash ?? ''),
        };
      }
      if (status >= 400) fail(body, status);
      return { ok: true, designHash: String(body.design_hash), updatedAt: String(body.updated_at) };
    },

    async preview({ templateId, previewData }): Promise<PreviewResult> {
      // `preview_data` je požadavek P08-R2. Endpoint dnes bere jen `render_data`
      // s hotovými daty a jinak sáhne po jedné vzorové sadě, takže varianta
      // `no_name` z kritéria 55 zatím projde jen přes dvojníka portů.
      const { status, body } = await call(`/templates/${templateId}/preview`, {
        method: 'POST',
        body: JSON.stringify({ preview_data: toSnake(previewData) }),
      });
      if (status >= 400) fail(body, status);
      return { html: String(body.html ?? ''), text: String(body.text ?? '') };
    },

    async validate({ templateId }): Promise<{ findings: Finding[] }> {
      const { status, body } = await call(`/templates/${templateId}/validate`, {
        method: 'POST',
        body: '{}',
      });
      if (status >= 400 && status !== 409 && status !== 422) fail(body, status);
      return { findings: (body.findings as Finding[]) ?? [] };
    },

    async testSend({
      templateId,
      recipients,
      addTestPrefix,
      previewData,
    }): Promise<TestSendResult> {
      const { status, body } = await call(`/templates/${templateId}/test-send`, {
        method: 'POST',
        body: JSON.stringify({
          recipients,
          add_test_prefix: addTestPrefix,
          preview_data: toSnake(previewData),
        }),
      });
      if (status >= 400) {
        return {
          ok: false,
          code: String(body.code ?? 'unknown_error'),
          retryAfter: typeof body.retry_after === 'number' ? body.retry_after : undefined,
          requestId: body.request_id ? String(body.request_id) : undefined,
        };
      }
      return { ok: true };
    },

    async searchContacts(query: string): Promise<ContactSummary[]> {
      const { status, body } = await call(`/contacts?q=${encodeURIComponent(query)}&limit=10`, {
        method: 'GET',
      });
      if (status >= 400) fail(body, status);
      return ((body.data as Json[]) ?? []).map(toContact);
    },

    async randomContact(): Promise<ContactSummary | null> {
      const { status, body } = await call('/contacts?order=random&limit=1', { method: 'GET' });
      if (status >= 400) fail(body, status);
      const first = ((body.data as Json[]) ?? [])[0];
      return first ? toContact(first) : null;
    },

    async listAssets(query = ''): Promise<AssetSummary[]> {
      const { status, body } = await call(`/assets?q=${encodeURIComponent(query)}&limit=50`, {
        method: 'GET',
      });
      if (status >= 400) fail(body, status);
      return ((body.data as Json[]) ?? []).map(toAsset);
    },

    async uploadAsset(file: File): Promise<AssetSummary> {
      const form = new FormData();
      form.append('file', file);
      /*
       * `call` se tu použít NEDÁ a hlavička se proto skládá ručně.
       *
       * `call` nastavuje `content-type: application/json`, jenže tělo je
       * `FormData`. Kdyby se hlavička nastavila, prohlížeč by NEDOPLNIL
       * `boundary=` a server by multipart nerozebral: dostal by tělo, které
       * podle hlavičky je JSON a podle obsahu není. `fetch` si správnou
       * hlavičku doplní sám, jen když se do ní nesahá.
       *
       * `X-Workspace-Id` tu ale být MUSÍ. Dřív tu volání běželo přes holý
       * `doFetch` úplně bez hlaviček, takže middleware
       * `apps/web/src/lib/api/authenticate.ts` neměl z čeho vzít projekt
       * a vracel 404 ještě před handlerem. Je to přesně ta vada, kterou
       * popisuje komentář v hlavičce tohohle souboru u `createHttpPorts`,
       * jen o jednu operaci vedle.
       */
      const response = await doFetch(`${baseUrl}/assets`, {
        method: 'POST',
        headers: { 'X-Workspace-Id': options.workspaceId },
        body: form,
      });
      const body = (await response.json().catch(() => ({}))) as Json;
      if (response.status >= 400) fail(body, response.status);
      return toAsset(body);
    },
  };

  return ports;
}

/**
 * Odpověď `/assets` na tvar, který zná knihovna v editoru.
 *
 * `url` je adresa varianty `orig`, ne miniatury: blok obrázku v dokumentu si
 * variantu vybírá sám podle šířky (`pickVariant` v emitteru) a knihovna má
 * ukazovat, co se nahrálo. Náhled v mřížce jede přes `thumbnail_url`, který
 * `AssetSummary` dnes nenese; až ho bude nést, přidá se sem.
 *
 * Jméno se bere z `original_filename`. Dřív se četlo `file_name`, což je klíč,
 * který API nikdy nevracelo, takže by měl každý obrázek v knihovně prázdný
 * popisek a nešel by najít hledáním.
 */
function toAsset(item: Json): AssetSummary {
  return {
    id: String(item.id),
    url: String(item.url),
    name: String(item.original_filename ?? ''),
    width: Number(item.width ?? 0),
    height: Number(item.height ?? 0),
  };
}

function toContact(item: Json): ContactSummary {
  const first = String(item.first_name ?? '');
  const last = String(item.last_name ?? '');
  return { id: String(item.id), email: String(item.email), name: `${first} ${last}`.trim() };
}

function toSnake(data: PreviewData): Json {
  return data.type === 'contact'
    ? { type: 'contact', contact_id: data.contactId }
    : { type: 'sample', variant: data.variant ?? 'default' };
}
