'use client';

import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { IconButton } from '@mlain/ui/components/icon-button';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { useTranslations } from 'next-intl';
import type { EditorPorts } from '../../ports/types';
import { useEditorState } from '../../state/use-editor';
import { MailCheck } from '../icons';
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
   * Profil kontroly. Hlavička ho potřebuje kvůli jediné věci: veřejná stránka
   * se NEODESÍLÁ, takže na ní nesmí být tlačítko „Poslat test".
   */
  templateKind?: string | undefined;
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

  /*
   * Hlavička je TLUMENÝ PRUH s rádiusem 10 px, jak ji kreslí návrh nad plátnem:
   * `padding 12/15`, plocha `surface-muted`, hairline rámeček. Dřív to byla
   * linka přes celou šířku, což k mřížce karet pod ní nesedělo.
   *
   * Vlevo název a ovladače zobrazení, vpravo stav ukládání a akce. Návrh má
   * vpravo `margin-left: auto`, tady to dělá `ml-auto` na skupině tlačítek,
   * aby se při zúžení zalomila jako celek.
   */
  return (
    <header
      className={[
        'flex flex-wrap items-center gap-[var(--spacing-inline)]',
        'rounded-[var(--radius-surface)] border border-border bg-surface-muted',
        'px-[var(--spacing-stack)] py-3',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
        {/*
          Obsah kampaně NENÍ obecná šablona, i když leží ve stejné tabulce.
          Uživatel, který se sem proklikl z kampaně, musí vidět, že upravuje
          e-mail té jedné kampaně; jinak se právem bojí, že mění vzor pro
          všechny ostatní.
        */}
        {props.contentKind === 'campaign' ? (
          // Je to odznak, ne vlastní obdélníček: odpovídá na otázku „v jakém
          // je to stavu", tedy „tohle není šablona, tohle je obsah kampaně".
          <span data-testid="content-kind">
            <Badge tone="accent">{t('header.campaignContent')}</Badge>
          </span>
        ) : null}
        {/*
          Název stojí na místě, kde se čte titulek: uživatel ho hledá jako
          první věc v hlavičce, ne mezi ovladači.
        */}
        {props.templateName !== undefined && props.onRename ? (
          <TemplateName
            name={props.templateName}
            onRename={props.onRename}
            readOnly={props.readOnly}
          />
        ) : null}
        <ViewControls ports={props.ports} />
      </div>
      {/*
        POŘADÍ V KÓDU JE POŘADÍ NA OBRAZOVCE, a je to závazné.

        Skupina je obyčejný `flex` bez `order` a bez `row-reverse`, takže co je
        výš v kódu, stojí vlevo. Čtečka i tabulátor jdou tímtéž pořadím: stav
        ukládání, Uložit, Náhled, Poslat test a nakonec Pokračovat, tedy zleva
        doprava přesně tak, jak to člověk vidí. Přesouvat cokoli vizuálně přes
        CSS by znamenalo, že se fokus po obrazovce plácá pozpátku.
      */}
      <div className="ml-auto flex flex-wrap items-center gap-[var(--spacing-inline)]">
        {/*
          STAV UKLÁDÁNÍ STOJÍ TĚSNĚ PŘED TLAČÍTKEM ULOŽIT.

          Dřív byl vlevo mezi názvem a ovladači zobrazení, tedy přes půl
          hlavičky od tlačítka, se kterým mluví o téže věci. Uživatel si ty dvě
          věci nespojil: napravo viděl tlačítko „Uložit", nalevo někde větu
          o ukládání, a nic mu neřeklo, že spolu souvisejí. Teď jsou vedle sebe
          a věta odpovídá právě na otázku, kterou tlačítko vyvolává, tedy „musím
          mačkat, nebo se to děje samo?".

          TLAČÍTKO SE MEZI STAVY NEHÝBE, a je to důsledek pořadí, ne pevné
          šířky. Skupina má `ml-auto`, takže je ukotvená pravou hranou; stav je
          v ní první, takže delší věta roste doleva a všechno za ní zůstává
          stát. Pevná šířka by tu byla horší: hlášky o chybě nesou celou větu
          ze serveru a ta se do žádného vyhrazeného místa nevejde.
        */}
        <SaveStatus readOnly={props.readOnly} />
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
        {/*
          NÁHLED JE SLOVO, ne ikona. Zkusili jsme oko a je to nečitelné: oko
          na jedné obrazovce znamená „ukázat heslo", „viditelný sloupec"
          i „náhled e-mailu", takže se z něj sám o sobě nepozná, co se stane.
          Náhled navíc PŘEPÍNÁ celou obrazovku, plátno zmizí a nastoupí
          vyrenderovaný e-mail, a takhle velká změna si zaslouží jméno, ne
          hádanku. Vedle toho ikona zůstává tam, kde je akce vedlejší
          a jednosměrná, tedy u zkušebního odeslání.

          POPISEK JE V OBOU STAVECH STEJNÝ a stav nese `aria-pressed`.

          Chvíli tu stálo „Zpět k úpravám", což je delší nápis, a hlavička se
          kvůli němu v náhledu lámala do dvou řádků, přestože v úpravách
          držela jeden. Pruh, který mění výšku podle toho, na co se člověk
          zrovna dívá, vypadá jako vada vykreslení.

          Přepínač se jménem stavu je navíc vzor, který WAI-ARIA popisuje
          přesně takhle: tlačítko se jmenuje po tom, co ovládá, a jestli je
          zapnuté, říká `aria-pressed`. Čtečka to čte jako „Náhled, přepínač,
          stisknuto", takže volba není informace nesená jen barvou.

          `secondary` je TÁŽ VÁHA jako `solid` u ikonového tlačítka vedle:
          hairline rámeček v barvě hrany a spodní hrana 3 px. Dvě sousední
          akce, které si jsou rovné, nesmí vypadat, že jedna z nich je vypnutá.
          Stisknutý stav se od nestisknutého liší plochou `accent-surface`,
          ne jen odstínem textu.
        */}
        <Button
          variant="secondary"
          data-testid="editor-preview"
          aria-pressed={props.mode === 'preview'}
          className="aria-pressed:bg-accent-surface"
          onClick={() => props.onMode(props.mode === 'edit' ? 'preview' : 'edit')}
        >
          {t('header.preview')}
        </Button>
        {/*
          ZKUŠEBNÍ ODESLÁNÍ MÁ OBÁLKU SE ZAŠKRTNUTÍM, ne papírového holuba.
          `Send` je v aplikaci ikona SKUTEČNÉHO odeslání kampaně (kontrolní
          seznam před odesláním, dlaždice „Odesláno" v reportech). Kdyby se
          tatáž kresba objevila v editoru kampaně, četla by se jako „rozeslat
          všem" a to je akce, kterou si nikdo nechce splést. `MailCheck` říká
          „zkušební, ověřovací e-mail" a nesvádí ke kliknutí naslepo.

          `solid` je nejsilnější podoba, jakou ikonové tlačítko má, a je to
          táž kresba rámečku a hrany jako u `secondary` tlačítka „Náhled"
          vedle. `quiet` tady být nesmí: tichá varianta má tlumený text
          a průhledný rámeček, takže vedle plnohodnotného souseda vypadá
          jako zakázaná akce, i když zakázaná není.

          Textové tlačítko tady u samostatné šablony bývalo žluté (`primary`),
          a to ikonové tlačítko schválně neumí: žlutá plocha je v systému
          vyhrazená hlavní akci obrazovky se jménem. U editoru uvnitř kampaně
          je hlavní akcí „Pokračovat", takže tam se nic neztrácí.
        */}
        {/*
          ZKUŠEBNÍ ODESLÁNÍ JEN U E-MAILU. Veřejná stránka se neodesílá nikam:
          otevírá se v prohlížeči z odkazu, takže „Poslat test" na ní slibuje
          akci, která nemůže nastat. Nahlásil zadavatel 7. 8. 2026 spolu
          s e-mailovými chybami v panelu nálezů; je to táž vada, tedy editor
          stránky, který se tváří jako editor e-mailu.
        */}
        {props.templateKind === 'page' ? null : (
          <Tooltip content={t('header.testSend')}>
            <IconButton
              variant="solid"
              label={t('header.testSend')}
              data-testid="editor-test-send"
              icon={<MailCheck aria-hidden className="icon-md" />}
              onClick={props.onTestSend}
            />
          </Tooltip>
        )}
        {/*
          NÁVRAT DO KAMPANĚ STOJÍ AŽ NAKONEC, tedy úplně vpravo. Editor sám
          o kampaních nic neví a vědět nemá: dostane jen adresu, kam se po
          uložení vrátit, a popisek tlačítka. Bez toho končí cesta
          „kampaň → obsah → editor" ve slepé uličce a uživatel se do kampaně
          proklikává navigací.

          Poslední místo je záměr, ne libovůle: v celé aplikaci se pokračuje
          tlačítkem na pravém konci řady (průvodce importem, kroky kampaně),
          takže ruka i oko ho hledají tam. Když stálo první, četlo se jako
          součást skupiny „Uložit a podívat se" a přitom z obrazovky odvádí.
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
      </div>
    </header>
  );
}
