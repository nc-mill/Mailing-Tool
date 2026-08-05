import type { ContactListFilters } from './filters';

/**
 * Publikum exportu kontaktů.
 *
 * TOHLE NENÍ FILTR SEZNAMU A NIKDY NEBYLO. Job `contacts.export` posílá uložený
 * `filter` rovnou do `compileAudienceToSql`, takže tvar musí být `Audience`
 * z `packages/core/src/segments/repo.ts`, tedy `{ segmentIds, listIds, ast }`.
 *
 * Do 5. 8. 2026 posílal `exportContactsAction` buď `{ ids: [...] }`, nebo filtry
 * seznamu kontaktů, a navíc neposílal povinné `columns`. Schéma `CreateExportRequest`
 * je `.strict()`, takže KAŽDÝ export ze seznamu kontaktů skončil na 422
 * `validation_failed`. Tlačítko „Stáhnout tyhle kontakty jako CSV" v dialogu mazání
 * tedy nikdy nic nestáhlo a uživatel mazal bez zálohy, o které si myslel, že ji má.
 */
export type ExportAudience = {
  segmentIds?: string[];
  listIds?: string[];
  ast?: ExportAst;
};

type ConditionNode = {
  type: 'condition';
  field: Record<string, string>;
  operator: string;
  value?: string;
  values?: string[];
};

export type ExportAst = {
  version: 1;
  root: { type: 'group'; op: 'and'; children: ConditionNode[] };
};

/**
 * Sloupce souboru. Schéma je vyžaduje (`min(1)`) a tenhle výčet je zvolený tak,
 * aby šel soubor po úpravě nahrát zpátky importem.
 */
export const EXPORT_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'greeting',
  'status',
  'tags',
] as const;

/**
 * Strop výčtu hodnot v jedné podmínce (`ConditionNodeSchema` v jádru). Nad ním
 * server vrátí 422, takže se výběr nad tisíc kontaktů musí exportovat filtrem.
 */
export const MAX_AUDIENCE_VALUES = 1000;

export type AudienceOutcome =
  | { ok: true; audience: ExportAudience }
  | { ok: false; reason: 'search' | 'too_many' | 'empty' | 'partial' };

function group(children: ConditionNode[]): ExportAst {
  return { version: 1, root: { type: 'group', op: 'and', children } };
}

/**
 * Publikum „tyhle konkrétní kontakty".
 *
 * Jde přes E-MAILY, ne přes id, a je to vynucené doménou: `Audience` výčet id
 * nezná a `CONTACT_FIELD_KEYS` v segmentech `id` nemá. E-mail je v projektu
 * jednoznačný, takže výsledek je tentýž; jen se musí předat ze seznamu, který
 * ho na obrazovce stejně ukazuje.
 */
export function emailsToAudience(emails: string[], expectedCount?: number): AudienceOutcome {
  if (emails.length === 0) return { ok: false, reason: 'empty' };
  if (emails.length > MAX_AUDIENCE_VALUES) return { ok: false, reason: 'too_many' };
  /*
   * NEÚPLNÝ VÝBĚR SE NEEXPORTUJE MLČKY.
   *
   * Výběr v tabulce přežije přestránkování, kdežto adresy zná obrazovka jen u řádků,
   * které právě vykreslila. Kdyby se rozdíl přehlédl, uživatel by dostal soubor
   * s částí toho, co zaškrtl, a nepoznal by to: počet řádků v CSV nikdo nekontroluje.
   */
  if (expectedCount !== undefined && emails.length !== expectedCount) {
    return { ok: false, reason: 'partial' };
  }
  return {
    ok: true,
    audience: {
      ast: group([
        {
          type: 'condition',
          field: { kind: 'contact', key: 'email' },
          operator: 'in',
          values: emails,
        },
      ]),
    },
  };
}

/** Publikum „kontakty s tímhle štítkem". */
export function tagToAudience(tagId: string): ExportAudience {
  return {
    ast: group([
      { type: 'condition', field: { kind: 'tag' }, operator: 'has_any', values: [tagId] },
    ]),
  };
}

/**
 * Publikum podle filtru seznamu kontaktů.
 *
 * HLEDANÝ VÝRAZ SE PŘELOŽIT NEDÁ a tiše se vynechat nesmí. Server pro `q`
 * normalizuje diakritiku sloupci `first_name_key` a `last_name_key`, kdežto
 * podmínka `contains` v segmentech porovnává surovou hodnotu. Přeložený filtr
 * by tedy vrátil JINOU množinu, než jakou má uživatel na obrazovce, a export
 * by mlčky obsahoval kontakty, které nevybral. Vrací se proto důvod a rozhraní
 * z něj napíše, co udělat místo toho.
 *
 * Seznam a segment se předávají zvlášť, ne jako podmínky: `compileAudienceToSql`
 * pro ně má `listIds` a `segmentIds` a sám je přeloží na členství, včetně
 * rozlišení statického a dynamického segmentu.
 */
export function filtersToAudience(filters: ContactListFilters): AudienceOutcome {
  if (filters.q !== undefined && filters.q.trim() !== '') return { ok: false, reason: 'search' };

  const children: ConditionNode[] = [];

  if (filters.status !== undefined) {
    children.push({
      type: 'condition',
      field: { kind: 'contact', key: 'status' },
      operator: 'eq',
      value: filters.status,
    });
  }
  if (filters.tag_id !== undefined) {
    children.push({
      type: 'condition',
      field: { kind: 'tag' },
      operator: 'has_any',
      values: [filters.tag_id],
    });
  }
  if (filters.vocative_confidence !== undefined) {
    children.push({
      type: 'condition',
      field: { kind: 'contact', key: 'vocative_confidence' },
      operator: 'eq',
      value: filters.vocative_confidence,
    });
  }
  // Datum z URL je den bez času. `after` a `before` porovnávají hodnotu tak, jak
  // přijde, takže hranice dne se řídí zónou databáze; u filtru „od" a „do" je to
  // rozdíl nejvýš na hraničním dni a seznam ho má stejně.
  if (filters.created_after !== undefined) {
    children.push({
      type: 'condition',
      field: { kind: 'contact', key: 'created_at' },
      operator: 'after',
      value: filters.created_after,
    });
  }
  if (filters.created_before !== undefined) {
    children.push({
      type: 'condition',
      field: { kind: 'contact', key: 'created_at' },
      operator: 'before',
      value: filters.created_before,
    });
  }

  const audience: ExportAudience = {
    ...(filters.list_id === undefined ? {} : { listIds: [filters.list_id] }),
    ...(filters.segment_id === undefined ? {} : { segmentIds: [filters.segment_id] }),
  };

  if (children.length > 0) return { ok: true, audience: { ...audience, ast: group(children) } };
  if (audience.listIds !== undefined || audience.segmentIds !== undefined) {
    return { ok: true, audience };
  }

  // Nefiltrovaný seznam znamená „všechny kontakty", jenže PRÁZDNÉ PUBLIKUM JÁDRO
  // ODMÍTÁ (`audience_empty`): kdyby prošlo, znamenalo by to „nikdo" nebo „všichni"
  // podle toho, kdo ho čte. Podmínka „stav je vyplněný" platí pro každý kontakt
  // a je to týž trik, jakým si jádro řeší prázdný segment (`EMPTY_AST`).
  return {
    ok: true,
    audience: {
      ast: group([
        { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'is_not_empty' },
      ]),
    },
  };
}
