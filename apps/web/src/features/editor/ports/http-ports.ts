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

export function createHttpPorts(options: {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): EditorPorts {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const call = async (path: string, init: RequestInit): Promise<{ status: number; body: Json }> => {
    const response = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
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
      return ((body.data as Json[]) ?? []).map((item) => ({
        id: String(item.id),
        url: String(item.url),
        name: String(item.file_name ?? ''),
        width: Number(item.width ?? 0),
        height: Number(item.height ?? 0),
      }));
    },

    async uploadAsset(file: File): Promise<AssetSummary> {
      const form = new FormData();
      form.append('file', file);
      const response = await doFetch(`${baseUrl}/assets`, { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as Json;
      if (response.status >= 400) fail(body, response.status);
      return {
        id: String(body.id),
        url: String(body.url),
        name: String(body.file_name ?? file.name),
        width: Number(body.width ?? 0),
        height: Number(body.height ?? 0),
      };
    },
  };

  return ports;
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
