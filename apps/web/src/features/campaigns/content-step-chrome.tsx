'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { Input } from '@mlain/ui/components/input';
import { passwordManagerOptOut } from '@mlain/ui/lib/password-manager';
import { Label } from '@mlain/ui/components/label';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Copy, Save, Search } from '@mlain/ui/icons';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert } from '@mlain/ui/patterns/states';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { useEditorHandoff } from '@/features/editor/state/use-handoff';
import {
  renameCampaignAction,
  saveCampaignContentAsTemplateAction,
  useLibraryTemplateAction,
} from './actions';
import { CampaignBreadcrumbs } from './campaign-breadcrumbs';
import { CampaignNameField } from './campaign-name-field';
import { CampaignStepNav } from './campaign-steps';
import { CAMPAIGN_STEPS, campaignStepHref, type CampaignStep } from './steps';

/** Knihovní šablona v nabídce k převzetí. */
type LibraryTemplate = { id: string; name: string };

/**
 * OD KOLIKA ŠABLON SE V NABÍDCE UKÁŽE HLEDÁNÍ.
 *
 * Dvanáct, a je to změřené, ne odhadnuté. Položka nabídky je 44 px vysoká
 * a nabídka se otevírá zhruba 235 px od horní hrany okna, takže na okně
 * vysokém 900 px (běžný notebook s panely prohlížeče) zbývá na seznam něco
 * přes 600 px, tedy asi třináct řádků, než se začne skrolovat. Hledání se
 * proto objeví TĚSNĚ PŘED tím, než seznam přestane být vidět celý: dokud se
 * dá přejet očima, je pole navíc jen šum a ubírá místo tomu, co uživatel
 * hledá. Že se ovládání s počtem položek mění, je záměr; obojí je táž nabídka
 * pod týmž tlačítkem, jen delší seznam dostane náčiní na hledání.
 */
const SEARCH_FROM = 12;

/**
 * Porovnávací tvar názvu: malá písmena a bez diakritiky.
 *
 * Kdo hledá „vyprodej", musí najít „Ukázka: pozvánka na výprodej". České
 * názvy se píšou s háčky a čárkami, hledá se ale často bez nich, a nabídka,
 * která na „sablona" nenajde „šablonu", vypadá jako rozbitá.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

/**
 * Pruh nad editorem, který z editoru dělá PRVNÍ KROK KAMPANĚ.
 *
 * Dřív byl krok 1 samostatná obrazovka s odkazem „Upravit obsah v editoru".
 * Uživatel tedy musel: otevřít krok 1, kliknout na odkaz, přejít na jinou
 * stránku, napsat e-mail, vrátit se tlačítkem a teprve tam našel cestu na krok 2.
 * Dvě obrazovky navíc kolem jediné věci, kvůli které kampaň vzniká. Editor je
 * proto sám tím krokem a všechno, co k obsahu patří, je tady.
 *
 * Pruh běží UVNITŘ editoru, ne vedle něj: ukládání a odchod si půjčuje přes
 * `useEditorHandoff`, takže obsah kampaně se převezme týmž pořadím kroků, jaké
 * má tlačítko „Pokračovat" v hlavičce. Druhá cesta k zápisu dokumentu nevzniká.
 */
export function CampaignContentChrome({
  workspaceId,
  campaignId,
  campaignName,
  workingCopyId,
  hasDesign,
  templates,
  templatesTruncated = false,
  basePath,
  readOnly,
  canRename,
}: {
  workspaceId: string;
  campaignId: string;
  /** Jméno kampaně z databáze. Předvyplňuje název nové šablony. */
  campaignName: string;
  /** Pracovní kopie obsahu kampaně, tedy dokument otevřený v editoru. */
  workingCopyId: string;
  /** Má kampaň vlastní dokument? Rozhoduje jen o tom, jestli je co přepsat. */
  hasDesign: boolean;
  /** Knihovní šablony, ze kterých jde obsah převzít. */
  templates: ReadonlyArray<LibraryTemplate>;
  /**
   * Server měl další stránku, kterou nabídka nedojde. Stovka je strop cesty,
   * ne konec knihovny, a mlčet o tom by znamenalo tvrdit, že další šablony
   * nejsou.
   */
  templatesTruncated?: boolean;
  basePath: string;
  /** Rozjetá kampaň se needituje: zůstává jen pás kroků, akce mizí. */
  readOnly: boolean;
  /**
   * Smí se kampaň přejmenovat? NENÍ TO `!readOnly`: obsah se u naplánované
   * kampaně měnit nesmí, jméno ano (`EDITABLE_WHILE_SCHEDULED`). Rozhoduje
   * o tom stránka, která zná stav kampaně i práva uživatele.
   */
  canRename: boolean;
}) {
  const t = useTranslations('campaigns.settings');
  const tContent = useTranslations('campaigns.settings.content');
  const tNew = useTranslations('campaigns.new');
  const labels = useConfirmDialogLabels();
  const handoff = useEditorHandoff();

  /*
   * Jméno kampaně si drží pruh, ne jen stránka pod ním. Přejmenovává se
   * v hlavičce a totéž jméno nesou drobečky nad ní i předvyplněný název nové
   * šablony; kdyby se četlo z propu, zůstala by po přejmenování polovina
   * obrazovky u starého jména až do přenačtení stránky.
   */
  const [name, setName] = useState(campaignName);
  const [panel, setPanel] = useState<'none' | 'save'>('none');
  const [saveName, setSaveName] = useState(campaignName);
  /** Šablona, na kterou uživatel klikl v nabídce. Drží se kvůli potvrzení. */
  const [chosen, setChosen] = useState<LibraryTemplate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taking, setTaking] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const busy = saving || taking;

  /* Nabídka šablon. Stav si drží pruh, protože na otevření navazuje fokus. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchable = templates.length >= SEARCH_FROM;
  const found = useMemo(() => {
    const needle = fold(query.trim());
    if (needle === '') return templates;
    return templates.filter((template) => fold(template.name).includes(needle));
  }, [templates, query]);

  /*
   * Fokus patří do hledacího pole, jinak je pole z klávesnice NEDOSAŽITELNÉ.
   *
   * Radix nabídka si po otevření bere fokus na sebe a tabulátor ji zavírá, jak
   * má nabídka podle vzoru dělat. Pole uvnitř by se tím pádem nedalo zaostřit
   * jinak než myší. Zaostřuje se proto až v dalším snímku, tedy po tom, co si
   * fokus vezme Radix; kdo pole nechce, jede dál šipkami do seznamu.
   */
  useEffect(() => {
    if (!libraryOpen || !searchable) return undefined;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [libraryOpen, searchable]);

  /*
   * Převzetí šablony PŘEPÍŠE dokument, který je zrovna otevřený v editoru.
   *
   * Pořadí je proto závazné: dopsat rozdělané změny, přepsat pracovní kopii
   * a načíst stránku znovu. Bez `flush()` na začátku by automatické ukládání
   * po přepisu odeslalo zpátky ten starý dokument, který má editor ve stavu,
   * a převzatý obsah by zase zmizel. Bez `reload()` na konci by uživatel dál
   * upravoval starý dokument a neviděl, co si právě převzal.
   *
   * Šablona se předává v parametru, ne přes stav: nabídka se klikem zavírá
   * a potvrzení běží až po překreslení, takže by se sahalo na hodnotu, kterou
   * mezitím mohl přepsat další klik.
   */
  function useLibrary(template: LibraryTemplate) {
    setConfirming(false);
    setTaking(true);
    void (async () => {
      try {
        await handoff.flush();
        const result = await useLibraryTemplateAction({
          workspaceId,
          campaignId,
          workingCopyId,
          templateId: template.id,
        });
        if (result.status === 'error') {
          setOutcome({ tone: 'error', text: tContent('loadFailed') });
          return;
        }
        window.location.reload();
      } finally {
        setTaking(false);
      }
    })();
  }

  /**
   * Klik na šablonu v nabídce. Ptá se `hasDesign`, ne na to, jestli v dokumentu
   * něco je: přepisuje se DOKUMENT a přijít se dá i o rozdělanou práci, ve které
   * zatím nic není. Kampaň bez dokumentu nemá co přepsat, tam se nezdržuje.
   */
  function chooseTemplate(template: LibraryTemplate) {
    if (busy) return;
    setChosen(template);
    if (hasDesign) setConfirming(true);
    else useLibrary(template);
  }

  /**
   * Klávesnice v hledacím poli. Dvě věci, obě naměřené v prohlížeči.
   *
   * 1. PÍSMENA PATŘÍ DO POLE. Radix nabídka bere psaní jako skok na položku
   *    podle počátečního písmene, takže by se text do pole nedostal a seznam
   *    by pod rukama poskakoval.
   * 2. ŠIPKA DOLŮ MUSÍ DO SEZNAMU RUČNĚ. Radix zaostří první položku jen tehdy,
   *    když šipka přijde z nabídky samotné (`event.target !== content` a končí).
   *    Z pole tedy nedělala nic a seznam byl z klávesnice nedosažitelný:
   *    tabulátor nabídku zavírá, takže jiná cesta k položkám nezbývala.
   */
  function handleSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key.length === 1 || event.key === 'Home' || event.key === 'End') {
      event.stopPropagation();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = event.currentTarget
      .closest('[role="menu"]')
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    const target = event.key === 'ArrowDown' ? items?.[0] : items?.[items.length - 1];
    if (target === undefined) return;
    event.preventDefault();
    target.focus();
  }

  /** Uložení do knihovny je VÝSLOVNÁ akce, nikdy vedlejší účinek psaní kampaně. */
  function saveAsTemplate() {
    setSaving(true);
    void (async () => {
      try {
        // I tady se nejdřív dopisuje: do knihovny má jít to, co je na obrazovce,
        // ne poslední automaticky uložená verze.
        await handoff.flush();
        const result = await saveCampaignContentAsTemplateAction({
          workspaceId,
          workingCopyId,
          name: saveName,
        });
        if (result.status === 'success') {
          setPanel('none');
          setOutcome({ tone: 'success', text: tContent('savedAsTemplate') });
          return;
        }
        setOutcome({
          tone: 'error',
          text:
            result.code === 'template_name_conflict'
              ? tContent('saveAsTemplateNameTaken')
              : tContent('saveAsTemplateFailed'),
        });
      } finally {
        setSaving(false);
      }
    })();
  }

  function goToStep(step: CampaignStep) {
    handoff.leave(campaignStepHref(basePath, campaignId, step));
  }

  return (
    <div className="flex flex-col border-b border-border px-[var(--spacing-gutter)] py-[var(--spacing-stack)]">
      {/*
        Hlavička kampaně i v editoru: drobečky zpátky na seznam, číslo kroku
        a jméno kampaně. Bez ní je editor obrazovka bez názvu a uživatel neví,
        kterou kampaň zrovna píše. Spodní mezeru si píše sama, proto obal
        mezeru nemá a zbytek pruhu ji má ve vlastním sloupci.
      */}
      <PageHeader
        title={
          <CampaignNameField
            name={name}
            canRename={canRename}
            onRename={async (next) => {
              const result = await renameCampaignAction({
                workspaceId,
                campaignId,
                name: next,
              });
              if (result.status === 'success') setName(next);
              return result;
            }}
          />
        }
        eyebrow={
          <span role="status" aria-live="polite">
            {tNew('stepOf', { current: 1, total: CAMPAIGN_STEPS.length })}
          </span>
        }
        breadcrumbs={<CampaignBreadcrumbs basePath={basePath} campaignName={name} />}
        {...(readOnly
          ? {}
          : {
              actions: (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="save-as-template"
                    onClick={() => {
                      setSaveName(name);
                      setPanel(panel === 'save' ? 'none' : 'save');
                    }}
                  >
                    <Save aria-hidden className="icon-sm" />
                    {tContent('saveAsTemplate')}
                  </Button>
                  {/*
                    Nabídka šablon visí PŘÍMO NA TLAČÍTKU.
                    Dřív se tímhle tlačítkem rozbalil pruh pod hlavičkou, v něm
                    bylo rozbalovací pole a vedle něj druhé tlačítko „Převzít
                    obsah": čtyři kliknutí a dvě různá místa na obrazovce, než
                    se něco stalo. Nabídka je jedno kliknutí navíc oproti výběru
                    a klik na šablonu je rovnou tou volbou.
                  */}
                  <DropdownMenu
                    open={libraryOpen}
                    onOpenChange={(open) => {
                      setLibraryOpen(open);
                      // Zavřená nabídka zahazuje hledaný text. Otevřít ji podruhé
                      // a najít v ní seznam zúžený minulým hledáním vypadá, jako
                      // že šablony zmizely.
                      if (!open) setQuery('');
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="use-library-open"
                        pending={taking}
                        pendingLabel={tContent('loading')}
                      >
                        <Copy aria-hidden className="icon-sm" />
                        {tContent('useLibraryTitle')}
                      </Button>
                    </DropdownMenuTrigger>
                    {/*
                      Výška nabídky se řídí místem, které pod tlačítkem zbývá
                      (proměnnou dodává Radix), takže se dlouhý seznam skroluje
                      uvnitř a nepřeteče přes spodní hranu okna.
                    */}
                    <DropdownMenuContent
                      align="end"
                      className="max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[var(--size-text-column)] overflow-y-auto"
                    >
                      {/*
                        Hledání se ukazuje AŽ OD DVANÁCTI ŠABLON, viz `SEARCH_FROM`.
                        Filtruje se to, co už je na stránce; server se znovu neptá,
                        takže psaní nemá prodlevu a nabídka nemůže zůstat viset.
                      */}
                      {searchable ? (
                        <div role="presentation" className="p-1">
                          <div className="relative">
                            <Search
                              aria-hidden
                              className="icon-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
                            />
                            {/* Do hledání v knihovně nepatří uložené heslo.
                                Nabídka správce hesel by zakryla první nalezené
                                šablony. Podrobnosti
                                v `@mlain/ui/lib/password-manager`. */}
                            <Input
                              ref={searchRef}
                              autoComplete="off"
                              {...passwordManagerOptOut}
                              value={query}
                              onChange={(event) => setQuery(event.target.value)}
                              aria-label={tContent('useLibrarySearch')}
                              placeholder={tContent('useLibrarySearch')}
                              className="pl-10"
                              onKeyDown={handleSearchKey}
                            />
                          </div>
                        </div>
                      ) : null}

                      {templates.length === 0 ? (
                        <p
                          role="presentation"
                          className="px-3 py-[var(--spacing-inline)] text-sm text-text-muted"
                        >
                          {tContent('libraryEmpty')}
                        </p>
                      ) : found.length === 0 ? (
                        <p
                          role="presentation"
                          className="px-3 py-[var(--spacing-inline)] text-sm text-text-muted"
                        >
                          {tContent('useLibrarySearchEmpty')}
                        </p>
                      ) : (
                        found.map((template) => (
                          <DropdownMenuItem
                            key={template.id}
                            onSelect={() => chooseTemplate(template)}
                          >
                            {template.name}
                          </DropdownMenuItem>
                        ))
                      )}

                      {/*
                        Patička nabídky. Jedna linka nad oběma větami, ne nad
                        každou zvlášť: dvě hairline linky pár pixelů od sebe
                        vypadají jako vada vykreslení.
                      */}
                      <div
                        role="presentation"
                        className="mt-1 flex max-w-[40ch] flex-col gap-[var(--spacing-hairline)] border-t border-border px-3 pt-[var(--spacing-inline)] pb-[var(--spacing-hairline)] text-meta text-text-muted"
                      >
                        {/*
                          Stovka je strop cesty, ne konec knihovny. Bez téhle věty
                          je uříznutý seznam k nerozeznání od úplného a uživatel
                          hledá šablonu, která v nabídce prostě není.
                        */}
                        {templatesTruncated ? (
                          <p>{tContent('useLibraryTruncated', { count: templates.length })}</p>
                        ) : null}
                        {/*
                          Věta o tom, že se ze šablony jen kopíruje, zůstává vidět
                          v okamžiku výběru. U kampaně bez obsahu se potvrzení
                          neptá, takže jinde by ji uživatel neviděl vůbec.
                        */}
                        <p>{tContent('useLibraryHint')}</p>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ),
            })}
      />

      <div className="flex flex-col gap-[var(--spacing-stack)]">
        {/*
        Pás kroků patří i do editoru, jinak uživatel neví, kde v kampani je,
        a na další krok se dostane jen tlačítkem „Pokračovat" v hlavičce.
        Krok obsahu je tenhle, takže `onSelect` nemá co dělat; ostatní kroky
        jsou jiná adresa a odchází se na ně přes uložení a převzetí obsahu.
      */}
        <CampaignStepNav current="content" onSelect={goToStep} disabled={handoff.busy || busy} />

        <p className="max-w-[90ch] text-meta text-text-muted">{t('steps.contentIntro')}</p>

        {outcome !== null && (
          <Alert tone={outcome.tone} data-testid="content-outcome">
            {outcome.text}
          </Alert>
        )}

        {panel === 'save' && (
          <Card tone="muted" padding="sm">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="save-as-template-name">{tContent('saveAsTemplateName')}</Label>
              <Input
                id="save-as-template-name"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                maxLength={120}
              />
              <p className="text-meta text-text-muted">{tContent('saveAsTemplateHint')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
              <Button
                variant="primary"
                data-testid="save-as-template-submit"
                pending={saving}
                pendingLabel={tContent('saving')}
                onClick={saveAsTemplate}
              >
                {tContent('saveAsTemplateSubmit')}
              </Button>
              <Button variant="ghost" onClick={() => setPanel('none')}>
                {tContent('saveAsTemplateCancel')}
              </Button>
            </div>
          </Card>
        )}

        {/*
          Potvrzení pojmenovává šablonu, ze které se bere. Nabídka se klikem
          zavřela, takže bez toho by v dialogu nikde nestálo, co vlastně
          uživatel vybral, a „Přepsat obsah" by se odklikávalo poslepu.
        */}
        <ConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            setConfirming(open);
            // Zamítnuté potvrzení nesmí nechat viset vybranou šablonu:
            // obsah kampaně zůstává, jak byl, a výběr začíná znovu od nabídky.
            if (!open) setChosen(null);
          }}
          level="N2"
          // Rozepsaný obsah kampaně se přepíše šablonou a zpátky ho nic nevrátí.
          destructive
          irreversible
          title={tContent('confirmTitle')}
          consequences={[
            tContent('confirmFromTemplate', { name: chosen?.name ?? '' }),
            tContent('confirmOverwrite'),
            tContent('confirmTemplateStays'),
          ]}
          confirmLabel={tContent('confirmSubmit')}
          cancelLabel={tContent('confirmCancel')}
          onConfirm={() => {
            if (chosen !== null) useLibrary(chosen);
          }}
          labels={labels}
        />
      </div>
    </div>
  );
}
