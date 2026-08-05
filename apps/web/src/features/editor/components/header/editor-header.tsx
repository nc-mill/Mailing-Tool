'use client';

import { Button } from '@mlain/ui/components/button';
import { useTranslations } from 'next-intl';
import type { EditorPorts } from '../../ports/types';
import { useEditorState } from '../../state/use-editor';
import { SaveStatus } from './save-status';
import { TemplateName, type RenameResult } from './template-name';
import { ViewControls } from './view-controls';

/**
 * Hlavička editoru.
 *
 * Kromě ukládání tu bydlí i OVLADAČE ZOBRAZENÍ (zařízení, tmavý režim, čí data
 * se dosazují). Nejsou to ovladače náhledu, i když odtud pocházejí: řídí plátno,
 * takže patří k úpravám, ne až za tlačítko „Náhled". Uživatel to řekl přesně
 * takhle: chce je „v části, kde jsou úpravy, někde v oblasti, kde je Uloženo
 * v 10:18".
 */
export function EditorHeader(props: {
  mode: 'edit' | 'preview';
  onMode: (mode: 'edit' | 'preview') => void;
  onTestSend: () => void;
  onSave: () => void;
  readOnly: boolean;
  ports?: EditorPorts | undefined;
  /** Cesta zpátky do kampaně, ze které se sem uživatel proklikl. */
  returnTo?: { href: string; label: string; campaignId?: string | undefined } | undefined;
  onReturn?: (() => void) | undefined;
  /** Obsah kampaně se v hlavičce jmenuje obsahem kampaně, ne šablonou. */
  contentKind?: 'template' | 'campaign' | undefined;
  /**
   * Název šablony k úpravě. Nepovinný SCHVÁLNĚ: pole se ukáže jen tam, kde
   * přejmenování něco znamená, tedy u šablony, kterou uživatel vidí v knihovně.
   * Kdo prop nepošle, dostane hlavičku beze změny. Důvod je u `templateName`
   * ve skořápce editoru.
   */
  templateName?: string | undefined;
  onRename?: ((name: string) => Promise<RenameResult>) | undefined;
}) {
  const t = useTranslations('editor');
  const isDirty = useEditorState((state) => state.isDirty);
  const status = useEditorState((state) => state.status);

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        {/*
          Obsah kampaně NENÍ obecná šablona, i když leží ve stejné tabulce.
          Uživatel, který se sem proklikl z kampaně, musí vidět, že upravuje
          e-mail té jedné kampaně; jinak se právem bojí, že mění vzor pro
          všechny ostatní.
        */}
        {props.contentKind === 'campaign' ? (
          <span
            data-testid="content-kind"
            className="rounded-[var(--radius-control)] bg-accent-surface px-2 py-0.5 text-xs font-medium text-accent-text"
          >
            {t('header.campaignContent')}
          </span>
        ) : null}
        {/*
          Název stojí PŘED stavem ukládání, tedy na místě, kde se čte titulek.
          Uživatel ho hledá jako první věc v hlavičce, ne mezi ovladači.
        */}
        {props.templateName !== undefined && props.onRename ? (
          <TemplateName
            name={props.templateName}
            onRename={props.onRename}
            readOnly={props.readOnly}
          />
        ) : null}
        <SaveStatus />
        <ViewControls ports={props.ports} />
      </div>
      <div className="flex gap-2">
        {/*
          NÁVRAT DO KAMPANĚ. Editor sám o kampaních nic neví a vědět nemá:
          dostane jen adresu, kam se po uložení vrátit, a popisek tlačítka.
          Bez toho končí cesta „kampaň → obsah → editor" ve slepé uličce
          a uživatel se do kampaně proklikává navigací.
        */}
        {props.returnTo && props.onReturn ? (
          /*
            PRIMÁRNÍ akce, když editor stojí uvnitř kampaně. Editor je tam
            prvním krokem, takže nejdůležitější tlačítko na obrazovce je to,
            které pokračuje na krok další; testovací odeslání je vedlejší
            odbočka a primární barvu si bere jen tam, kde se upravuje samostatná
            šablona a žádné „dál" neexistuje.
          */
          <Button variant="primary" onClick={props.onReturn} data-testid="editor-return">
            {props.returnTo.label}
          </Button>
        ) : null}
        {/*
          ULOŽIT NENAHRAZUJE AUTOMATICKÉ UKLÁDÁNÍ, jen ho umí vyvolat hned.
          Uvnitř volá tentýž `flush()`, který se pouští před náhledem a před
          testovacím odesláním, takže nevzniká druhá cesta k zápisu.

          Tlačítko tu je proto, že bez něj nemá uživatel v ruce vůbec nic:
          když se automatické ukládání nespustí, je jediným vodítkem text
          v hlavičce, a ten je prázdný, dokud se poprvé neuloží. Přesně tak
          vypadala vada, kdy se návrh od AI neuložil nikdy.

          Vypnuté, dokud není co ukládat, aby text v hlavičce a stav tlačítka
          neříkaly dvě různé věci.
        */}
        {props.readOnly ? null : (
          <Button
            variant="secondary"
            disabled={!isDirty || status === 'saving'}
            onClick={props.onSave}
          >
            {t('header.save')}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => props.onMode(props.mode === 'edit' ? 'preview' : 'edit')}
        >
          {props.mode === 'edit' ? t('header.preview') : t('header.edit')}
        </Button>
        <Button
          variant={props.returnTo && props.onReturn ? 'secondary' : 'primary'}
          onClick={props.onTestSend}
        >
          {t('header.testSend')}
        </Button>
      </div>
    </header>
  );
}
