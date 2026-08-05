'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import type { EditorDocument, EditorIssue } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { referencedAssetIds, validateDocumentClient } from '../../model/validate-client';
import type { EditorPorts } from '../../ports/types';
import type { EditorStore } from '../../state/editor-store';

/**
 * DO EDITORU SE PUSTÍ JEN CHYBY, VAROVÁNÍ NE.
 *
 * Rozhodnutí zadavatele: „Chyby tam nech, ale upozornění nechci zobrazovat
 * žádné." Věty jako „Text na tomhle pozadí je špatně čitelný." se objevovaly
 * u obsahu, který uživatel schválně chtěl, nešly odbýt a pruh nad plátnem
 * hlásil „žádná chyba, 3 varování", tedy tři řádky, se kterými se nedalo nic
 * udělat. Chyby zůstávají, protože ty brání odeslání a je na nich co opravit.
 *
 * PRAVIDLA V JÁDŘE SE NEMĚNÍ. `checkSemantics` v `@mlain/emails` počítá
 * varování dál a předodesílací kontrola je používá; tohle je rozhodnutí
 * o zobrazení v editoru, ne o pravidlech. Kdyby se pravidla smazala, přijde
 * projekt o možnost ukázat je někde, kde dávají smysl.
 *
 * Filtruje se TADY, na vstupu do stavu, aby se varování ani neukládala a ani
 * nepočítala. Pruh s nálezy má pojistku ještě u sebe: jde vykreslit i s ručně
 * dodanými nálezy, což jeho vlastní testy dělají, a bez ní by v takovém
 * vykreslení varování ukázal.
 */
function errorsOnly(issues: readonly EditorIssue[]): EditorIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

/** Totožnost nálezu pro slučování: týž kód na témže místě je týž nález. */
function identity(issue: EditorIssue): string {
  return `${issue.code}@${issue.pointer ?? issue.blockId ?? ''}`;
}

type Source = { issues: EditorIssue[]; document: EditorDocument | null };

/**
 * Validace běží v prohlížeči, protože musí odpovědět do 20 ms na každý úhoz.
 * Server ji opakuje při uložení, protože klientovi se nevěří (část 3, 3.7.5),
 * a jeho odpověď má přednost: nese kódy, které klient nemá jak zjistit,
 * a hotový `detail` u neznámého kódu (kritérium 76).
 *
 * DVA ZDROJE, KTERÉ SE SLUČUJÍ, NE PŘEPISUJÍ. Tohle je jádro celého souboru
 * a vzniklo z vady, která vypadala úplně jinak, než byla.
 *
 * Odběr níž se ozývá na KAŽDOU změnu stavu, ne jen na úpravu dokumentu,
 * a `store.setIssues` je taky změna stavu. Odpověď `POST /validate` se tedy
 * zapsala do stavu, tím probudila odběr, ten přepočítal klientskou validaci
 * a serverové nálezy rovnou přepsal. Šlo o jednotky milisekund, takže
 * předodesílací kódy nikdo nikdy neviděl, i když je server poslal.
 *
 * Hlášené to bylo jako „panel počítá chybu mezi varování": `/validate` vrátilo
 * tři nálezy, mezi nimi `precheck_app_url_not_public` se závažností `error`,
 * a panel přesto psal „žádná chyba, 3 varování". Závažnost se přitom nikde
 * neztrácela. Ta tři varování byla z klientské validace nad týmž dokumentem
 * a serverová odpověď včetně chyby byla v tu chvíli dávno přepsaná.
 *
 * Nově tedy platí:
 *
 * - klientské nálezy se přepočítají při každé změně DOKUMENTU,
 * - serverové si držíme stranou a přežijí libovolný počet úprav,
 * - po úpravě dokumentu se serverové označí za zastaralé (`stale`), protože
 *   můžou mluvit o obsahu, který mezitím někdo opravil,
 * - další běh serverové validace je celé nahradí a příznak zmizí,
 * - když oba zdroje hlásí týž nález na témže místě, vyhrává čerstvější,
 *   tedy klientský.
 */
export function useValidation(input: {
  store: EditorStore;
  ports: EditorPorts;
  templateId: string;
  fieldCatalog: FieldCatalog;
  /**
   * Profil kontroly dokumentu. POVINNÝ, ne s výchozí hodnotou.
   *
   * Dřív se sem nepředával vůbec a `validateDocumentClient` padalo na výchozí
   * `campaign`. U transakční šablony to znamenalo, že editor hlásil chybu nad
   * obsahem, který server přijme: proměnná v odkazu tlačítka je v transakčním
   * profilu normální stav, kdežto v kampaňovém je to `liquid_in_trackable_href`.
   * Uživatel tak nemohl uložit reset hesla, což je hlavní důvod, proč transakční
   * šablony existují.
   */
  templateKind: ValidationProfile;
}) {
  const { fieldCatalog, store, templateKind } = input;

  /** Poslední nálezy ze serveru a dokument, o kterém platily. */
  const server = useRef<Source>({ issues: [], document: null });
  /** Poslední nálezy klientské validace a dokument, nad kterým běžela. */
  const client = useRef<Source>({ issues: [], document: null });

  /**
   * Sloučí oba zdroje a zapíše je do stavu.
   *
   * Zápis proběhne JEN při skutečné změně. `setIssues` je změna stavu, ta
   * probudí odběr a ten volá tuhle funkci znovu; bez porovnání by z toho byla
   * nekonečná smyčka, ne jen zbytečné vykreslení.
   */
  const publish = useCallback(() => {
    const state = store.getState();
    const fresh = client.current.issues;
    const seen = new Set(fresh.map(identity));
    const stale = server.current.document !== null && server.current.document !== state.document;
    const carried = server.current.issues
      .filter((issue) => !seen.has(identity(issue)))
      .map((issue) => (stale ? { ...issue, stale: true } : issue));
    const next = [...fresh, ...carried];
    // Porovnání přes JSON je tady levnější než hloubkové: nálezů jsou jednotky.
    if (JSON.stringify(next) !== JSON.stringify(state.issues)) store.setIssues(next);
  }, [store]);

  const runServerValidation = useCallback(async () => {
    // Dokument SE ČTE PŘED požadavkem, ne po něm: než odpověď dojde, může
    // uživatel psát dál a nálezy by se přiřadily k verzi, o které nejsou.
    const document = store.getState().document;
    try {
      const result = await input.ports.validate({ templateId: input.templateId });
      server.current = {
        issues: errorsOnly(
          result.findings.map((finding) => ({
            code: finding.code,
            severity: finding.severity,
            message: finding.message,
            ...(finding.pointer ? { pointer: finding.pointer } : {}),
            ...(finding.block_id ? { blockId: finding.block_id } : {}),
            ...(finding.params ? { params: finding.params } : {}),
          })),
        ),
        document,
      };
      publish();
    } catch {
      /* stav se nemění, výpadek spojení hlásí pruh stavu ukládání */
    }
  }, [input.ports, input.templateId, publish, store]);

  useEffect(() => {
    const recompute = () => {
      const state = store.getState();
      // Změna stavu, která se dokumentu netýká (ukládání, výběr bloku, zápis
      // nálezů), nemá klientské validaci co změnit; přepočet by vyšel stejně.
      if (state.document !== client.current.document) {
        client.current = {
          issues: errorsOnly(
            validateDocumentClient(state.document, fieldCatalog, {
              assetIds: referencedAssetIds(state.document),
              templateKind,
            }),
          ),
          document: state.document,
        };
      }
      publish();
    };
    recompute();
    return store.subscribe(recompute);
  }, [fieldCatalog, publish, store, templateKind]);

  /** První běh serverové validace hned po otevření editoru. */
  useEffect(() => {
    void runServerValidation();
  }, [runServerValidation]);

  /**
   * Další běh po každém ULOŽENÍ.
   *
   * Bez něj by zastaralý serverový nález zůstal zastaralý napořád a uživatel
   * by neměl jak zjistit, jestli ho svou opravou vyřešil. Uložení je jediný
   * okamžik, kdy má smysl se ptát znovu: server kontroluje ULOŽENOU verzi,
   * takže dřív by odpovídal o dokumentu, který ještě nemá.
   */
  useEffect(() => {
    let last = store.getState().savedAt;
    return store.subscribe(() => {
      const savedAt = store.getState().savedAt;
      if (savedAt === last) return;
      last = savedAt;
      void runServerValidation();
    });
  }, [runServerValidation, store]);
}
