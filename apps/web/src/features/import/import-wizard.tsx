'use client';

import { Wizard } from '@mlain/ui/patterns/wizard';
import { useWizardStep } from '@mlain/ui/patterns/wizard';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { wizardLabels } from './labels';
import { StepFileCheck, type FileCheckPreview } from './step-file-check';
import { StepMapping, type MappingColumn } from './step-mapping';
import { StepOptions, type ImportOptionsValue, type ListOption } from './step-options';
import { StepPreview, type PreviewRow } from './step-preview';
import { StepProgress } from './step-progress';
import { StepUpload } from './step-upload';

export const STEPS = ['upload', 'fileCheck', 'mapping', 'preview', 'options', 'progress'] as const;
export type Step = (typeof STEPS)[number];

type ApiPreview = {
  encoding: string;
  encoding_source: string;
  delimiter: string;
  has_header: boolean;
  header: string[];
  mapping: Record<string, { target?: string } | undefined>;
  /** Počet DATOVÝCH řádků celého souboru, bez hlavičky. */
  total_rows: number;
  total_rows_approximate: boolean;
  /** Prvních pár řádků v surové podobě, ve stejném pořadí sloupců jako `header`. */
  sample_rows: string[][];
  rows: {
    row_number: number;
    email: string | null;
    title_prefix: string | null;
    first_name: string | null;
    last_name: string | null;
    gender: string | null;
    greeting: string | null;
    state?: 'ok' | 'error' | 'suppressed' | 'duplicate';
  }[];
  mapping_warnings: string[];
};

/**
 * Stav načtení náhledu. Čtyři hodnoty, ne `ApiPreview | null`, a je to
 * podstatné: `null` nedokáže odlišit „ještě se to nenačetlo" od „načtení
 * SELHALO". Průvodce pak selhání vykresloval jako výchozí hodnoty, tedy
 * středník a nula kontaktů, přestože server měl v databázi správně
 * detekovanou čárku a padesát řádků. Uživatel z toho usoudil, že se nahrálo
 * málo řádků a špatný oddělovač, a šel opravovat nastavení, které bylo
 * v pořádku. Prázdné číslo se nikdy nesmí tvářit jako výsledek (nález I72).
 */
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: ApiPreview }
  | { kind: 'failed'; detail: string };

/**
 * Převod mapování z podoby obrazovky do podoby API.
 *
 * Krok Mapování drží volby pod NÁZVEM sloupce a jako holý řetězec
 * (`{ "email": "email" }`), kdežto server bere INDEX sloupce a objekt
 * (`{ "1": { "target": "email" } }`) a jiný tvar odmítne s 422. Průvodce
 * dřív posílal svou podobu rovnou a odpověď zahazoval, takže se mapování
 * nikdy neuložilo a krok Náhled pracoval s návrhem serveru, ne s tím, co
 * uživatel vybral. Neprojevilo se to ničím: obrazovka šla dál jako by se
 * uložilo.
 */
function toApiMapping(
  header: string[],
  chosen: Record<string, string>,
): Record<string, { target: string }> {
  const out: Record<string, { target: string }> = {};
  header.forEach((name, index) => {
    const target = chosen[name];
    out[String(index)] = { target: target === undefined || target === '' ? 'ignore' : target };
  });
  return out;
}

/**
 * Volby obrazovky převedené do tvaru, který přijímá `ImportOptionsSchema`.
 *
 * Schéma je `.strict()`, takže JEDINÝ klíč navíc shodí celý PATCH na 422 a průvodce
 * se z kroku Volby nehne. Přesně to se dělo: posílal se `tag`, tedy jméno štítku, které
 * schéma nezná (zná `tag_ids` s identifikátory), a s ním se zahazovaly i všechny ostatní
 * volby, které obrazovka sbírá. Seznam, stav přihlášení ani prohlášení o souhlasu se
 * na server nikdy nedostaly.
 *
 * Čtvrtá možnost v otázce „Co když už kontakt máme?" míří JINAM než první tři.
 * „Přeskočit / Doplnit / Přepsat" je `on_conflict`, tedy co s kontaktem, který už
 * v databázi je, kdežto „Nahlásit jako chybu" mluví o druhém výskytu téže adresy
 * V SOUBORU, což je `duplicate_in_file`. Ve schématu jsou to dvě různá pole a `error`
 * v `on_conflict` neexistuje, takže dosazovat ho tam znamenalo 422.
 */
function toApiOptions(value: ImportOptionsValue, tagIds: string[]): Record<string, unknown> {
  const duplicateError = value.onConflict === 'error';
  return {
    on_conflict: duplicateError ? 'update' : value.onConflict,
    duplicate_in_file: duplicateError ? 'error' : 'last',
    list_ids: value.listId === null ? [] : [value.listId],
    subscription_status: value.subscriptionStatus,
    tag_ids: tagIds,
    // Prohlášení není zaškrtávátko navíc, je to doklad: ukládá se do voleb importu
    // i do evidence u každého zapsaného souhlasu (4.6.5). Bez něj se souhlas
    // nezapisuje vůbec, protože nemáme co doložit.
    consent: value.declaration
      ? {
          purpose: 'email_marketing',
          legal_basis: 'consent',
          source: 'import',
          declaration: true,
        }
      : null,
  };
}

export type ImportWizardProps = {
  workspaceId: string;
  workspaceSlug: string;
  locale?: string;
  importId: string | null;
  initialStep?: Step;
  lists?: ListOption[];
  pending?: { filename: string };
};

/**
 * Skořápka průvodce nad K3.
 *
 * Krok je v query (`?step=mapping`), ne v segmentu cesty: předepisuje to
 * 4.3 části 6 a je to jediný tvar, ve kterém jde poslat odkaz na konkrétní
 * krok, aniž by se rozbilo tlačítko zpět v prohlížeči.
 *
 * ŽÁDNÝ `beforeunload` během importu. Úloha běží na serveru a varování
 * „opravdu chcete odejít?" u operace, která na odchodu nezávisí, je lež,
 * která naučí uživatele zavírat všechna varování bez čtení.
 */
export function ImportWizard({
  workspaceId,
  workspaceSlug,
  locale = 'cs',
  importId: initialImportId,
  initialStep = 'upload',
  lists = [],
  pending,
}: ImportWizardProps) {
  const t = useTranslations('import');
  const router = useRouter();
  const { current, goToStep } = useWizardStep({
    steps: STEPS.map((id) => ({ id })),
    defaultStepId: initialStep,
  });
  const step = current as Step;

  const [importId, setImportId] = useState<string | null>(initialImportId);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [mapping, setMapping] = useState<Record<string, string>>({});

  /**
   * Selhání se MUSÍ projevit. Dřív tu stálo `if (!res.ok) return;`, takže
   * pětistovka z náhledu neudělala vůbec nic: `preview` zůstal `null`,
   * obrazovka vykreslila výchozí hodnoty a nikde, ani v konzoli, po tom
   * nezůstala stopa.
   */
  const loadPreview = useCallback(async () => {
    if (importId === null) return;
    setPreview({ kind: 'loading' });
    try {
      const res = await fetch(`/api/v1/contacts/imports/${importId}/preview`, {
        headers: { 'X-Workspace-Id': workspaceId },
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`Náhled importu ${importId} selhal: HTTP ${res.status}`, body);
        setPreview({ kind: 'failed', detail: `HTTP ${res.status}` });
        return;
      }
      setPreview({ kind: 'ready', data: (await res.json()) as ApiPreview });
    } catch (error) {
      console.error(`Náhled importu ${importId} se nepodařilo načíst.`, error);
      setPreview({ kind: 'failed', detail: String(error) });
    }
  }, [importId, workspaceId]);

  /** Kroky, které bez odpovědi serveru nemají co zobrazit. */
  const needsPreview = step === 'fileCheck' || step === 'mapping' || step === 'preview';

  useEffect(() => {
    if (step === 'fileCheck' || step === 'mapping' || step === 'preview') void loadPreview();
  }, [loadPreview, step]);

  const data = preview.kind === 'ready' ? preview.data : null;

  /**
   * Ukázka v kroku Kontrola souboru jsou SUROVÉ buňky souboru, ne výsledná
   * pole. Skládat řádek z e-mailu, jména a příjmení dávalo tabulku, jejíž
   * sloupce nesedí na hlavičku, takže i správně přečtený soubor vypadal
   * rozsypaně, což je přesně ta otázka, na kterou se ten krok ptá.
   */
  const sample: string[][] = data
    ? data.has_header
      ? [data.header, ...data.sample_rows]
      : data.sample_rows
    : [];

  /**
   * Mapování je od serveru klíčované INDEXEM sloupce („0", „1"), ne jeho
   * názvem. Čtení `mapping[name]` proto vracelo vždycky `undefined` a krok
   * Mapování měl u každého sloupce vybráno „Nepoužívat", i když si server
   * sloupce správně rozpoznal sám.
   *
   * Ukázka u sloupce je hodnota TOHO sloupce z prvního datového řádku, takže
   * sedí i u sloupců, které se nikam nemapují.
   */
  const columns: MappingColumn[] = data
    ? data.header.map((name, index) => ({
        name,
        sample: data.sample_rows[0]?.[index] ?? '',
        target: data.mapping[String(index)]?.target ?? 'ignore',
      }))
    : [];

  const previewRows: PreviewRow[] = (data?.rows ?? []).map((row) => ({
    rowNumber: row.row_number,
    email: row.email,
    titlePrefix: row.title_prefix,
    firstName: row.first_name,
    lastName: row.last_name,
    gender: row.gender,
    greeting: row.greeting,
    state: row.state ?? 'ok',
  }));

  /**
   * Všechno ze serveru, nic z výchozích hodnot. `total_rows` je počet
   * DATOVÝCH řádků, kdežto věta v kroku mluví o řádcích souboru („51 řádků,
   * z toho 1 hlavička, tedy 50 kontaktů"), takže se hlavička přičítá zpátky.
   */
  const fileCheck: FileCheckPreview | null = data && {
    encoding: data.encoding,
    delimiter: data.delimiter,
    hasHeader: data.has_header,
    totalRows: data.total_rows + (data.has_header ? 1 : 0),
    sample,
  };

  /**
   * Štítek z obrazovky na identifikátor pro `tag_ids`.
   *
   * Obrazovka nabízí VOLNÝ TEXT s předvyplněným datovým štítkem („import-2026-08-01"),
   * ne výběr z existujících, takže štítek zpravidla ještě neexistuje a jméno se na id
   * musí nejdřív přeložit. Založení je `POST /api/v1/tags`; když štítek s tímhle jménem
   * v projektu je (409, index nad `lower(name)`), dohledá se v seznamu, protože „import
   * ze stejného dne podruhé" je běžný případ, ne chyba.
   *
   * Vrací `null` jen při skutečném selhání. Tiché zahození štítku by bylo horší než
   * chyba: podle něj se podle rozhodnutí R5 dohledává celá naimportovaná skupina,
   * takže bez něj uživatel přijde o jedinou náhradu za „vrátit tento import".
   */
  async function ensureTagId(name: string): Promise<string | null> {
    const headers = { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' };
    const created = await fetch('/api/v1/tags', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    });
    if (created.ok) {
      const body = (await created.json()) as { data: { id: string } };
      return body.data.id;
    }
    if (created.status !== 409) {
      console.error(`Štítek ${name} se nepodařilo založit: HTTP ${created.status}`);
      return null;
    }
    const found = await fetch(`/api/v1/tags?q=${encodeURIComponent(name)}&limit=100`, {
      headers: { 'X-Workspace-Id': workspaceId },
    });
    if (!found.ok) {
      console.error(`Štítek ${name} se nepodařilo dohledat: HTTP ${found.status}`);
      return null;
    }
    const body = (await found.json()) as { data: { id: string; name: string }[] };
    const hit = body.data.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (hit === undefined) console.error(`Štítek ${name} v seznamu není, i když už existuje.`);
    return hit?.id ?? null;
  }

  /** Vrací, jestli se uložilo. Průvodce na neuložené změně nesmí jít dál. */
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    if (importId === null) return false;
    const res = await fetch(`/api/v1/contacts/imports/${importId}`, {
      method: 'PATCH',
      headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`Uložení nastavení importu ${importId} selhalo: HTTP ${res.status}`, detail);
      setPreview({ kind: 'failed', detail: `HTTP ${res.status}` });
      return false;
    }
    await loadPreview();
    return true;
  }

  return (
    <Wizard
      steps={STEPS.map((id) => ({ id, label: t(`wizard.steps.${id}`) }))}
      current={step}
      onNavigate={(next) => goToStep(next)}
      labels={wizardLabels(t)}
      // Návrat z náhledu je destruktivní a musí to říct PŘEDEM: stavový
      // diagram přechod previewing → validating zakazuje, takže se zakládá
      // nový import.
      {...(step === 'preview' ? { destructiveBack: t('wizard.backFromPreview') } : {})}
    >
      {pending ? <p>{t('wizard.resumeBanner', { filename: pending.filename })}</p> : null}
      <p>{t('wizard.resumeExpiry')}</p>

      {/*
        Porucha čtení náhledu má vlastní hlášku s cestou ven. Kroky, které na
        náhledu stojí, se v tu chvíli NEVYKRESLÍ: obrazovka s výchozím
        oddělovačem a nulou kontaktů je horší než chybová hláška, protože
        vypadá jako výsledek a svede uživatele přepsat nastavení, které je
        v pořádku.
      */}
      {/*
        Krok Volby je v podmínce schválně, i když na náhledu nestojí. Uložení voleb
        i založení štítku se dělá právě tady a selhání se dosud nikde neprojevilo:
        tlačítko „Naimportovat" jen nic neudělalo a jediná stopa zůstala v konzoli.
      */}
      {preview.kind === 'failed' && (needsPreview || step === 'options') ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p>{t('previewFailed.title')}</p>
          <p>{t('previewFailed.nextStep', { detail: preview.detail })}</p>
          <button type="button" onClick={() => void loadPreview()}>
            {t('previewFailed.retry')}
          </button>
        </div>
      ) : null}

      {preview.kind === 'loading' && needsPreview ? (
        <p role="status">{t('previewFailed.loading')}</p>
      ) : null}

      {step === 'upload' ? (
        <StepUpload
          workspaceId={workspaceId}
          onCreated={(id) => {
            setImportId(id);
            goToStep('fileCheck');
          }}
        />
      ) : null}

      {step === 'fileCheck' && fileCheck !== null ? (
        <StepFileCheck
          preview={fileCheck}
          onConfirm={async (result) => {
            if (!(await patch({ encoding: result.encoding, delimiter: result.delimiter }))) return;
            goToStep('mapping');
          }}
        />
      ) : null}

      {/*
        Varování k mapování se MUSÍ zobrazit. `full_name_ignored` znamená, že
        volba „Celé jméno" nemá žádný účinek, protože soubor má zároveň sloupec
        se jménem nebo příjmením. Bez téhle hlášky vypadá obrazovka po
        přemapování stejně jako před ním a uživatel nemá jak poznat, že se jeho
        volba zahodila.
      */}
      {(step === 'mapping' || step === 'preview') && data !== null
        ? data.mapping_warnings.map((warning) => (
            <p key={warning} role="alert">
              {t(`mapping.warnings.${warning}`)}
            </p>
          ))
        : null}

      {step === 'mapping' && data !== null ? (
        <StepMapping
          preview={{ columns }}
          onNext={async (next) => {
            setMapping(next);
            if (!(await patch({ mapping: toApiMapping(data.header, next) }))) return;
            goToStep('preview');
          }}
        />
      ) : null}

      {step === 'preview' && data !== null ? (
        <StepPreview
          preview={{ rows: previewRows }}
          estimate={{
            // Celkový počet je o CELÉM souboru, `shown` o vykreslených řádcích.
            // Dosazovat na obě místa délku náhledu znamenalo tvrdit, že soubor
            // má dvacet řádků, ať měl kolik chtěl.
            totalRows: data.total_rows,
            shown: previewRows.length,
            reviewRows: previewRows.filter((row) => row.gender === null).length,
            noEmailRows: previewRows.filter((row) => row.email === null || row.email === '').length,
            duplicateRows: previewRows.filter((row) => row.state === 'duplicate').length,
            approximate: data.total_rows_approximate,
          }}
          onNext={() => goToStep('options')}
        />
      ) : null}

      {step === 'options' ? (
        <StepOptions
          estimate={{
            totalRows: data?.total_rows ?? 0,
            errorRows: previewRows.filter((row) => row.state === 'error').length,
            duplicates: previewRows.filter((row) => row.state === 'duplicate').length,
          }}
          lists={lists}
          onSubmit={async (value) => {
            const tagName = value.tag.trim();
            let tagIds: string[] = [];
            if (tagName !== '') {
              const tagId = await ensureTagId(tagName);
              // Krok se nedokončí. Import bez štítku by se sice spustil, ale skupinu
              // by pak nešlo dohledat a uživatel by se to dozvěděl až za týden.
              if (tagId === null) {
                setPreview({ kind: 'failed', detail: 'tag' });
                return;
              }
              tagIds = [tagId];
            }
            if (!(await patch({ options: toApiOptions(value, tagIds) }))) return;
            if (importId !== null) {
              await fetch(`/api/v1/contacts/imports/${importId}/confirm`, {
                method: 'POST',
                headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' },
              });
            }
            goToStep('progress');
          }}
        />
      ) : null}

      {step === 'progress' && importId !== null ? (
        <StepProgress
          importId={importId}
          workspaceId={workspaceId}
          locale={locale}
          onDone={() => router.push(`/w/${workspaceSlug}/contacts/import/${importId}`)}
        />
      ) : null}

      {/* Mapování drží skořápka, aby se neztratilo při návratu o krok zpět. */}
      <span hidden data-mapping={JSON.stringify(mapping)} />
    </Wizard>
  );
}
