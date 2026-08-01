import type { CompiledFixture } from '@mlain/contracts/compiled';
import type { FieldCatalog } from '../../src/external/field-catalog';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import { checkSemantics } from '../../src/document/semantic';
import { compileDocument } from '../../src/compile/compile';
import type { AssetRef, CompileContext, CompileResult } from '../../src/compile/types';
import type { Document } from '../../src/document/types';

const CAMPAIGN = '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071';

export const CT_CATALOG: FieldCatalog = {
  version: 'ct',
  fields: [
    {
      path: 'first_name',
      type: 'string',
      label: { en: 'First name' },
      group: 'name',
      deleted: false,
    },
    {
      path: 'greeting',
      type: 'string',
      label: { en: 'Greeting' },
      group: 'salutation',
      deleted: false,
    },
    {
      path: 'created_at',
      type: 'datetime',
      label: { en: 'Created' },
      group: 'meta',
      deleted: false,
    },
    { path: 'attr.city', type: 'string', label: { en: 'City' }, group: 'custom', deleted: false },
    { path: 'attr.url', type: 'string', label: { en: 'Url' }, group: 'custom', deleted: false },
  ],
};

export const CT_ASSET: AssetRef = {
  id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
  publicId: 'aB3dEfGhIjKlMnOpQrStUv',
  mimeType: 'image/png',
  width: 1200,
  height: 600,
  altText: null,
  animated: false,
  variants: [
    { variant: 'orig', width: 1200, height: 600 },
    { variant: 'w1200', width: 1200, height: 600 },
  ],
};

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };

const doc = (children: unknown[]): Document =>
  ({
    schemaVersion: 1,
    meta: { name: 'CT', previewText: 'Náhledový text', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [...children, footer],
      },
    ],
  }) as unknown as Document;

const text = (id: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  ...extra,
  props: { ...blockDefaults('text'), content: [{ t: 'p', children }] },
});

const button = (id: string, href: string, label: string, trackable = true) => ({
  id,
  type: 'button',
  props: {
    ...blockDefaults('button'),
    href,
    trackable,
    label: [{ t: 'p', children: [{ t: 's', v: label }] }],
  },
});

const SEND = { trackOpens: true, trackClicks: true, language: 'cs', campaignId: CAMPAIGN };

export type CtCase = {
  id: string;
  description: string;
  document: Document;
  catalog: FieldCatalog;
  context: CompiledFixture['context'];
  expect: CompiledFixture['expect'];
};

export const CT_CASES: CtCase[] = [
  {
    id: 'CT-001',
    description: 'minimální dokument: doctype, patička a odhlašovací odkaz',
    document: doc([text('b_000000000002', [{ t: 's', v: 'Dobrý den' }])]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: {
      htmlContains: ['<!DOCTYPE html>', '{{ unsubscribe_url }}'],
      textContains: ['Dobrý den'],
      hasOpenPixelSlot: true,
    },
  },
  {
    id: 'CT-002',
    description: 'merge tag projde renderem bajtově beze změny, bez jediné HTML entity',
    document: doc([text('b_000000000002', [{ t: 'var', expr: 'contact.first_name' }])]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: {
      htmlContains: ['{{ contact.first_name }}'],
      textContains: ['{{ contact.first_name }}'],
    },
  },
  {
    id: 'CT-003',
    description: 'náhradní hodnota filtru default se dosadí až po renderu, přes slot',
    document: doc([
      text('b_000000000002', [
        { t: 'var', expr: 'contact.first_name | default', fallback: 'kolego' },
      ]),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { htmlContains: ['{{ contact.first_name | default:"kolego" }}'] },
  },
  {
    id: 'CT-004',
    description: 'formát filtru date pochází z whitelistu a dosazuje se slotem',
    document: doc([
      text('b_000000000002', [
        { t: 'var', expr: 'contact.created_at | date', dateFormat: '%d.%m.%Y' },
      ]),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { htmlContains: ['date:"%d.%m.%Y"'] },
  },
  {
    id: 'CT-005',
    // Plán tady čeká 2. Tlačítko ale nese značku v HTML DVAKRÁT: jednou ve VML
    // dvojčeti pro Outlook a jednou v obyčejném `<a>`. Každý klient vykreslí
    // právě jedno z nich, takže příjemce vidí jedno tlačítko, a sender musí
    // nahradit obě. Jedno tlačítko je proto 2 značky v HTML plus 1 v textu.
    description: 'tlačítko s odkazem nese značku ve VML dvojčeti, v <a> i v textu',
    document: doc([button('b_000000000002', 'https://example.com/a', 'Koupit')]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { clickMarkerCount: 3, hasOpenPixelSlot: true },
  },
  {
    id: 'CT-006',
    description: 'dva různé cíle dostanou dvě různá link_id, pozice jdou od jedné',
    document: doc([
      button('b_000000000002', 'https://example.com/a', 'A'),
      button('b_000000000003', 'https://example.com/b', 'B'),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { clickMarkerCount: 6 },
  },
  {
    id: 'CT-007',
    description: 'tentýž cíl dvakrát je jeden řádek odkazu, ale značka u každého výskytu',
    document: doc([
      button('b_000000000002', 'https://example.com/a', 'A'),
      button('b_000000000003', 'https://example.com/a', 'A znovu'),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { clickMarkerCount: 6 },
  },
  {
    id: 'CT-008',
    description: 'při zapnutém měření otevření je slot pixelu právě jednou',
    document: doc([text('b_000000000002', [{ t: 's', v: 'x' }])]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { hasOpenPixelSlot: true, htmlContains: ['<!--ML_OPEN_PIXEL-->'] },
  },
  {
    id: 'CT-009',
    description: 'při vypnutém měření otevření slot pixelu ve výstupu není vůbec',
    document: doc([text('b_000000000002', [{ t: 's', v: 'x' }])]),
    catalog: CT_CATALOG,
    context: { ...SEND, trackOpens: false },
    expect: { hasOpenPixelSlot: false },
  },
  {
    id: 'CT-010',
    description: 'systémová značka odhlášení se netrackuje a zůstane celou hodnotou href',
    document: doc([
      text('b_000000000002', [
        { t: 'a', href: '{{ unsubscribe_url }}', children: [{ t: 's', v: 'Odhlásit' }] },
      ]),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { htmlContains: ['{{ unsubscribe_url }}'], clickMarkerCount: 0 },
  },
  {
    id: 'CT-011',
    description: 'mailto a tel se nikdy netrackují',
    document: doc([
      text('b_000000000002', [
        { t: 'a', href: 'mailto:podpora@example.com', children: [{ t: 's', v: 'Napište' }] },
        { t: 'a', href: 'tel:+420123456789', children: [{ t: 's', v: 'Zavolejte' }] },
      ]),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: {
      htmlContains: ['mailto:podpora@example.com', 'tel:+420123456789'],
      clickMarkerCount: 0,
    },
  },
  {
    id: 'CT-012',
    description: 'proměnná v href trackovaného odkazu je blokující chyba',
    document: doc([button('b_000000000002', '{{ contact.attr.url }}', 'Odkaz', true)]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { error: 'liquid_in_trackable_href' },
  },
  {
    id: 'CT-013',
    description: 'podmíněný blok emituje konstrukci nad mapou _present, bez uvozovky a bez blank',
    document: doc([
      text('b_000000000002', [{ t: 's', v: 'Jsme i u vás' }], {
        visibleWhen: { field: 'contact.attr.city', op: 'present' },
      }),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { htmlContains: ['{% if _present.contact__attr__city %}', '{% endif %}'] },
  },
  {
    id: 'CT-014',
    description: 'řetězcový literál v autorské šabloně je blokující chyba',
    document: doc([
      text('b_000000000002', [{ t: 'var', expr: 'contact.first_name | default: "kolego"' }]),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { error: 'liquid_string_literal_not_allowed' },
  },
  {
    id: 'CT-015',
    description: 'porovnávací operátor v podmínce je v MVP 0 blokující chyba (rozhodnutí R7)',
    document: doc([
      {
        id: 'b_000000000002',
        type: 'html',
        props: { ...blockDefaults('html'), code: '{% if contact.attr.city > 5 %}x{% endif %}' },
      },
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { error: 'liquid_comparison_operator_not_supported' },
  },
  {
    id: 'CT-016',
    description: 'syrové HTML se dosadí po renderu a žádný slot ML_RAW_ ve výstupu nezůstane',
    document: doc([
      {
        id: 'b_000000000002',
        type: 'html',
        props: { ...blockDefaults('html'), code: '<p>Vlastní <strong>obsah</strong></p>' },
      },
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { htmlContains: ['<strong>obsah</strong>'] },
  },
  {
    id: 'CT-017',
    description: 'dva bloky s týmž výrazem a různou náhradní hodnotou dostanou různé sloty',
    document: doc([
      text('b_000000000002', [
        { t: 'var', expr: 'contact.first_name | default', fallback: 'kolego' },
      ]),
      text('b_000000000003', [
        { t: 'var', expr: 'contact.first_name | default', fallback: 'kolegyně' },
      ]),
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    expect: { htmlContains: ['default:"kolego"', 'default:"kolegyně"'] },
  },
  {
    id: 'CT-018',
    description:
      'textová varianta vzniká z dokumentu, takže merge tag v nadpisu zůstane malými písmeny',
    document: doc([
      {
        id: 'b_000000000002',
        type: 'heading',
        props: {
          ...blockDefaults('heading'),
          level: 1,
          content: [
            {
              t: 'p',
              children: [
                { t: 's', v: 'Vítejte ' },
                { t: 'var', expr: 'contact.first_name' },
              ],
            },
          ],
        },
      },
    ]),
    catalog: CT_CATALOG,
    context: SEND,
    // Kdyby textovou variantu dělal toPlainText z react-email, byl by tady
    // `{{ CONTACT.FIRST_NAME }}` a personalizace by se v textu rozbila.
    // Ověřeno spuštěním na @react-email/render 2.1.0, viz past 4 v kapitole 0.2.
    expect: { textContains: ['{{ contact.first_name }}'] },
  },
];

export function ctContext(testCase: CtCase, context: CompiledFixture['context']): CompileContext {
  return {
    workspaceId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000',
    templateKind: 'campaign',
    fields: testCase.catalog,
    language: context.language,
    assetBaseUrl: 'https://assets.example.test',
    assets: { [CT_ASSET.id]: CT_ASSET },
    purpose: (context.purpose ?? 'send') as CompileContext['purpose'],
    campaignId: context.campaignId,
    trackOpens: context.trackOpens,
    trackClicks: context.trackClicks,
    currentYear: 2026,
    // Pevný nonce: bez něj by se raw sloty lišily mezi běhy a fixture
    // by se měnila při každém spuštění generátoru.
    rawNonce: 'contractnonce',
  };
}

/**
 * Kompilace tak, jak ji volá aplikace: **nejdřív sémantická brána, potom
 * `compileDocument`**.
 *
 * Task 28 plánu říká výslovně, že `compileDocument` sémantický validátor nespouští,
 * ten patří do `packages/core/templates/validate.ts` a volá se PŘED kompilací.
 * Tři chybové fixtury (`CT-012`, `CT-014`, `CT-015`) přitom čekají kódy, které
 * vydává právě sémantická vrstva: `liquid_in_trackable_href` ze struktury
 * a dva liquidové kódy z autorské úrovně gramatiky. Invariant I1 je vydat nemůže,
 * protože kompilovaná úroveň argumenty filtrů povoluje a sanitizer bloku `html`
 * navíc `>` převede na `&gt;`, takže by z porovnávacího operátoru zbyla entita.
 * Fixtury tedy nepopisují chování `compileDocument`, ale celé brány, a tenhle
 * pomocník je jediné místo, kde se ta brána skládá, aby ji generátor i test
 * volaly stejně.
 */
export async function runCtCase(
  testCase: CtCase,
  context: CompiledFixture['context'] = testCase.context,
): Promise<CompileResult> {
  const semantic = checkSemantics(testCase.document, {
    templateKind: 'campaign',
    fields: testCase.catalog,
    assetIds: new Set([CT_ASSET.id]),
    estimatedHtmlBytes: 0,
  });
  const blocking = semantic.filter((issue) => issue.severity === 'error');
  if (blocking.length > 0) return { ok: false, issues: blocking };
  return compileDocument(testCase.document, ctContext(testCase, context));
}
