import type { FieldCatalog, FieldCatalogType } from '../external/field-catalog';
import type { Issue } from '../issue';

/**
 * `RenderSchema` vlastní **tenhle plán**, protože je součástí kontraktu 5.
 * V kontraktech je typ téhož jména, ale je to **něco jiného**: úzký tvar
 * `{ fields: readonly string[]; presence: readonly string[] }`, který potřebuje
 * `prepareRenderData`. Kdo předává `renderSchema` do `prepareRenderData`, zúží ho
 * voláním `toPreparedSchema()` z `../paths`, nikdy ne přetypováním.
 */
export type RenderSchemaField = {
  path: string;
  type: FieldCatalogType;
  required: boolean;
};

export type RenderSchema = {
  version: 1;
  fields: RenderSchemaField[];
  systemTags: string[];
  presence: string[];
  /** MVP 0 je vždy prázdné: blok `repeat` se nikdy neemituje. */
  loops: string[];
};

/** Data assetu, která renderer potřebuje. Vyzvedne je volající, renderer nedělá IO. */
export type AssetRef = {
  id: string;
  publicId: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  animated: boolean;
  variants: Array<{ variant: string; width: number; height: number }>;
};

export type CompileContext = {
  workspaceId: string;
  /**
   * POVINNÉ při purpose = "send". Vstupuje do odvození link_id.
   * `| undefined` je kvůli exactOptionalPropertyTypes: náhled a testy ho předávají
   * výslovně jako undefined, ne tak, že klíč vynechají.
   */
  campaignId?: string | undefined;
  templateKind: 'campaign' | 'transactional' | 'system';
  fields: FieldCatalog;
  /** BCP 47 tag, libovolný platný. Neznámý tag kompilaci neshodí. */
  language: string;
  assetBaseUrl: string;
  /** Doplněno rozhodnutím D1. Klíč je assetId. */
  assets: Record<string, AssetRef>;
  // Pole `brand` tady BYLO a je vyškrtnuté. Nikdo ho neplnil: `brand_profiles`
  // tenhle plán nečte a značka vstupuje do dokumentu už při generování základní
  // šablony (`brandToTheme`), ne při kompilaci. Nepovinné pole, které nikdo
  // nenaplní, je mrtvá větev: vypadá jako podporovaná možnost a při prvním
  // pokusu ji použít se zjistí, že se nikdy nikam nedostane.
  purpose: 'send' | 'preview' | 'test';
  trackOpens: boolean;
  trackClicks: boolean;
  /** Doplněno rozhodnutím D2. Vyhodnocuje se při kompilaci, ne senderem. */
  preheader?: string;
  /** Doplněno rozhodnutím D2. Vstup, ne new Date(), kvůli determinismu. */
  currentYear: number;
  /**
   * Nabízí projekt veřejné centrum předvoleb?
   *
   * `false` VYŘADÍ odkaz „Nastavit předvolby" z patičky, a to z HTML, z prostého textu
   * i ze schématu (`systemTags`), aby si ty tři podoby neodporovaly. Patička má vlastní
   * přepínač `showPreferences`, ale ten patří ŠABLONĚ, kdežto tenhle patří PROJEKTU:
   * když správce předvolby nenabízí, nesmí na ně odkazovat žádná šablona, ani ta, kterou
   * si někdo uložil dřív.
   *
   * Potlačit se to musí TADY, při kompilaci, ne až v odesílači. Odesílač interpoluje
   * hotové HTML a chybějící hodnota by z odkazu udělala `href=""`, tedy viditelný odkaz
   * nikam; vyříznout celý `<a>` i s oddělovačem ` | ` z hotového těla nejde spolehlivě.
   *
   * Vynechání znamená ZAPNUTO. Je to jediná hodnota, při které zůstávají zlaté vzorky
   * bajtově stejné, a zároveň odpovídá výchozímu stavu nastavení projektu.
   */
  preferenceCenterEnabled?: boolean | undefined;
  /** Jen pro testy: pevný nonce raw slotů. V produkci se nikdy nepředává. */
  rawNonce?: string;
};

export type CompiledLink = {
  /** UUIDv5. JE to <link_id> ve značce i v payloadu click tokenu. */
  id: string;
  /** 1..N, souvislá řada podle prvního výskytu. Jen pro řazení a report, ve značce není. */
  position: number;
  /** Absolutní statická URL, nikdy neobsahuje Liquid výraz. */
  url: string;
  trackable: boolean;
  label: string;
};

export type CompileMeta = {
  contractVersion: 1;
  rendererVersion: string;
  schemaVersion: number;
  usedPaths: string[];
  renderSchema: RenderSchema;
  links: CompiledLink[];
  assetIds: string[];
  htmlBytes: number;
  textBytes: number;
  warnings: Issue[];
  hasUnsubscribeLink: boolean;
  /** Kolik značek odkazů je v html plus text dohromady. */
  clickMarkerCount: number;
  hasOpenPixelSlot: boolean;
};

export type CompileResult =
  { ok: true; html: string; text: string; meta: CompileMeta } | { ok: false; issues: Issue[] };

/** Verze rendereru je nezávislá na schemaVersion a zvyšuje se při každé změně výstupu. */
export const RENDERER_VERSION = 'r1.0.0';
export const CONTRACT_VERSION = 1 as const;
