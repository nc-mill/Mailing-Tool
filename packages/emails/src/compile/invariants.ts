import { CLICK_MARKER_PREFIX, OPEN_PIXEL_MARKER } from '@mlain/contracts/markers';
import { validateLiquid } from '@mlain/contracts/liquid';
import { parseHTML } from 'linkedom';
import type { Issue } from '../issue';
import type { FilterSlot } from '../normalize/slots';
import type { CompiledLink } from './types';

export type InvariantInput = {
  html: string;
  text: string;
  links: CompiledLink[];
  trackOpens: boolean;
  purpose: 'send' | 'preview' | 'test';
  filterSlots: FilterSlot[];
  usedSlots: Set<number>;
  unknownSlots: number[];
  /** Sloty uvnitř podmíněného bloku se nekontrolují, viz I10. */
  exemptSlots: Set<number>;
  rawPrefix: string;
};

export type InvariantResult = { issues: Issue[]; clickMarkerCount: number };

const HTML_SOFT_LIMIT = 102_400;
const LIQUID_CONSTRUCT = /\{\{[^}]*\}\}|\{%[^%]*%\}/g;
const ENTITY = /&(quot|#39|lt|gt|amp);/;
const COMMENT = /<!--[\s\S]*?-->/g;

const error = (code: string, params?: Record<string, string | number>): Issue => ({
  code,
  severity: 'error',
  pointer: '',
  params,
});

export function checkInvariants(input: InvariantInput): InvariantResult {
  const issues: Issue[] = [];
  const both = `${input.html}\n${input.text}`;

  // I1
  const constructs = both.match(LIQUID_CONSTRUCT) ?? [];
  for (const construct of constructs) {
    if (ENTITY.test(construct)) {
      issues.push(error('liquid_escaped_entity_in_construct', { construct }));
      continue;
    }
    // Druhá úroveň gramatiky. `level: "compiled"` je jediný rozdíl proti autorské
    // kontrole: kompilovaná šablona argumenty filtrů má a kořen `_present` smí,
    // autorská ani jedno. Samostatná funkce `validateCompiledLiquid` neexistuje,
    // je to tentýž `validateLiquid` s jiným kontextem.
    //
    // Odchylka od plánu: nález `liquid_unbalanced_block` se u jedné konstrukce
    // zahazuje. Párování `{% if %}` a `{% endif %}` je vlastnost celé posloupnosti,
    // ne jednoho výrazu, takže samostatně validované `{% endif %}` by shodilo
    // každý podmíněný blok. Vyváženost se kontroluje o kus níž nad všemi
    // konstrukcemi naráz, takže se na ni nerezignuje.
    const found = validateLiquid(construct, { level: 'compiled' }).issues.filter(
      (issue) => issue.severity === 'error' && issue.code !== 'liquid_unbalanced_block',
    );
    if (found.length > 0) {
      issues.push(error('render_liquid_corrupted', { construct, first: found[0]!.code }));
    }
  }
  const chained = validateLiquid(constructs.join('\n'), { level: 'compiled' });
  if (chained.issues.some((issue) => issue.code === 'liquid_unbalanced_block')) {
    issues.push(error('render_liquid_corrupted', { reason: 'unbalanced' }));
  }

  // I2
  const pixels = input.html.split(OPEN_PIXEL_MARKER).length - 1;
  if ((input.trackOpens && pixels !== 1) || (!input.trackOpens && pixels !== 0)) {
    issues.push(error('render_pixel_slot_invalid', { found: pixels }));
  }

  // I3
  const found = [...both.matchAll(new RegExp(`${CLICK_MARKER_PREFIX}([0-9a-f-]{36})`, 'g'))];
  const clickMarkerCount = found.length;
  const known = new Set(input.links.map((link) => link.id));
  for (const match of found) {
    if (!known.has(match[1]!)) {
      issues.push(error('render_link_map_mismatch', { linkId: match[1]! }));
      break;
    }
  }
  const positions = input.links.map((link) => link.position).sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index + 1)) {
    issues.push(error('render_link_map_mismatch', { reason: 'positions' }));
  }

  // I4
  if (input.purpose === 'send' && /data-ml-(block|link)=/.test(input.html)) {
    issues.push(error('render_editor_attrs_leaked'));
  }

  // I5
  try {
    parseHTML(input.html);
  } catch {
    issues.push(error('render_invalid_html', { reason: 'parse' }));
  }
  // Komentáře se odstraní dřív, jinak by se počítaly i tabulky uvnitř
  // podmíněných komentářů pro Outlook, které v DOM nikdy nevzniknou.
  const visible = input.html.replace(COMMENT, '');
  const opened = (visible.match(/<table[\s>]/g) ?? []).length;
  const closed = (visible.match(/<\/table>/g) ?? []).length;
  if (opened !== closed) {
    issues.push(error('render_invalid_html', { opened, closed }));
  }

  // I6
  if (/<script|javascript:|onerror=|onload=/i.test(input.html)) {
    issues.push(error('render_forbidden_content'));
  }

  // I7
  for (const tag of input.html.match(/<img\b[^>]*>/gi) ?? []) {
    const complete =
      /\ssrc=/.test(tag) && /\swidth=/.test(tag) && /\sheight=/.test(tag) && /\salt=/.test(tag);
    if (!complete) {
      issues.push(error('render_image_incomplete', { tag: tag.slice(0, 80) }));
      break;
    }
  }

  // I8, jediná nefatální výjimka
  const htmlBytes = Buffer.byteLength(input.html, 'utf8');
  if (htmlBytes > HTML_SOFT_LIMIT) {
    issues.push({
      code: 'render_too_large',
      severity: 'warning',
      pointer: '',
      params: { bytes: htmlBytes },
    });
  }

  // I9
  if (both.includes('ML_ARG_')) issues.push(error('render_filter_slot_unresolved'));

  // I10
  for (const slot of input.filterSlots) {
    if (input.usedSlots.has(slot.slot) || input.exemptSlots.has(slot.slot)) continue;
    issues.push(error('render_filter_slot_missing', { slot: slot.slot }));
  }

  // I11
  if (input.unknownSlots.length > 0) {
    issues.push(error('render_filter_slot_invalid_value', { slots: input.unknownSlots.join(',') }));
  }

  // I12
  if (both.includes(input.rawPrefix)) issues.push(error('render_raw_slot_unresolved'));

  return { issues, clickMarkerCount };
}
