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

/**
 * Kontakt pro volbu „Zobrazit jako".
 *
 * `values` nese hodnoty pod kořenem `contact.` v témže tvaru, v jakém je skládá
 * `contactPreviewData` na serveru (`packages/core/src/templates/api/preview-data.ts`).
 * Bez nich by plátno umělo jen štítky: dosadit „Dobrý den, Jano" do značky
 * potřebuje skutečnou hodnotu, ne jen jméno kontaktu do popisku nabídky.
 * Server kvůli tomu nic nového neposílá, `GET /contacts` tahle pole vrací už dnes.
 */
export type ContactSummary = {
  id: string;
  email: string;
  name: string;
  values: Record<string, unknown>;
};
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
   * Přejmenování šablony, `PATCH /templates/{id}` se samotným `name`.
   *
   * Vrací NOVÝ `designHash`, a není to zbytečnost: server mění spolu se jménem
   * řádku i `meta.name` dokumentu, protože z něj se skládá předmět odesílaného
   * e-mailu. Kdyby si editor nechal starý hash, spadlo by mu příští automatické
   * uložení na 412 „změnil to někdo jiný", přestože to změnil on sám.
   *
   * Nevyhazuje na zabraném jménu ani na prázdném vstupu: obojí je odpověď,
   * kterou má rozhraní ukázat u pole, ne pád portu.
   */
  rename(input: {
    templateId: string;
    name: string;
  }): Promise<{ ok: true; designHash: string } | { ok: false; code: string }>;
  /**
   * Tmavý režim se **neposílá**. Náhled tmavého režimu kreslí komponenta K6
   * v prohlížeči přes `color-scheme` a barvy v `srcdoc`; server o něm nic neví
   * a jeho endpoint takový parametr nepřijímá. Kdyby se posílal, byl by to
   * okružní čas navíc při každém přepnutí přepínače, a to za nic.
   */
  preview(input: { templateId: string; previewData: PreviewData }): Promise<PreviewResult>;
  validate(input: { templateId: string }): Promise<{ findings: Finding[] }>;
  /**
   * `addTestPrefix` tu SCHVÁLNĚ NENÍ. Rozhodnutí D21 plánu P13 prefix ruší
   * a předmět jde do vlastní `subject` skryté systémové kampaně, takže test
   * projde stejnou cestou jako ostrý e-mail. Serverové schéma je `.strict()`,
   * takže klíč navíc končí na 422 `validation_failed`, a přesně to se stalo:
   * rozhraní ho posílalo dál i po tom, co ho server přestal přijímat, a
   * uživatel viděl jen „Test se nepodařilo odeslat".
   */
  testSend(input: {
    templateId: string;
    recipients: string[];
    previewData: PreviewData;
  }): Promise<TestSendResult>;
  /**
   * `POST /campaigns/{id}/apply-template`. Převezme právě uložený dokument do
   * obsahu kampaně, ze které se uživatel do editoru proklikl.
   *
   * OBSAH KAMPANĚ JE KOPIE, NE ODKAZ (rozhodnutí P13): úprava šablony se do
   * kampaně sama nepromítne, jinak by změna šablony měnila obsah už odeslané
   * kampaně. Bez tohohle volání musí uživatel v kampani ještě kliknout na
   * „Načíst obsah ze šablony", a když to neudělá, odešle prázdný e-mail.
   * Editor proto kopii pořídí sám ve chvíli, kdy se do kampaně vrací.
   */
  applyToCampaign(input: {
    campaignId: string;
    templateId: string;
  }): Promise<{ ok: true; overwritten: boolean } | { ok: false; code: string }>;
  searchContacts(query: string): Promise<ContactSummary[]>;
  randomContact(): Promise<ContactSummary | null>;
  listAssets(query?: string): Promise<AssetSummary[]>;
  uploadAsset(file: File): Promise<AssetSummary>;
};
