/**
 * Filtry seznamu kontaktů žijí v URL, ne ve stavu komponenty. Plyne to z kapitoly 4.4
 * části 6: odkaz na filtrovaný seznam se dá poslat kolegovi a zpětné tlačítko funguje.
 *
 * Hledání se posílá jako parametr q. Diakritiku řeší server: normalizuje výraz toutéž
 * funkcí normalizeNameKey, jakou plní sloupce first_name_key a last_name_key, takže „novak“
 * najde „Novák“ i naopak (rozhodnutí R12 hlavičky plánu). V rozhraní se proto nic
 * nenormalizuje.
 */

export const CONTACT_STATUSES = [
  'active',
  'unconfirmed',
  'unsubscribed',
  'bounced',
  'complained',
  'deleted',
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** Povolené hodnoty order z kapitoly 5.1 části 2. Každá má krycí index, jiná projít nesmí. */
export const CONTACT_LIST_ORDERS = [
  'created_at.desc',
  'created_at.asc',
  'updated_at.desc',
  'last_activity_at.desc',
] as const;

export type ContactListOrder = (typeof CONTACT_LIST_ORDERS)[number];

export type ContactListFilters = {
  q?: string;
  status?: ContactStatus;
  list_id?: string;
  tag_id?: string;
  segment_id?: string;
  vocative_confidence?: 'low';
  created_after?: string;
  created_before?: string;
};

export type FilterNames = {
  lists: Record<string, string>;
  tags: Record<string, string>;
  segments: Record<string, string>;
};

export type FilterChip = { key: string; values: Record<string, string> };

type SearchParamsInput = Record<string, string | string[] | undefined>;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Čte filtry z URL. Neznámou hodnotu zahodí místo toho, aby ji poslala na API:
 * odkaz s překlepem má ukázat nefiltrovaný seznam, ne chybu 422.
 */
export function readContactFilters(
  searchParams: SearchParamsInput,
  options: { greetingEnabled?: boolean } = {},
): ContactListFilters {
  const filters: ContactListFilters = {};

  const q = first(searchParams['q']);
  if (q) filters.q = q;

  const status = first(searchParams['status']);
  if (status && (CONTACT_STATUSES as readonly string[]).includes(status)) {
    filters.status = status as ContactStatus;
  }

  for (const key of ['list_id', 'tag_id', 'segment_id'] as const) {
    const value = first(searchParams[key]);
    if (value && ID.test(value)) filters[key] = value;
  }

  // Projekt, který oslovení neřeší, filtr „nejisté oslovení" zahodí i z URL.
  // Je to táž úvaha jako u neznámé hodnoty o pár řádků výš: odkaz, který sem
  // někdo poslal e-mailem nebo si ho uložil do záložek, má ukázat seznam
  // kontaktů, ne odznak filtru, ke kterému v rozhraní nevede žádné ovládání.
  const vocative = first(searchParams['vocative_confidence']);
  if (vocative === 'low' && options.greetingEnabled !== false) {
    filters.vocative_confidence = 'low';
  }

  for (const key of ['created_after', 'created_before'] as const) {
    const value = first(searchParams[key]);
    if (value && DATE.test(value)) filters[key] = value;
  }

  return filters;
}

/** Parametry pro apiFetch. Prázdné hodnoty se vynechávají, ať v logu není šum. */
export function filtersToQuery(
  filters: ContactListFilters,
  extra: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== '') query[key] = value;
  }
  return query;
}

/** Které filtry má lišta nad tabulkou svoje ovládání a umí je tedy ukázat sama. */
export type ToolbarControls = {
  /** Nabídka seznamů. Bez jediného seznamu se nekreslí. */
  list: boolean;
  /** Nabídka štítků. Bez jediného štítku se nekreslí. */
  tag: boolean;
};

/**
 * Filtry, které z lišty NEJSOU vidět, a musí je tedy vypsat pruh pod ní.
 *
 * Vzniklo to proto, aby se táž informace neříkala dvakrát: nad tlačítkem „Novinky"
 * nemá stát „Filtr: seznam Novinky". Odečítá se jen to, co lišta opravdu ukazuje:
 *
 *  - hledaný výraz je v hledacím poli vždycky,
 *  - stav jen tehdy, když pro něj je tlačítko. Přepínač má „Všechny", „Aktivní"
 *    a „Nepotvrzené", takže odhlášený, odražený, stěžující si a smazaný na něm poznat
 *    NEJSOU a zůstávají v pruhu. Bez toho by odkaz na odražené kontakty vypadal jako
 *    nefiltrovaný seznam,
 *  - seznam a štítek jen tehdy, když se jejich nabídka vůbec kreslí.
 *
 * Segment, nejisté oslovení a rozsah data přidání v liště ovládání nemají vůbec,
 * takže se nikdy neodečítají.
 */
export function filtersOffToolbar(
  filters: ContactListFilters,
  controls: ToolbarControls,
): ContactListFilters {
  const rest: ContactListFilters = { ...filters };
  delete rest.q;
  if (rest.status === 'active' || rest.status === 'unconfirmed') delete rest.status;
  if (controls.list) delete rest.list_id;
  if (controls.tag) delete rest.tag_id;
  return rest;
}

/**
 * Filtr pro počet nepotvrzených kontaktů v meta řádku pod názvem obrazovky.
 *
 * MUSÍ TO BÝT PODÍL Z ČÍSLA VEDLE. Věta „13 kontaktů · 10 nepotvrzených" se čte tak,
 * že z těch třinácti jich deset čeká na potvrzení. Dřív se druhé číslo počítalo za celý
 * projekt bez ohledu na filtr, takže se zapnutým filtrem tvrdilo, že ze sedmi kontaktů
 * je deset nepotvrzených. Rozsah je proto TÝŽ filtr, jen se stavem `unconfirmed`.
 *
 * `null` znamená, že se počítat nemá. Nastane u zapnutého filtru stavu: „jen aktivní"
 * dá vždycky nulu a „jen nepotvrzené" tutéž hodnotu jako počet vedle. Obojí je šum,
 * protože stav je stejně vypsaný v pruhu s filtrem nad tabulkou.
 */
export function unconfirmedCountFilters(filters: ContactListFilters): ContactListFilters | null {
  if (filters.status !== undefined) return null;
  return { ...filters, status: 'unconfirmed' };
}

export function hasAnyFilter(filters: ContactListFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '');
}

/**
 * Popis filtru po částech. Vrací klíče, ne hotový text, protože věta „Filtr: seznam
 * Zákazníci, štítek Brno" se nesmí skládat z fragmentů (pravidlo 12.2 části 6).
 * Každá část je celá zpráva s vlastním klíčem a spojí je Intl.ListFormat.
 */
export function describeFilters(filters: ContactListFilters, names: FilterNames): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.list_id) {
    chips.push({
      key: 'chip.list',
      values: { value: names.lists[filters.list_id] ?? filters.list_id },
    });
  }
  if (filters.tag_id) {
    chips.push({
      key: 'chip.tag',
      values: { value: names.tags[filters.tag_id] ?? filters.tag_id },
    });
  }
  if (filters.segment_id) {
    chips.push({
      key: 'chip.segment',
      values: { value: names.segments[filters.segment_id] ?? filters.segment_id },
    });
  }
  if (filters.status) {
    // Hodnota je překladový klíč stavu, ne holé anglické slovo. Přeloží ho volající.
    chips.push({ key: 'chip.status', values: { value: `status.${filters.status}` } });
  }
  if (filters.vocative_confidence) {
    chips.push({ key: 'chip.vocative', values: {} });
  }
  if (filters.created_after) {
    chips.push({ key: 'chip.createdAfter', values: { value: filters.created_after } });
  }
  if (filters.created_before) {
    chips.push({ key: 'chip.createdBefore', values: { value: filters.created_before } });
  }
  if (filters.q) {
    chips.push({ key: 'chip.search', values: { value: filters.q } });
  }

  return chips;
}

/** Odkaz na tentýž filtr s jiným kurzorem. Čísla stránek v URL nikdy nejsou. */
export function contactsHref(
  basePath: string,
  filters: ContactListFilters,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}
