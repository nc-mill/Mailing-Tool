'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Textarea } from '@mlain/ui/components/textarea';
import {
  parsePastedContacts,
  PASTE_MAX_ROWS,
  type PasteResult,
  type PasteRow,
} from './paste-parser';

export type PasteContactsProps = {
  /** Bez něj jde požadavek bez hlavičky `X-Workspace-Id` a RLS nevrátí ani řádek. */
  workspaceId: string;
  /** `/w/{slug}/contacts`. Z něj se skládá cesta na výsledek dávky. */
  basePath: string;
  lists?: { id: string; name: string; optIn?: 'single' | 'double'; isDefault?: boolean }[];
  tags?: { id: string; name: string }[];
  /** Rozestup dotazů na stav dávky. Testy si ho zkracují, aby neběžely v reálném čase. */
  pollIntervalMs?: number;
};

/**
 * `running` NENÍ `saving` a `failed` NENÍ „doběhlo jinak".
 *
 * Rozdělení stavů je oprava konkrétní vady, ne úklid. Obrazovka po `confirm`
 * rovnou navigovala na `/contacts/import/{id}`, jenže import je v tu chvíli ve
 * stavu `importing` a výsledková stránka každý stav mimo své čtyři koncové
 * překlápí na `failed` (`KNOWN` v `contacts/import/[importId]/page.tsx`).
 * Uživatel tedy četl „Import se nepodařilo dokončit. Do databáze se nezapsal
 * žádný kontakt." u dávky, která se o tři vteřiny později zapsala celá.
 *
 * Naměřeno na živé instalaci: import `ee92e919` má `created_at 13:07:35.565`,
 * `started_at 13:07:35.737`, `finished_at 13:07:38.601`, `status completed`,
 * `created_rows 3`, `error_rows 0`. Obrazovka mezitím hlásila neúspěch.
 *
 * To je horší než tichá chyba: uživatel dávku vloží znovu a myslí si, že
 * zakládá poprvé. Proto se tady na výsledek POČKÁ a navigace proběhne teprve
 * na koncovém stavu, ať už je to úspěch, nebo skutečné selhání.
 */
type Phase =
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'running'; importId: string; processed: number; total: number | null }
  | { kind: 'slow'; importId: string }
  | { kind: 'failed'; detail: string };

/**
 * Stavy, po kterých import nikam nepokročí. Shodné se seznamem v
 * `features/import/step-progress.tsx` i v `events.routes.ts`; kdyby se
 * rozešly, jedna z cest by uživatele nechala viset na obrazovce průběhu.
 */
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);

/** Kolikrát se obrazovka zeptá na stav, než uživatele pustí dál s odkazem na výsledek. */
const POLL_MAX_ATTEMPTS = 80;

/** Kolik po sobě jdoucích neúspěšných dotazů se snese, než se dotazování vzdá. */
const POLL_MAX_ERRORS = 5;

/**
 * Sloupce dočasného CSV, které se z vloženého textu skládá.
 *
 * Nejsou to názvy pro člověka, jsou to KLÍČE MAPOVÁNÍ: server podle nich pozná,
 * který sloupec je adresa. Slovník názvů hlaviček v jádře je nezná
 * (`first_name` s podtržítkem ve slovníku není, je tam „first name"), takže se
 * mapování nastavuje pevně přes `PATCH`, ne odhadem. Kdyby se odhadovalo,
 * skončilo by jméno i příjmení jako „nepoužívat" a naimportovaly by se samotné
 * adresy bez jmen.
 */
const COLUMNS = ['email', 'first_name', 'last_name'] as const;

/** Kolik chybných řádků se vypíše, než se zbytek shrne do jedné věty. */
const PROBLEM_PREVIEW_LIMIT = 50;

/** Hodnota, kterou v rozbalovátku nese volba „Založit nový seznam". */
const CREATE_LIST = '__create__';

/**
 * Mapování sloupců pro `PATCH /contacts/imports/{id}`.
 *
 * Skládá se z HLAVIČKY, KTEROU VRÁTIL SERVER, ne z pevných indexů 0, 1, 2. Je to
 * pojistka proti tichému rozjetí: kdyby server rozpoznal jiný oddělovač, než
 * s jakým se soubor složil, měl by hlavička jediný sloupec a pevné indexy by
 * namapovaly jméno a příjmení na sloupce, které neexistují. Kontakty by se
 * naimportovaly bez jmen a nikde by se to neohlásilo. Když sloupec chybí,
 * vrací se `null` a obrazovka import NEPOTVRDÍ.
 */
export function mappingForHeader(header: string[]): Record<string, { target: string }> | null {
  const mapping: Record<string, { target: string }> = {};
  header.forEach((_name, index) => {
    mapping[String(index)] = { target: 'ignore' };
  });
  for (const column of COLUMNS) {
    const index = header.indexOf(column);
    if (index === -1) return null;
    mapping[String(index)] = { target: column };
  }
  return mapping;
}

/** Pauza mezi dotazy na stav dávky. Nula znamená „hned", což využívají testy. */
function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/** Řádky do těla `POST /contacts/imports`. Hodnoty musí být řetězce, i prázdné. */
function toApiRows(rows: PasteRow[]): Record<string, string>[] {
  return rows.map((row) => ({
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
  }));
}

/**
 * Vložení dávky kontaktů textem.
 *
 * NEZAKLÁDÁ KONTAKTY SAMA. Skládá z vloženého textu dočasné CSV a pouští ho
 * hotovou dávkovou cestou importu (`POST /contacts/imports` s tělem JSON,
 * `PATCH` s mapováním a volbami, `POST /confirm`). Ta už umí blokované adresy,
 * shodu s existujícími kontakty, pátý pád i uložení chybných řádků. Vlastní
 * zakládání po jednom přes `POST /contacts` by znamenalo druhou implementaci
 * týchž kontrol, která se s tou první rozejde, a u tisícovky řádků tisíc
 * požadavků bez možnosti navázat po přerušení.
 *
 * Souhrn před uložením se ale počítá TADY, ne na serveru: server vidí až
 * hotové CSV a neumí ukázat, na kterém řádku VLOŽENÉHO TEXTU chyba je.
 */
export function PasteContacts({
  workspaceId,
  basePath,
  lists = [],
  tags = [],
  pollIntervalMs = 1500,
}: PasteContactsProps) {
  const t = useTranslations('contacts');
  const router = useRouter();

  const [text, setText] = useState('');
  /** Předvybraný je výchozí seznam projektu, jinak nic; prázdno se nedá odeslat. */
  const [available, setAvailable] = useState(lists);
  const [listId, setListId] = useState<string | null>(
    lists.find((list) => list.isDefault === true)?.id ?? null,
  );
  const [listError, setListError] = useState<string | null>(null);
  const [showCreateList, setShowCreateList] = useState(lists.length === 0);
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [createdListName, setCreatedListName] = useState<string | null>(null);
  // Výchozí je PŘIHLÁŠENÝ, protože o kontakty vložené ručně z vlastního seznamu
  // se nikdo nepřihlašuje formulářem a nepotvrzený stav by je vyřadil z rozesílek.
  const [subscriptionStatus, setSubscriptionStatus] = useState<'confirmed' | 'pending'>(
    'confirmed',
  );
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [declaration, setDeclaration] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });

  const listWrapperRef = useRef<HTMLDivElement>(null);
  const newListRef = useRef<HTMLInputElement>(null);

  const parsed: PasteResult = useMemo(() => parsePastedContacts(text), [text]);
  const tooMany = parsed.rows.length > PASTE_MAX_ROWS;
  // Běžící ukládání sem NEPATŘÍ: druhé kliknutí odchytí `pending` na tlačítku.
  // Kdyby bylo součástí `canSave`, ukázal by se během ukládání důvod
  // nedostupnosti, tedy věta o prázdném textu nad textem, který prázdný není.
  const canSave = parsed.rows.length > 0 && !tooMany;
  /**
   * Prohlášení o doloženém souhlasu. Bez něj automat u seznamu s DVOJÍM
   * potvrzením přihlášení nepotvrdí (`skipConfirmation` v `subscribe-service.ts`
   * platí jen s `declaration`), takže obrazovka slibovala „potvrzené"
   * a v databázi vznikalo „čeká na potvrzení". Ověřeno na dev serveru 5. 8. 2026.
   */
  const selectedList = available.find((list) => list.id === listId);
  const declarationRequired =
    selectedList?.optIn === 'double' && subscriptionStatus === 'confirmed';
  /** Od odeslání až po doběhnutí dávky se nesmí spustit druhé zakládání. */
  const busy = phase.kind === 'saving' || phase.kind === 'running';

  /**
   * `Select` z P05 ref nepřijímá, takže se spouštěč hledá v obalu. Tentýž
   * postup má `SelectField` i krok Volby v průvodci importem.
   */
  function focusList(): void {
    const trigger = listWrapperRef.current?.querySelector('[role="combobox"]');
    if (trigger instanceof HTMLElement) trigger.focus();
  }

  /**
   * Založení seznamu rovnou tady. Bez téhle cesty by člověk s prázdným projektem
   * musel odejít jinam a vložený text by ztratil, protože ho drží jen tahle
   * obrazovka. Dvojí potvrzení je bezpečná výchozí volba, stejná jako u tlačítka
   * „Nový seznam" v seznamech i v průvodci importem.
   */
  async function createList(): Promise<void> {
    const name = newListName.trim();
    if (name === '') {
      setListError(t('paste.newListNameRequired'));
      newListRef.current?.focus();
      return;
    }
    setCreatingList(true);
    try {
      const res = await fetch('/api/v1/lists', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name, opt_in: 'double' }),
      });
      if (!res.ok) {
        console.error(`Seznam ${name} se nepodařilo založit: HTTP ${res.status}`, await res.text());
        setListError(t('paste.newListFailed'));
        return;
      }
      /*
       * `opt_in` se čte Z ODPOVĚDI, ne z přání. Na něm stojí, jestli obrazovka
       * bude trvat na prohlášení o souhlasu; bez něj by se u čerstvě založeného
       * seznamu s dvojím potvrzením prohlášení nevyžádalo a dávka by skončila
       * jako nepotvrzená, přestože uživatel zvolil „potvrzené".
       */
      const created = (
        (await res.json()) as { data: { id: string; name: string; opt_in: 'single' | 'double' } }
      ).data;
      setAvailable((previous) => [
        ...previous,
        { id: created.id, name: created.name, optIn: created.opt_in },
      ]);
      setListId(created.id);
      setCreatedListName(created.name);
      setShowCreateList(false);
      setNewListName('');
      setListError(null);
    } catch (error) {
      console.error(`Seznam ${name} se nepodařilo založit.`, error);
      setListError(t('paste.newListFailed'));
    } finally {
      setCreatingList(false);
    }
  }

  function toggleTag(id: string) {
    setTagIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }

  /** Společné hlavičky. Bez `X-Workspace-Id` skončí každý z těch čtyř kroků na 404. */
  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json', ...extra };
  }

  /**
   * Zapíše poruchu do konzole I NA OBRAZOVKU. Krok se do hlášky nedostane
   * doslova, ale do konzole ano: uživateli je „HTTP 409" k ničemu, kdežto tomu,
   * kdo to po něm dohledává, řekne „selhalo v kroku patch" všechno.
   */
  function fail(step: string, status: number, detail: string) {
    console.error(`Vložení kontaktů textem selhalo v kroku ${step}: HTTP ${status}`, detail);
    setPhase({ kind: 'failed', detail: status === 0 ? step : `HTTP ${status}` });
  }

  /**
   * Selhání se MUSÍ projevit. Tichý `return` u neúspěšné odpovědi by nechal
   * obrazovku v podobě, ve které vypadá, že se nic nestalo, a uživatel by dávku
   * vložil znovu, tentokrát s duplicitami.
   */
  async function save() {
    if (!canSave || busy) return;
    // Bez seznamu se neukládá. Kontrola je tady, po kliknutí, ne v podobě
    // zakázaného tlačítka: to by neřeklo proč.
    if (listId === null) {
      setListError(t('paste.listRequired'));
      focusList();
      return;
    }
    if (declarationRequired && !declaration) {
      setListError(t('paste.declarationRequired'));
      return;
    }
    setListError(null);
    setPhase({ kind: 'saving' });

    try {
      // 1. Založení importu z řádků. Server si z nich složí CSV a uloží ho.
      const created = await fetch('/api/v1/contacts/imports', {
        method: 'POST',
        headers: headers({ 'Idempotency-Key': crypto.randomUUID() }),
        body: JSON.stringify({ rows: toApiRows(parsed.rows) }),
      });
      if (!created.ok) {
        return fail('create', created.status, await created.text());
      }
      const importId = ((await created.json()) as { id?: string }).id;
      if (importId === undefined) return fail('create', created.status, 'odpověď bez id');

      // 2. Náhled. Kromě hlavičky dělá i to podstatné: převede import ze stavu
      //    pending do previewing, bez čehož `PATCH` skončí na 409.
      const preview = await fetch(`/api/v1/contacts/imports/${importId}/preview`, {
        headers: headers(),
      });
      if (!preview.ok) return fail('preview', preview.status, await preview.text());
      const header = ((await preview.json()) as { header?: string[] }).header ?? [];

      const mapping = mappingForHeader(header);
      if (mapping === null) {
        return fail('mapping', 0, `hlavička ${JSON.stringify(header)} nemá čekané sloupce`);
      }

      // 3. Mapování a volby v jednom požadavku.
      const patched = await fetch(`/api/v1/contacts/imports/${importId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
          mapping,
          options: {
            on_conflict: 'update',
            // Duplicity uvnitř dávky se odstranily už při rozboru textu, takže
            // se sem žádná nedostane. Volba je tu proto, aby se nespoléhalo na
            // výchozí hodnotu, kdyby se rozbor někdy změnil.
            duplicate_in_file: 'first',
            // Seznam je povinný, takže tu vždycky je právě jeden.
            list_ids: [listId],
            /*
             * Stav přihlášení jde do voleb importu, protože `ImportOptionsSchema`
             * pole `subscription_status` PŘIJÍMÁ a ukládá (ověřeno proti
             * `packages/core/src/contacts/import/options.ts`). Dosazuje se tedy
             * skutečná volba uživatele, ne pevná hodnota.
             */
            subscription_status: subscriptionStatus,
            tag_ids: tagIds,
            // Souhlas je DOKLAD, ne zaškrtávátko navíc: ukládá se k importu
            // i k souhlasu každého kontaktu a bez něj se přihlášení na seznamu
            // s dvojím potvrzením nepotvrdí.
            consent: declaration
              ? {
                  purpose: 'email_marketing' as const,
                  legal_basis: 'consent' as const,
                  source: 'paste',
                  declaration: true,
                }
              : null,
          },
        }),
      });
      if (!patched.ok) return fail('patch', patched.status, await patched.text());

      // 4. Spuštění. Od téhle chvíle je dávka na serveru a obrazovka jen ukazuje
      //    výsledek, tentýž jako u importu ze souboru.
      const confirmed = await fetch(`/api/v1/contacts/imports/${importId}/confirm`, {
        method: 'POST',
        headers: headers(),
      });
      if (!confirmed.ok) return fail('confirm', confirmed.status, await confirmed.text());

      // 5. Čekání na doběhnutí. Od `confirm` výš už kontakty VZNIKAJÍ, takže od
      //    téhle chvíle se nesmí ohlásit selhání založení ani tehdy, když se
      //    obrazovka na stav nedoptá.
      setPhase({ kind: 'running', importId, processed: 0, total: parsed.rows.length });
      await waitForImport(importId);
    } catch (error) {
      fail('network', 0, String(error));
    }
  }

  /**
   * Počká, až import doběhne, a teprve pak přepne na výsledek.
   *
   * Neúspěšný DOTAZ na stav není neúspěšný import. Když se stav nepodaří
   * zjistit, obrazovka nehlásí chybu, ale řekne pravdu: dávka je na serveru
   * a doběhne i bez téhle obrazovky. Odkaz na výsledek zůstane.
   */
  async function waitForImport(importId: string) {
    let errors = 0;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      await sleep(pollIntervalMs);
      try {
        const res = await fetch(`/api/v1/contacts/imports/${importId}`, { headers: headers() });
        if (!res.ok) {
          errors += 1;
          if (errors >= POLL_MAX_ERRORS) break;
          continue;
        }
        errors = 0;
        const row = (await res.json()) as {
          status?: string;
          checkpoint_row?: number;
          total_rows?: number | null;
        };
        if (row.status !== undefined && TERMINAL_STATUSES.has(row.status)) {
          router.push(`${basePath}/import/${importId}`);
          return;
        }
        setPhase({
          kind: 'running',
          importId,
          processed: row.checkpoint_row ?? 0,
          total: row.total_rows ?? null,
        });
      } catch {
        errors += 1;
        if (errors >= POLL_MAX_ERRORS) break;
      }
    }
    setPhase({ kind: 'slow', importId });
  }

  const shownProblems = parsed.problems.slice(0, PROBLEM_PREVIEW_LIMIT);
  const shownDuplicates = parsed.duplicates.slice(0, PROBLEM_PREVIEW_LIMIT);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text">{t('paste.title')}</h1>
        <p className="text-sm text-text-muted">{t('paste.intro')}</p>
      </div>

      <Field label={t('paste.fieldLabel')} hint={t('paste.fieldHint')}>
        <Textarea
          rows={14}
          className="font-mono"
          spellCheck={false}
          placeholder={t('paste.example')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>

      {/* Souhrn se počítá při psaní, ne až po odeslání. Uživatel tím uvidí
          překlep hned, ne až po minutě čekání na import. */}
      <section className="flex flex-col gap-2" aria-labelledby="paste-summary-title">
        <h2 id="paste-summary-title" className="font-semibold text-text">
          {t('paste.summaryTitle')}
        </h2>
        <p role="status">
          {text.trim() === ''
            ? t('paste.summaryEmpty')
            : [
                t('paste.summaryOk', { count: parsed.rows.length }),
                t('paste.summaryInvalid', { count: parsed.problems.length }),
                t('paste.summaryDuplicates', { count: parsed.duplicates.length }),
              ].join(' ')}
        </p>

        {tooMany ? <p role="alert">{t('paste.tooMany', { limit: PASTE_MAX_ROWS })}</p> : null}

        {/* Chybné řádky s ČÍSLEM I OBSAHEM. Samotný počet by uživateli řekl,
            že má něco opravit, ale ne co, a v tisícovce řádků by to nenašel. */}
        {parsed.problems.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-text">{t('paste.problemsTitle')}</h3>
            <p className="text-sm text-text-muted">{t('paste.problemsHint')}</p>
            <ul className="flex flex-col gap-1">
              {shownProblems.map((problem) => (
                <li key={problem.lineNumber} className="text-sm">
                  {t('paste.problemLine', {
                    // Číslo řádku jako řetězec: jako číslo by ho formátovač
                    // rozdělil po tisících a „řádek 1 024" se v textovém poli
                    // nehledá.
                    line: String(problem.lineNumber),
                    content: problem.raw,
                    reason: t(`paste.problemReason.${problem.code}`),
                  })}
                </li>
              ))}
            </ul>
            {parsed.problems.length > shownProblems.length ? (
              <p className="text-sm text-text-muted">
                {t('paste.problemsMore', { count: parsed.problems.length - shownProblems.length })}
              </p>
            ) : null}
          </div>
        ) : null}

        {parsed.duplicates.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-text">{t('paste.duplicatesTitle')}</h3>
            <p className="text-sm text-text-muted">{t('paste.duplicatesHint')}</p>
            <ul className="flex flex-col gap-1">
              {shownDuplicates.map((duplicate) => (
                <li key={duplicate.lineNumber} className="text-sm">
                  {t('paste.duplicateLine', {
                    line: String(duplicate.lineNumber),
                    content: duplicate.raw,
                    firstLine: String(duplicate.firstSeenLine),
                  })}
                </li>
              ))}
            </ul>
            {parsed.duplicates.length > shownDuplicates.length ? (
              <p className="text-sm text-text-muted">
                {t('paste.problemsMore', {
                  count: parsed.duplicates.length - shownDuplicates.length,
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-4">
        {/*
          ZAŘAZENÍ DO SEZNAMU JE POVINNÉ, stejně jako v průvodci importem.
          Volba „do žádného seznamu" tady byla výchozí, takže tahle obrazovka
          byla druhá branka k témuž výsledku: kontakt, kterému nemá co dojít
          a nemá se z čeho odhlásit, protože publikum kampaně i odhlašovací
          odkaz stojí na seznamech.
        */}
        <div ref={listWrapperRef} className="flex flex-col gap-1.5">
          <span aria-hidden className="font-semibold text-text">
            {t('paste.list')}
          </span>
          <Select
            aria-label={t('paste.list')}
            placeholder={t('paste.listPlaceholder')}
            {...(listId === null ? {} : { value: listId })}
            onValueChange={(next) => {
              if (next === CREATE_LIST) {
                setShowCreateList(true);
                setListError(null);
                window.setTimeout(() => newListRef.current?.focus(), 0);
                return;
              }
              setShowCreateList(false);
              setListError(null);
              setListId(next);
            }}
          >
            {available.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
            <SelectItem value={CREATE_LIST}>{t('paste.createList')}</SelectItem>
          </Select>
          <p className="text-sm text-text-muted">{t('paste.listHint')}</p>
        </div>

        {createdListName === null ? null : (
          <p role="status" className="text-sm text-text-muted">
            {t('paste.newListCreated', { name: createdListName })}
          </p>
        )}

        {showCreateList ? (
          <div className="flex flex-col gap-3 rounded-[var(--radius-surface)] border border-border p-4">
            <Field label={t('paste.newListName')} hint={t('paste.newListNameHint')}>
              <Input
                ref={newListRef}
                value={newListName}
                maxLength={120}
                data-testid="paste-new-list-name"
                onChange={(event) => setNewListName(event.target.value)}
              />
            </Field>
            <Button variant="secondary" className="self-start" onClick={() => void createList()}>
              {creatingList ? t('paste.newListCreating') : t('paste.newListCreate')}
            </Button>
          </div>
        ) : null}

        {/* Tatáž volba, jakou má ruční přidání jednoho kontaktu. Výchozí je
            přihlášený, protože jinak by dávka skončila mimo rozesílky a nikdo
            by nevěděl proč. */}
        <fieldset className="flex flex-col gap-1">
          <legend className="font-semibold text-text">{t('paste.status')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="paste-subscription"
              value="confirmed"
              checked={subscriptionStatus === 'confirmed'}
              onChange={() => setSubscriptionStatus('confirmed')}
            />
            {t('paste.statusConfirmed')}
          </label>
          <p className="text-sm text-text-muted">{t('paste.statusConfirmedHint')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="paste-subscription"
              value="pending"
              checked={subscriptionStatus === 'pending'}
              onChange={() => setSubscriptionStatus('pending')}
            />
            {t('paste.statusPending')}
          </label>
          <p className="text-sm text-text-muted">{t('paste.statusPendingHint')}</p>
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="font-semibold text-text">{t('paste.tags')}</legend>
          {tags.length === 0 ? (
            <p className="text-sm text-text-muted">{t('paste.noTags')}</p>
          ) : (
            <>
              <p className="text-sm text-text-muted">{t('paste.tagsHint')}</p>
              {tags.map((tag) => (
                <label key={tag.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tagIds.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                  />
                  {tag.name}
                </label>
              ))}
            </>
          )}
        </fieldset>
      </div>

      {/* Běžící zpracování je PRŮBĚH, ne chyba. Tenhle blok je ta oprava: mezi
          „confirm" a koncovým stavem dávky stála dřív navigace na výsledek,
          který v tu chvíli hlásil neúspěch. */}
      {phase.kind === 'running' ? (
        <div className="flex flex-col gap-1" role="status" aria-live="polite">
          <strong>{t('paste.runningTitle')}</strong>
          <p>{t('paste.runningBody')}</p>
          {phase.total !== null && phase.total > 0 ? (
            <p>{t('paste.runningCounter', { processed: phase.processed, total: phase.total })}</p>
          ) : null}
        </div>
      ) : null}

      {/* Dávka je na serveru, jen se na ni obrazovka nedoptala. Ani tady se
          nesmí tvrdit, že se nic nezaložilo. */}
      {phase.kind === 'slow' ? (
        <div className="flex flex-col items-start gap-1" role="status">
          <strong>{t('paste.slowTitle')}</strong>
          <p>{t('paste.slowBody')}</p>
          <Button
            variant="secondary"
            onClick={() => router.push(`${basePath}/import/${phase.importId}`)}
          >
            {t('paste.slowLink')}
          </Button>
        </div>
      ) : null}

      {phase.kind === 'failed' ? (
        <div role="alert" className="flex flex-col items-start gap-1">
          <strong>{t('paste.failedTitle')}</strong>
          <p>{t('paste.failedBody', { detail: phase.detail })}</p>
        </div>
      ) : null}

      {/* Primární tlačítko se NEZAKAZUJE (princip P5): když akci nejde provést,
          zůstane klikatelné a řekne důvod. Zakázané tlačítko bez vysvětlení je
          na téhle obrazovce nejhorší možná odpověď, protože důvod bývá překlep
          na jednom řádku z pěti set. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <Checkbox
            id="paste-declaration"
            checked={declaration}
            aria-describedby="paste-declaration-evidence"
            onCheckedChange={(next) => {
              setDeclaration(next === true);
              setListError(null);
            }}
          />
          <label htmlFor="paste-declaration" className="text-sm text-text">
            {t('paste.declaration')}
          </label>
        </div>
        <p id="paste-declaration-evidence" className="text-sm text-text-muted">
          {t('paste.declarationEvidence')}
        </p>
      </div>

      {listError === null ? null : (
        <p role="alert" className="text-sm text-danger-text">
          {listError}
        </p>
      )}

      {/* Cílový seznam je vidět u tlačítka, protože výchozí bývá předvybraný. */}
      {listId === null ? null : (
        <p className="text-sm text-text-muted">
          {t('paste.submitTarget', {
            list: available.find((list) => list.id === listId)?.name ?? '',
          })}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="primary"
          pending={busy}
          pendingLabel={phase.kind === 'running' ? t('paste.runningTitle') : t('paste.submitting')}
          {...(canSave ? {} : { unavailableReason: t('paste.unavailable') })}
          onClick={() => void save()}
        >
          {t('paste.submit', { count: parsed.rows.length })}
        </Button>
        <Button variant="secondary" onClick={() => router.push(basePath)}>
          {t('paste.cancel')}
        </Button>
      </div>
    </section>
  );
}
