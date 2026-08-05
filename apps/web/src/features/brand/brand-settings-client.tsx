'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
/*
 * `next/navigation`, ne `@mlain/i18n/navigation`. Obal next-intl řeší jazyk
 * v CESTĚ, a `refresh()` žádnou cestu nemá: jen si vyžádá nové vykreslení
 * serverové části té současné. Naměřeno 4. 8. 2026: s obalem odešel prohlížeč
 * po doběhnutí extrakce z `/settings/brand` na přehled projektu, takže uživatel
 * výsledek nikdy neuviděl.
 */
import { useRouter } from 'next/navigation';
import type { ActionState } from '@/lib/feedback/action-result';
import { BrandForm, type BrandFormValues } from './brand-form';
import { BrandHistory, type BrandExtractionView } from './brand-history';
import { ExtractionForm, SERVER_ERROR_CODE, type ExtractionFormState } from './extraction-form';
import { useExtractionPoll } from './use-extraction-poll';

/** Kódy, které vydává doména značky. Cokoli jiného je chyba na naší straně. */
const KNOWN_BRAND_ERROR = /^(brand_|rate_limited$|logo_not_found$)/;

export type BrandSettingsClientProps = {
  workspaceId: string;
  workspaceSlug: string;
  /**
   * Historie STAŽENÍ, ne seznam značek. Značku má projekt jednu a každé
   * stažení ji přepíše; tenhle seznam říká, kdy jsme co odkud vytáhli.
   */
  history: readonly BrandExtractionView[];
  /** Výchozí hodnoty formuláře, složené na serveru včetně adresy loga. */
  initial: BrandFormValues;
  saveAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
};

type StartState =
  | { kind: 'idle' }
  | { kind: 'started'; id: string; url: string }
  | { kind: 'error'; code: string; url: string; status?: number };

/**
 * Obrazovka Nastavení → Značka projektu.
 *
 * POŘADÍ SEKCÍ JE ZÁMĚRNÉ. Nahoře je ruční definice značky, tedy jediná cesta,
 * která funguje vždycky a nezávisí na tom, jestli má projekt web nebo klíč k AI.
 * Stažení z webu je pod ní jako zkratka, ne jako hlavní vchod. Dřív to bylo
 * naopak a obrazovka tím tvrdila, že bez webu se značka nastavit nedá; přitom
 * do e-mailu jde pět barev, logo a dvě písma, a ty se dají vyplnit ručně
 * za minutu.
 *
 * Stav rozpracované extrakce zůstává klientský, protože se dotazuje po 1000 ms
 * (rozhodnutí D4).
 */
export function BrandSettingsClient({
  workspaceId,
  workspaceSlug,
  history,
  initial,
  saveAction,
}: BrandSettingsClientProps) {
  const router = useRouter();
  const [start, setStart] = useState<StartState>({ kind: 'idle' });
  const { snapshot, elapsedMs, timedOut } = useExtractionPoll(
    start.kind === 'started' ? start.id : null,
    workspaceId,
  );

  const submit = useCallback(
    async (url: string) => {
      setStart({ kind: 'idle' });
      try {
        const response = await fetch('/api/v1/brand/extractions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-workspace-id': workspaceId,
            accept: 'application/json',
          },
          body: JSON.stringify({ url }),
        });
        const payload = (await response.json().catch(() => null)) as {
          id?: string;
          code?: string;
        } | null;
        if (response.ok && typeof payload?.id === 'string') {
          setStart({ kind: 'started', id: payload.id, url });
          return;
        }
        /*
         * TŘI TŘÍDY SELHÁNÍ, ne jedna.
         *
         * 1. Chyba u nás: odpověď nenese kód domény značky (`brand_*`,
         *    `rate_limited`, `logo_not_found`). Pak se na cizí web nikdo
         *    neptal a hláška o překlepu v adrese by lhala. Ukáže se stav
         *    odpovědi, ať jde nahlásit.
         * 2. Web nedostupný nebo pomalý: `brand_dns_failed`, `brand_fetch_failed`,
         *    `brand_timeout` a spol.
         * 3. Web dostupný, ale bez použitelného obsahu:
         *    `brand_unexpected_content_type`, `logo_not_found`,
         *    `brand_robots_disallowed`.
         *
         * Druhou a třetí rozlišuje `ERROR_KEYS` v `extraction-form.tsx`,
         * první se pozná právě tady: jen tady je po ruce stav odpovědi.
         */
        const code = payload?.code;
        if (typeof code === 'string' && KNOWN_BRAND_ERROR.test(code)) {
          setStart({ kind: 'error', code, url });
          return;
        }
        setStart({ kind: 'error', code: SERVER_ERROR_CODE, url, status: response.status });
      } catch {
        // Požadavek se vůbec neodeslal (offline, přerušené spojení). Cizí web
        // v tom nefiguruje, takže je to zase chyba na naší straně, jen bez stavu.
        setStart({ kind: 'error', code: SERVER_ERROR_CODE, url, status: 0 });
      }
    },
    [workspaceId],
  );

  const state: ExtractionFormState = useMemo(() => {
    if (start.kind === 'error') {
      return {
        phase: 'error',
        code: start.code,
        url: start.url,
        ...(start.status === undefined ? {} : { status: start.status }),
      };
    }
    if (start.kind === 'idle') return { phase: 'idle' };
    if (timedOut) return { phase: 'error', code: 'brand_timeout', url: start.url };
    if (snapshot === null || snapshot.status === 'pending' || snapshot.status === 'running') {
      return { phase: 'running', elapsedMs };
    }
    if (snapshot.status === 'succeeded') {
      return { phase: 'done', warnings: snapshot.result?.warnings ?? [] };
    }
    return {
      phase: 'error',
      code: snapshot.error_code ?? 'brand_fetch_failed',
      url: start.url,
      host: hostOf(start.url),
    };
  }, [elapsedMs, snapshot, start, timedOut]);

  /*
   * Po doběhnutí extrakce se přenačtou serverová data.
   *
   * Formulář nahoře dostal výchozí hodnoty při vykreslení stránky, takže bez
   * tohohle by uživatel četl „Hotovo. Zkontrolujte, jestli to sedí." nad
   * formulářem, který pořád ukazuje STARÉ barvy, a kontroloval by něco jiného,
   * než co se stáhlo. `router.refresh()` znovu vykreslí serverovou část,
   * klientský stav rozpracovaného běhu zůstane.
   */
  useEffect(() => {
    if (snapshot?.status === 'succeeded') router.refresh();
  }, [router, snapshot?.status]);

  return (
    <div className="flex flex-col gap-10">
      {/*
        `key` z hodnot ze serveru je záměr, ne berlička. `BrandForm` si drží
        rozepsané hodnoty ve svém stavu, jehož inicializátor proběhne jen při
        prvním připojení, takže by po `router.refresh()` zůstaly ve formuláři
        staré barvy, přestože je server poslal nové. Změna klíče formulář
        připojí znovu s čerstvými hodnotami. Během psaní se `initial` nemění,
        takže se nic nepřipojuje zbytečně.
      */}
      <BrandForm
        key={JSON.stringify(initial)}
        action={saveAction}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        initial={initial}
      />

      <ExtractionForm state={state} onSubmit={(url) => void submit(url)} />

      <BrandHistory runs={history} />
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
