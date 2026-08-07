'use client';

import { useState } from 'react';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Trash2 } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';

/**
 * HROMADNÉ ODSTRANĚNÍ ŘÁDKŮ, jedno pro všechny obrazovky, které ho mají.
 *
 * VZNIKLO Z NÁLEZU „výběr nikam nevede". `DataTable` kreslí zaškrtávátka VŽDYCKY
 * a vypnout se nedají, takže je měla i obrazovka, která nad výběrem neuměla nic:
 * pruh nabízel jedině „Vybrat všech N" a „Zrušit výběr". Doslova od zadavatele
 * o kampaních: „Multivýběr. Nemůžu s nimi nic dělat."
 *
 * PROČ SPOLEČNÁ KOMPONENTA A NE PĚT KOPIÍ. Není to jen tvar tlačítka. Jsou to čtyři
 * pravidla, která se v pěti kopiích rozejdou a pokaždé se to pozná až v provozu:
 *
 *  1. Číslo nese už TLAČÍTKO („Smazat 3 štítky"), ne až okno, protože výběr může
 *     obsahovat řádky, které odstranit nejde.
 *  2. Když ve výběru není ani jeden odstranitelný řádek, stojí tu VĚTA, proč, ne
 *     zašedlé tlačítko (zašedlá akce bez vysvětlení je zakázaná, kritérium 18).
 *  3. Okno se po nezdaru NEZAVÍRÁ a řekne, kolik řádků zůstalo. Tichý částečný
 *     úspěch, tedy „označím dvanáct, zmizí pět a nikdo neřekne proč", je ta
 *     nejhorší možná varianta a tohle je jediné místo, kde se tomu dá zabránit.
 *  4. Výběr se ruší JEN po úspěchu, a to volající, ne tahle komponenta.
 *
 * Znění dodává obrazovka. Věty o následku jsou u každé domény jiné (u seznamu jde
 * o přihlášené kontakty, u pole o hodnoty na kontaktech) a společný text by byl
 * buď nepřesný, nebo tak obecný, že by nic neřekl.
 */
export type BulkRemovalLabels = {
  /** Popisek tlačítka na pruhu. Vždycky s počtem, tedy „Smazat 3 štítky". */
  action: string;
  /** Věta místo tlačítka, když ve výběru není co odstranit. */
  nothing: string;
  /** Nadpis okna, také s počtem. */
  title: string;
  /** Věty o následku, jedna za odstavec. První je hlavní, zbytek tlumený. */
  explanation: string[];
  /** Co se stane s řádky, které odstranit nejde. Vynechá se, když takové nejsou. */
  skipped?: string | undefined;
  submit: string;
  submitting: string;
  cancel: string;
  /** Hláška o nezdaru, už složená i s počtem a s detailem od serveru. */
  failed: (input: { failed: number; detail: string | null }) => string;
};

/**
 * Odstraní řádky po jednom a posbírá nezdary.
 *
 * PO JEDNOM, PROTOŽE HROMADNÝ ENDPOINT V API NENÍ ani u jedné z těchhle domén.
 * U seznamů, štítků, formulářů ani výjimek v oslovení nejde o statisíce řádků jako
 * u kontaktů, takže cyklus stačí; kontakty mají kvůli objemu vlastní úlohu na pozadí.
 *
 * NEZASTAVUJE SE NA PRVNÍ CHYBĚ. Zastavit se v půlce by nechalo výběr ve stavu, který
 * uživatel nemá jak přečíst: část řádků pryč, část ne a žádné pravidlo v tom.
 */
export async function runBulkRemoval<Id>(
  ids: Id[],
  run: (id: Id) => Promise<{ status: 'success' } | { status: 'error'; code: string }>,
): Promise<{ failedIds: Id[]; detail: string | null }> {
  const failedIds: Id[] = [];
  let detail: string | null = null;
  for (const id of ids) {
    const result = await run(id);
    if (result.status === 'error') {
      failedIds.push(id);
      detail ??= result.code;
    }
  }
  return { failedIds, detail };
}

export function BulkRemovalAction({
  labels,
  removable,
  testId,
  onConfirm,
}: {
  labels: BulkRemovalLabels;
  /** Kolik označených řádků se doopravdy odstraní. Nula znamená větu místo tlačítka. */
  removable: number;
  /**
   * Předpona značek pro testy, například `tags-bulk`. Vzniknou z ní `tags-bulk-delete`,
   * `tags-bulk-nothing`, `tags-bulk-submit` a `tags-bulk-error`.
   */
  testId: string;
  /** Vrací počet řádků, které se odstranit nepodařily, a detail od serveru. */
  onConfirm: () => Promise<{ failed: number; detail: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setFailure(null);
    setPending(true);
    try {
      const result = await onConfirm();
      if (result.failed > 0) {
        setFailure(labels.failed(result));
        return;
      }
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  if (removable === 0) {
    return (
      // Pruh výběru je tmavý panel, takže text na něm je z panelové řady barev.
      <span data-testid={`${testId}-nothing`} className="text-panel-soft">
        {labels.nothing}
      </span>
    );
  }

  return (
    <>
      {/* Mazání si plnou barvu nechává: na tmavém pruhu je to akce s následkem,
          který nejde vzít zpět, a nesmí splynout s ostatními. */}
      <Button
        variant="destructive"
        size="sm"
        className="text-sm shadow-none hover:translate-y-0 hover:shadow-none"
        data-testid={`${testId}-delete`}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden className="icon-sm" />
        {labels.action}
      </Button>

      {/* `destructive` znamená, že okno nejde zavřít kliknutím mimo. */}
      <Dialog open={open} onOpenChange={setOpen} destructive>
        <DialogTitle>{labels.title}</DialogTitle>
        <DialogBody>
          {labels.explanation.map((line, index) => (
            <p key={line} className={index === 0 ? undefined : 'text-text-muted'}>
              {line}
            </p>
          ))}

          {/* Přeskočené řádky nejsou chyba, jen důsledek stavu, proto tón `info`.
              Vidět ale být musí: je to jediné místo, kde se uživatel dozví, proč
              se z dvanácti označených odstraní pět. */}
          {labels.skipped !== undefined && (
            <Alert tone="info" data-testid={`${testId}-skipped`}>
              {labels.skipped}
            </Alert>
          )}

          {failure !== null && (
            <Alert tone="error" data-testid={`${testId}-error`}>
              {failure}
            </Alert>
          )}
        </DialogBody>

        <DialogFooter
          retreat={
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {labels.cancel}
            </Button>
          }
          confirm={
            <Button
              variant="destructive"
              data-testid={`${testId}-submit`}
              pending={pending}
              pendingLabel={labels.submitting}
              onClick={() => void confirm()}
            >
              {labels.submit}
            </Button>
          }
        />
      </Dialog>
    </>
  );
}
