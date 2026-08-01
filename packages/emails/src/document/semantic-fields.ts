import { validateLiquid, type LiquidContext } from '@mlain/contracts/liquid';
import type { FieldCatalog, FieldCatalogType } from '../external/field-catalog';
import { fromLiquidIssue, type Issue } from '../issue';
import { toCatalogPath, toLiquidRoots } from '../paths';
import { contrastRatio } from '../theme/palette';
import { resolveTheme } from '../theme/resolve';
import type {
  ColorRef,
  Document,
  FooterBlock,
  HtmlBlock,
  ImageBlock,
  SectionBlock,
  VisibilityCondition,
} from './types';
import { pointerToDotted, richTextFieldsOf, walkBlocks, walkRichText } from './walk';

export type FieldContext = {
  templateKind: 'campaign' | 'transactional' | 'system';
  fields: FieldCatalog;
  assetIds: Set<string>;
  /** Odhad velikosti HTML. Přesné číslo zná až renderer, tohle je vstup pro pravidlo S9. */
  estimatedHtmlBytes: number;
};

const HTML_WARN_BYTES = 80 * 1024;
const HTML_ERROR_BYTES = 102 * 1024;

/** Operátory podmínky podle typu pole, normativní tabulka z 3.1.10 a 3.8.2. */
const OPERATORS_BY_TYPE: Record<FieldCatalogType, VisibilityCondition['op'][]> = {
  string: ['present', 'blank'],
  number: ['present', 'blank'],
  boolean: ['true', 'false'],
  date: ['present', 'blank'],
  datetime: ['present', 'blank'],
  list: ['present', 'blank'],
};

const ALLOWED_ROOTS = [
  'contact',
  'campaign',
  'workspace',
  'unsubscribe_url',
  'one_click_unsubscribe_url',
  'preferences_url',
  'webview_url',
];

const issue = (
  code: string,
  severity: Issue['severity'],
  pointer: string,
  params?: Record<string, string | number>,
): Issue => ({ code, severity, pointer, path: pointerToDotted(pointer), params });

export function checkFields(doc: Document, ctx: FieldContext): Issue[] {
  const issues: Issue[] = [];
  const theme = resolveTheme(doc.theme);
  const liquidContext: LiquidContext = {
    // `level: "authored"` je povinné. Autorská gramatika zakazuje argumenty
    // filtrů i kořen `_present`; kompilovanou úroveň kontroluje až invariant I1.
    level: 'authored',
    // Validátor chce ÚZKÝ tvar `LiquidRoots`, ne bohatý katalog polí od P07.
    // Jsou to dva různé typy (rozhodnutí R2), převod je v `../paths`.
    fields: toLiquidRoots(ctx.fields),
    roots: ALLOWED_ROOTS,
    template_kind: ctx.templateKind,
  };
  let hasUnsubscribe = false;

  for (const { block, pointer } of walkBlocks(doc)) {
    // S13
    const condition = (block as { visibleWhen?: VisibilityCondition | null }).visibleWhen;
    if (condition) {
      const entry = ctx.fields.fields.find((f) => f.path === toCatalogPath(condition.field));
      if (!entry) {
        issues.push(
          issue('content_condition_field_unknown', 'error', `${pointer}/visibleWhen/field`, {
            path: condition.field,
          }),
        );
      } else if (!OPERATORS_BY_TYPE[entry.type].includes(condition.op)) {
        issues.push(
          issue('content_condition_operator_invalid', 'error', `${pointer}/visibleWhen/op`, {
            op: condition.op,
            type: entry.type,
          }),
        );
      }
    }

    // Přetypování po zúžení podle `type`: v `AnyBlock` je i `UnknownBlock`
    // s indexovou signaturou, takže `block.props` by samo o sobě bylo `unknown`.
    if (block.type === 'image') {
      const image = block as ImageBlock;
      // S6
      if (!ctx.assetIds.has(image.props.assetId)) {
        issues.push(
          issue('content_asset_not_found', 'error', `${pointer}/props/assetId`, {
            assetId: image.props.assetId,
          }),
        );
      }
      if (image.props.darkVariantAssetId && !ctx.assetIds.has(image.props.darkVariantAssetId)) {
        issues.push(
          issue('content_asset_not_found', 'error', `${pointer}/props/darkVariantAssetId`),
        );
      }
      // S7
      if (!image.props.decorative && image.props.alt.trim() === '') {
        issues.push(issue('content_image_missing_alt', 'warning', `${pointer}/props/alt`));
      }
    }
    if (
      block.type === 'section' &&
      (block as SectionBlock).props.backgroundImageAssetId &&
      !ctx.assetIds.has((block as SectionBlock).props.backgroundImageAssetId!)
    ) {
      issues.push(
        issue('content_asset_not_found', 'error', `${pointer}/props/backgroundImageAssetId`),
      );
    }

    // S8, kontrast se kontroluje ve světlém i tmavém režimu
    const color = (block as { props?: { color?: ColorRef } }).props?.color;
    if (typeof color === 'string') {
      const light = contrastRatio(theme.light.color(color), theme.light.roles['surface.content']);
      const dark = contrastRatio(theme.dark.color(color), theme.dark.roles['surface.content']);
      if (light < 4.5 || dark < 4.5) {
        issues.push(
          issue('content_low_contrast', 'warning', `${pointer}/props/color`, {
            light: Math.round(light * 100) / 100,
            dark: Math.round(dark * 100) / 100,
          }),
        );
      }
    }

    if (block.type === 'footer' && (block as FooterBlock).props.showUnsubscribe) {
      hasUnsubscribe = true;
    }

    // S11 a S12, Liquid výrazy uzlů var a kód bloku html
    for (const field of richTextFieldsOf(block)) {
      const base = `${pointer}/props/${field.key}`;
      for (const { node, pointer: inlinePointer } of walkRichText(field.rich, base)) {
        if (node.t === 'a' && /^\{\{\s*unsubscribe_url\s*\}\}$/.test(node.href.trim())) {
          hasUnsubscribe = true;
        }
        if (node.t !== 'var') continue;
        pushLiquid(issues, `{{ ${node.expr} }}`, `${inlinePointer}/expr`, liquidContext);
        if (node.fallback !== undefined && /["'{}<>]/.test(node.fallback)) {
          issues.push(issue('liquid_default_value_invalid', 'error', `${inlinePointer}/fallback`));
        }
      }
    }
    if (block.type === 'html') {
      pushLiquid(issues, (block as HtmlBlock).props.code, `${pointer}/props/code`, liquidContext);
    }
  }

  // S4
  if (!hasUnsubscribe) {
    issues.push(
      issue(
        'content_missing_unsubscribe',
        ctx.templateKind === 'campaign' ? 'error' : 'warning',
        '',
      ),
    );
  }

  // S9
  if (ctx.estimatedHtmlBytes > HTML_ERROR_BYTES) {
    issues.push(issue('content_html_too_large', 'error', '', { bytes: ctx.estimatedHtmlBytes }));
  } else if (ctx.estimatedHtmlBytes > HTML_WARN_BYTES) {
    issues.push(issue('content_html_too_large', 'warning', '', { bytes: ctx.estimatedHtmlBytes }));
  }

  return issues;
}

function pushLiquid(issues: Issue[], source: string, pointer: string, ctx: LiquidContext): void {
  for (const found of validateLiquid(source, ctx).issues) {
    // Ne spread. `LiquidIssue` nese `span`, který ukazuje do řetězce výrazu,
    // ne do dokumentu, a spreadem by se protáhl dál a pletl se s pozicí uzlu.
    issues.push(fromLiquidIssue(found, pointer, pointerToDotted(pointer)));
  }
}
