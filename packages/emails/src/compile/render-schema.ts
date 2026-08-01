import type { FieldCatalog, FieldCatalogType } from '../external/field-catalog';
import { toCatalogPath } from '../paths';
import type { RenderSchema } from './types';
import type { Document, FooterBlock, VisibilityCondition } from '../document/types';
import { richTextFieldsOf, walkBlocks, walkRichText } from '../document/walk';

export type RenderSchemaOptions = {
  fields: FieldCatalog;
  skippedBlockIds: Set<string>;
};

export type RenderSchemaResult = {
  renderSchema: RenderSchema;
  fields: RenderSchema['fields'];
  presence: string[];
  systemTags: string[];
  usedPaths: string[];
};

const SYSTEM_TAGS = new Set([
  'unsubscribe_url',
  'one_click_unsubscribe_url',
  'preferences_url',
  'webview_url',
]);
const SYSTEM_URL_TAG = /^\{\{\s*(unsubscribe_url|preferences_url|webview_url)\s*\}\}$/;

/** Cesta z výrazu: všechno před prvním filtrem. */
function pathOf(expr: string): string {
  return expr.split('|')[0]!.trim();
}

function typeOf(path: string, catalog: FieldCatalog): FieldCatalogType {
  if (!path.startsWith('contact.')) return 'string';
  const entry = catalog.fields.find((f) => f.path === toCatalogPath(path));
  return entry?.type ?? 'string';
}

export function buildRenderSchema(doc: Document, options: RenderSchemaOptions): RenderSchemaResult {
  const fieldPaths: string[] = [];
  const presence: string[] = [];
  const systemTags: string[] = [];

  const addField = (path: string): void => {
    if (!fieldPaths.includes(path)) fieldPaths.push(path);
  };
  const addSystem = (tag: string): void => {
    if (!systemTags.includes(tag)) systemTags.push(tag);
  };

  for (const { block, pointer } of walkBlocks(doc)) {
    if (options.skippedBlockIds.has(block.id)) continue;

    const condition = (block as { visibleWhen?: VisibilityCondition | null }).visibleWhen;
    if (condition) {
      if (condition.op === 'present' || condition.op === 'blank') {
        if (!presence.includes(condition.field)) presence.push(condition.field);
      } else {
        // Boolean pole pomocnou mapu nepotřebuje, false a nil jsou v obou
        // knihovnách jediné nepravdivé hodnoty. Hodnota ale musí do render_data.
        addField(condition.field);
      }
    }

    for (const field of richTextFieldsOf(block)) {
      for (const { node } of walkRichText(field.rich, `${pointer}/props/${field.key}`)) {
        if (node.t === 'a') {
          const tag = node.href.trim().match(SYSTEM_URL_TAG);
          if (tag?.[1]) addSystem(tag[1]);
          continue;
        }
        if (node.t !== 'var') continue;
        const path = pathOf(node.expr);
        if (SYSTEM_TAGS.has(path)) addSystem(path);
        else addField(path);
      }
    }

    // Přetypování po zúžení podle `type`: v `AnyBlock` je i `UnknownBlock`
    // s indexovou signaturou, takže `block.props` by samo o sobě bylo `unknown`.
    if (block.type === 'footer') {
      const footer = block as FooterBlock;
      if (footer.props.showUnsubscribe) addSystem('unsubscribe_url');
      if (footer.props.showPreferences) addSystem('preferences_url');
      if (footer.props.showWebview) addSystem('webview_url');
    }
  }

  const fields = fieldPaths.map((path) => ({
    path,
    type: typeOf(path, options.fields),
    required: false,
  }));

  const renderSchema: RenderSchema = {
    version: 1,
    fields,
    systemTags,
    presence,
    // Cykly vydá až MVP 1; `repeat` je v MVP 0 vždy mezi přeskočenými bloky.
    loops: [],
  };

  const usedPaths = [...new Set([...fieldPaths, ...systemTags, ...presence])];
  return { renderSchema, fields, presence, systemTags, usedPaths };
}
