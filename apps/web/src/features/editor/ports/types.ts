import type { EditorDocument } from '../model/document-types';

export type PreviewData =
  { type: 'sample'; variant?: 'default' | 'no_name' } | { type: 'contact'; contactId: string };

export type SaveResult =
  | { ok: true; designHash: string; updatedAt: string }
  | { ok: false; conflict: true; document: EditorDocument; designHash: string };

export type PreviewResult = { html: string; text: string };

export type Finding = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  pointer?: string;
  block_id?: string;
  params?: Record<string, string | number>;
};

export type ContactSummary = { id: string; email: string; name: string };
export type AssetSummary = { id: string; url: string; name: string; width: number; height: number };

export class PortError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string,
    public readonly requestId?: string,
    public readonly status?: number,
  ) {
    super(detail || code);
    this.name = 'PortError';
  }
}

/**
 * Výsledek testovacího odeslání. `| undefined` u nepovinných polí je nutné:
 * `exactOptionalPropertyTypes` jinak nedovolí do nich zapsat `undefined`,
 * a pruh chyby potřebuje rozlišit „server dobu čekání neposlal" od „neposílá se".
 */
export type TestSendResult =
  | { ok: true }
  | { ok: false; code: string; retryAfter?: number | undefined; requestId?: string | undefined };

export type EditorPorts = {
  /** `POST /api/v1/templates`. Vrací 201 s tělem šablony, z něhož editor potřebuje jen id. */
  createTemplate(input: { name: string; document: EditorDocument }): Promise<{ id: string }>;
  save(input: {
    templateId: string;
    document: EditorDocument;
    ifDesignHash: string;
  }): Promise<SaveResult>;
  /**
   * Tmavý režim se **neposílá**. Náhled tmavého režimu kreslí komponenta K6
   * v prohlížeči přes `color-scheme` a barvy v `srcdoc`; server o něm nic neví
   * a jeho endpoint takový parametr nepřijímá. Kdyby se posílal, byl by to
   * okružní čas navíc při každém přepnutí přepínače, a to za nic.
   */
  preview(input: { templateId: string; previewData: PreviewData }): Promise<PreviewResult>;
  validate(input: { templateId: string }): Promise<{ findings: Finding[] }>;
  testSend(input: {
    templateId: string;
    recipients: string[];
    addTestPrefix: boolean;
    previewData: PreviewData;
  }): Promise<TestSendResult>;
  searchContacts(query: string): Promise<ContactSummary[]>;
  randomContact(): Promise<ContactSummary | null>;
  listAssets(query?: string): Promise<AssetSummary[]>;
  uploadAsset(file: File): Promise<AssetSummary>;
};
