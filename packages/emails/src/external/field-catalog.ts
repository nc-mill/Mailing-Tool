/**
 * ROZHRANÍ, KTERÉ TENHLE BALÍČEK OČEKÁVÁ OD P07. Žádná implementace, jen typy.
 *
 * Bohatý katalog polí vlastní P07 (rozhodnutí R2, předpoklad P-6), který ho
 * vydává funkcí `getFieldCatalog(ctx: WorkspaceContext): Promise<FieldCatalog>`.
 * Tenhle balíček katalog nikdy nesestavuje, jen ho dostává v kontextu, takže
 * tady je zapsaný jen jeho tvar, doslova podle plánu P07
 * (`packages/core/src/contacts/fields/catalog.ts`).
 *
 * Proč ne import z `@mlain/core/contacts`, jak ho píše plán P08: graf balíčků
 * v `packages/config/src/package-graph.ts` povoluje `@mlain/emails` jen hrany
 * na `@mlain/contracts` a `@mlain/i18n`, a hrana `@mlain/core → @mlain/emails`
 * je normativní. Import z jádra by byl cyklus a ESLint ho odmítá. Až se P07
 * a hrana grafu vyřeší, nahradí se tenhle soubor jedním reexportem, aniž by se
 * hnulo čímkoli, co ho používá.
 */

/** Popisek v libovolném počtu jazyků. Klíč je jazykový tag, en je povinný jako záchyt. */
export type LocalizedText = Record<string, string> & { en: string };

export type FieldCatalogType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'list';

export type FieldCatalogEntry = {
  /** 'first_name' | 'attr.city' | 'greeting', tedy BEZ prefixu contact. */
  path: string;
  type: FieldCatalogType;
  label: LocalizedText;
  group: 'identity' | 'name' | 'salutation' | 'custom' | 'meta';
  /** Jen u typu 'list': typ položky. */
  itemType?: FieldCatalogType;
  /** true u archivovaného pole. Šablona ho smí mít, ale editor ho nenabízí. */
  deleted: boolean;
};

export type FieldCatalog = {
  fields: FieldCatalogEntry[];
  /** Hash katalogu kvůli invalidaci cache. */
  version: string;
};
