import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsCjs from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../model/document-types';
import { createBlock } from '../model/factory';
import { BLOCK_DESCRIPTORS } from './registry';

const schemaPath = resolve(
  import.meta.dirname,
  '../../../../../../packages/emails/schema/document.v1.schema.json',
);
type JsonSchemaNode = {
  $ref?: string;
  properties?: Record<string, JsonSchemaNode>;
  oneOf?: JsonSchemaNode[];
  type?: string | string[];
  minimum?: number;
  maximum?: number;
};

const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  $defs: Record<string, JsonSchemaNode>;
};

// Odchylka od doslovného kódu plánu: schéma P08 používá formáty `uuid`, `uri`
// a `email`, a Ajv se `strict: true` na neznámý formát rovnou spadne. Registrace
// je táž jako v `packages/emails/src/document/schema.ts`, aby test validoval
// přesně tím, čím validuje server.
const addFormats = addFormatsCjs.default;

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, ['uuid', 'uri', 'email']);
const validate = ajv.compile(schema);

/**
 * Kde v JSON Schema bydlí vlastnosti bloku.
 *
 * P08 pojmenoval samostatnou definici **jedinou**: `sectionProps`, protože na ni
 * odkazuje `sectionBlock` přes `$ref`. Všechny ostatní bloky mají schéma vlastností
 * vepsané přímo do `<typ>Block.properties.props`. Dřívější znění tohohle testu
 * hledalo `$defs.headingProps` a podobná jména; ta ve schématu nejsou, takže by
 * test spadl na chybějící definici u jedenácti bloků z dvanácti a vypadalo by to
 * jako vada descriptorů. Ověřeno čtením skutečného souboru, ne dohadem.
 *
 * `$ref` se rozřeší, protože právě u sekce vede na sourozeneckou definici.
 */
function propsSchemaOf(type: string): JsonSchemaNode | undefined {
  const block = schema.$defs[`${type}Block`];
  const props = block?.properties?.props;
  if (!props) return undefined;
  if (props.$ref) {
    const name = props.$ref.replace('#/$defs/', '');
    return schema.$defs[name];
  }
  return props;
}

/**
 * Číselné meze vlastnosti. Vlastnost, která smí být `null` nebo `"full"`, je ve
 * schématu `oneOf` a meze bydlí v číselné větvi, ne na uzlu samotném.
 *
 * Odchylka od doslovného kódu plánu: ten meze hledal jen na uzlu a nullable
 * vlastnosti přeskakoval podle `nullValue`. Tím by z osmi číselných vlastností
 * nezkontroloval ani jednu tam, kde na tom záleží nejvíc, protože právě
 * `fontSize`, `lineHeight`, `borderRadius` a `heightMobile` jsou nullable.
 */
function numericConstraints(node: JsonSchemaNode): {
  minimum?: number | undefined;
  maximum?: number | undefined;
} {
  if (node.minimum !== undefined || node.maximum !== undefined) {
    return { minimum: node.minimum, maximum: node.maximum };
  }
  const branch = (node.oneOf ?? []).find(
    (option) => option.type === 'integer' || option.type === 'number',
  );
  return { minimum: branch?.minimum, maximum: branch?.maximum };
}

/**
 * Pole, která nový blok z palety z podstaty nemá vyplněná: obrázek nemá vybraný
 * soubor a tlačítko nemá cíl. Schéma P08 je vyžaduje jako UUID a jako neprázdný
 * řetězec, takže výchozí hodnoty z descriptoru (i z `blockDefaults` v P08) jimi
 * neprojdou. Doplňují se tady, aby test zkoumal descriptor, ne tuhle známou
 * neúplnost; tu hlídá samostatný test níž.
 */
const REQUIRED_BY_USER: Record<string, Record<string, unknown>> = {
  image: { assetId: '00000000-0000-4000-8000-000000000000' },
  button: { href: 'https://example.com' },
};

function documentWith(type: string) {
  const block = createBlock(type, REQUIRED_BY_USER[type] ?? {});
  const inner = type === 'section' ? block : { ...createBlock('section'), children: [block] };
  return {
    schemaVersion: 1,
    meta: { name: 'Test', previewText: '', language: 'cs' },
    // Prázdný motiv schématem neprojde: kořen vyžaduje osm klíčů. Odchylka od
    // doslovného kódu plánu, který tady měl `theme: {}` a spadl by u všech bloků
    // na motivu, ne na descriptoru.
    theme: DEFAULT_THEME,
    blocks: [inner],
  };
}

describe('descriptory proti JSON Schema z P08', () => {
  it.each(Object.keys(BLOCK_DESCRIPTORS).filter((t) => t !== 'column'))(
    'blok %s vytvořený z descriptoru projde schématem',
    (type) => {
      const ok = validate(documentWith(type));
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    },
  );

  it.each(Object.entries(BLOCK_DESCRIPTORS))(
    'meze číselných vlastností bloku %s odpovídají schématu',
    (type, descriptor) => {
      const def = propsSchemaOf(type);
      expect(def, `v JSON Schema chybí vlastnosti bloku ${type}`).toBeDefined();
      for (const group of descriptor.groups) {
        for (const prop of group.props) {
          if (prop.kind !== 'number') continue;
          const inSchema = def!.properties?.[prop.key];
          expect(inSchema, `${type}.${prop.key} není ve schématu`).toBeDefined();
          const bounds = numericConstraints(inSchema!);
          expect([prop.key, bounds.minimum]).toEqual([prop.key, prop.min]);
          expect([prop.key, bounds.maximum]).toEqual([prop.key, prop.max]);
        }
      }
    },
  );

  it('každá vlastnost z descriptoru existuje ve schématu bloku', () => {
    for (const [type, descriptor] of Object.entries(BLOCK_DESCRIPTORS)) {
      const def = propsSchemaOf(type);
      expect(def, `v JSON Schema chybí vlastnosti bloku ${type}`).toBeDefined();
      const allowed = Object.keys(def!.properties ?? {});
      for (const group of descriptor.groups) {
        for (const prop of group.props) {
          if (prop.kind === 'visibility') continue; // visibleWhen je na bloku, ne v props
          expect(allowed, `${type}.${prop.key}`).toContain(prop.key);
        }
      }
    }
  });

  it.each([
    ['image', 'assetId'],
    ['button', 'href'],
  ])('nový blok %s je neúplný právě v poli %s, dokud ho uživatel nevyplní', (type, expectedKey) => {
    // Bez tohohle testu by doplnění hodnot v REQUIRED_BY_USER zakrylo den,
    // kdy P08 povinnost zruší nebo přidá další. Kontroluje se, že chybí
    // právě jedno pole, ne že „něco nesedí".
    const block = createBlock(type);
    validate({
      schemaVersion: 1,
      meta: { name: 'Test', previewText: '', language: 'cs' },
      theme: DEFAULT_THEME,
      blocks: [{ ...createBlock('section'), children: [block] }],
    });
    const missing = new Set(
      (validate.errors ?? [])
        .filter((error) => error.keyword === 'format' || error.keyword === 'minLength')
        .map((error) => error.instancePath.split('/props/')[1]),
    );
    expect([...missing]).toEqual([expectedKey]);
  });

  it('sekce má vlastnosti v samostatné definici, ostatní bloky vepsané', () => {
    // Tenhle test nekontroluje descriptory, ale předpoklad, na kterém stojí
    // `propsSchemaOf`. Kdyby P08 tvar schématu změnil, spadne tady jedna
    // srozumitelná věta místo dvanácti nejasných.
    expect(schema.$defs.sectionBlock?.properties?.props?.$ref).toBe('#/$defs/sectionProps');
    expect(schema.$defs.headingBlock?.properties?.props?.$ref).toBeUndefined();
    expect(schema.$defs.headingBlock?.properties?.props?.properties).toBeDefined();
  });
});
