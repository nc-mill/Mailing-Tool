'use client';

import { mergeAttributes } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import Underline from '@tiptap/extension-underline';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { RichText } from '../../../model/document-types';
import type { FieldCatalog } from '../../../model/field-catalog';
import { richTextToTiptap, tiptapToRichText } from '../../../model/richtext';
import { PersonalizationExtension } from '../../richtext/personalization-extension';
import { PersonalizationMenu } from '../../richtext/personalization-menu';
import { RichTextToolbar } from '../../richtext/toolbar';

/**
 * Bohatý text editovatelný PŘÍMO na plátně.
 *
 * Rozdíl proti `RichTextField` v panelu vlastností není jen v umístění. Pole
 * v panelu má vlastní rám, vlastní písmo a vlastní velikost, takže uživatel
 * psal text v jednom vzhledu a výsledek viděl v jiném. Tahle komponenta
 * naopak NEMÁ žádný vlastní vzhled: písmo, velikost, barvu, řádkování
 * i zarovnání dědí z bloku, do kterého je namontovaná. Co uživatel píše,
 * to přesně tak vypadá.
 *
 * Montuje se jen tehdy, když uživatel do textu skutečně vstoupil. Kdyby
 * existovala instance u každého textového bloku, sebral by Tiptap fokus při
 * každém výběru bloku a klávesová cesta po plátně (šipky, `Alt+↑/↓`) by
 * přestala fungovat: šipky by psaly do textu místo chození po stromu.
 */
export function InlineRichText(props: {
  value: RichText;
  onChange: (next: RichText) => void;
  onExit: () => void;
  allowLists: boolean;
  singleParagraph?: boolean | undefined;
  fieldCatalog: FieldCatalog;
  align?: 'left' | 'center' | 'right' | 'justify' | undefined;
  style?: CSSProperties | undefined;
  /** Řádkový režim pro popisek tlačítka: pole se nesmí roztáhnout na celou šířku. */
  inline?: boolean | undefined;
}) {
  const t = useTranslations('editor');
  const { onChange, onExit } = props;

  const extensions = useMemo(
    () => [
      Document.extend(props.singleParagraph ? { content: 'paragraph' } : {}),
      Paragraph.extend({
        addAttributes: () => ({ align: { default: null } }),
        /**
         * Zarovnání se kreslí i při psaní.
         *
         * Tiptap sám atribut `align` do DOM nepromítá, takže by odstavec
         * zarovnaný na střed vypadal při editaci zarovnaný doleva a po
         * opuštění textu by uskočil. Nulový okraj je tu ze stejného důvodu:
         * emitter kreslí odstavce s `margin: 0`.
         */
        renderHTML({ HTMLAttributes, node }) {
          const align = node.attrs.align as string | null;
          // `inline-block` u jednoodstavcového pole: popisek tlačítka je uvnitř
          // `inline-block` rámu a blokový odstavec by ho roztáhl na celou šířku
          // e-mailu. Táž past jako u `RichView` s přepínačem `inline`.
          const base = props.singleParagraph ? 'margin:0;display:inline-block' : 'margin:0';
          const style = align && align !== 'left' ? `${base};text-align:${align}` : base;
          return ['p', mergeAttributes(HTMLAttributes, { style }), 0];
        },
      }),
      Text,
      Bold,
      Italic,
      Underline,
      Strike,
      HardBreak,
      UndoRedo,
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ['http', 'https', 'mailto', 'tel'],
      }),
      PersonalizationExtension,
      Placeholder.configure({ placeholder: t('richtext.placeholder') }),
      ...(props.allowLists ? [BulletList, OrderedList, ListItem] : []),
    ],
    [props.allowLists, props.singleParagraph, t],
  );

  const editor = useEditor(
    {
      extensions,
      content: richTextToTiptap(props.value),
      immediatelyRender: false,
      /*
       * `autofocus` zůstává vypnutý a fokus se nastavuje níž v efektu.
       *
       * Vestavěná volba `'end'` po nastavení kurzoru volá `scrollIntoView`,
       * což znamená `coordsAtPos` a `getClientRects` nad textovým uzlem. To je
       * problém dvakrát: v prohlížeči plátno poskočí při každém vstupu do
       * textu, a v jsdom `getClientRects` na textovém uzlu vůbec není, takže
       * testy padaly na neodchycené výjimce z ProseMirroru.
       */
      autofocus: false,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': props.singleParagraph ? 'false' : 'true',
          'aria-label': t('richtext.label'),
          'data-inline-editor': '',
          // Písmo ani barva se tu nenastavují schválně, dědí se z bloku.
          style: 'outline:none;white-space:pre-wrap;',
        },
        handleKeyDown: (_view, event) => {
          if (event.key !== 'Escape') return false;
          event.preventDefault();
          onExit();
          return true;
        },
      },
      onUpdate: ({ editor: instance }) => {
        onChange(tiptapToRichText(instance.getJSON() as never));
      },
    },
    [extensions],
  );

  useEffect(() => {
    // Kurzor na konec textu, ale bez posunu stránky. Komponenta vzniká až
    // v okamžiku, kdy uživatel do textu vstoupil, takže fokus nikomu nebere.
    if (!editor || editor.isDestroyed) return;
    editor.commands.focus('end', { scrollIntoView: false });
  }, [editor]);

  /**
   * MÁ UŽIVATEL OZNAČENÝ TEXT?
   *
   * Naměřená vada: při psaní visely nad textem i pod ním dvě lišty naráz
   * (formátování a ovládání bloku) a zadavatel přes ně neviděl, co píše.
   * Formátování se přitom týká VÝBĚRU: tučné bez označeného textu nemá co
   * ztučnit. Lišta se proto ukazuje jen tehdy, když výběr není prázdný,
   * stejně jako to dělá většina editorů.
   *
   * Poslouchá se i `transaction`, ne jen `selectionUpdate`. Psaní výběr
   * sbalí do kurzoru, ale `selectionUpdate` u toho nemusí přijít, takže by
   * lišta po označení textu zůstala viset celou dobu psaní.
   */
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      if (editor.isDestroyed) return;
      const { empty, from, to } = editor.state.selection;
      setHasSelection(!empty && to > from);
    };
    sync();
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);

  useEffect(() => {
    // `isDestroyed` je nutná podmínka, ne opatrnost navíc: při opuštění bloku
    // se instance ruší, ale efekt se nad ní ještě jednou spustí a `commands`
    // by sáhly na `view`, které je už null. Výjimka by shodila celé plátno.
    if (!editor || editor.isDestroyed) return;
    const current = tiptapToRichText(editor.getJSON() as never);
    if (JSON.stringify(current) !== JSON.stringify(props.value)) {
      editor.commands.setContent(richTextToTiptap(props.value), { emitUpdate: false });
    }
  }, [editor, props.value]);

  if (!editor) {
    return <div style={{ minHeight: '1em' }} aria-hidden />;
  }

  return (
    <div
      style={{
        position: 'relative',
        display: props.inline ? 'inline-block' : 'block',
        textAlign: props.align ?? 'left',
      }}
    >
      {/* Formátování i vkládání personalizace jsou U TEXTU, ne v postranním
          panelu. Lišta je vytažená z toku, aby při vstupu do textu neposunula
          obsah e-mailu o svoji výšku.

          Kreslí se POD blokem, ne nad ním. Nad blokem sedí ovládání bloku
          (nahoru, dolů, duplikovat, smazat) a obě lišty se překrývaly.

          UKAZUJE SE JEN NAD OZNAČENÝM TEXTEM. Při pouhém psaní není co
          formátovat a lišta by jen zakrývala obsah, což byl přesně naměřený
          nález. Personalizace má vlastní tlačítko níž, protože ta se vkládá
          na místo kurzoru, tedy typicky bez výběru. */}
      {hasSelection ? (
        <div
          data-testid="inline-toolbar"
          contentEditable={false}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 30,
            textAlign: 'left',
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border)',
            // Vysouvací panel, ne ovládací prvek: rádius 10 px a měkký stín
            // z tokenu `--shadow-flyout`, tedy tentýž, jaký má vysouvací panel
            // bočního menu. Je to jediný stín, který systém povoluje.
            borderRadius: 'var(--radius-surface)',
            boxShadow: 'var(--shadow-flyout)',
            whiteSpace: 'nowrap',
            /*
             * ŠÍŘKA PODLE OBSAHU, NE PODLE BLOKU POD LIŠTOU.
             *
             * Absolutně pozicovaný prvek bez šířky se smrskne do šířky svého
             * obalu, a tím je tady blok, do kterého se píše. V úzkém sloupci to
             * znamenalo lištu širokou pár desítek pixelů a ovládání zlomené do
             * čtyř řádků. `max-content` ji roztáhne podle tlačítek; přetéct
             * mimo blok smí, protože je vytažená z toku.
             *
             * `maxWidth` je pojistka pro úzké okno: lišta nikdy nesmí být širší
             * než plocha, jinak by se useknula u okraje obrazovky. Tam a jedině
             * tam se zlomí do dvou řádků.
             */
            width: 'max-content',
            maxWidth: 'min(90vw, 520px)',
          }}
          // Kliknutí do lišty nesmí probublat na plátno, jinak by výběr bloku
          // zmizel a lišta by se odmontovala dřív, než se stihne tlačítko použít.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
        >
          <RichTextToolbar
            editor={editor}
            allowLists={props.allowLists}
            fieldCatalog={props.fieldCatalog}
          />
        </div>
      ) : (
        /*
         * PERSONALIZACE ZŮSTÁVÁ PO RUCE I PŘI PSANÍ, a není to výjimka z pravidla
         * výš, ale důsledek toho, že nemá kam jinam jít: panel vlastností texty
         * schválně nenabízí (`properties-panel.tsx` položky `richtext` odfiltruje),
         * takže tohle je JEDINÁ cesta, jak do textu dostat údaj o příjemci. Kdyby
         * zmizela s lištou, přestalo by jít vložit `[oslovení]` jinak než tak, že
         * uživatel napřed něco označí, a označený text by se vložením přepsal.
         *
         * Je to jedno malé tlačítko v pravém horním rohu bloku, tedy tam, kde při
         * psaní sedí kurzor nejméně často, a ne pás ikon přes text. Místo je volné
         * právě proto, že ovládání bloku se během psaní schovává.
         */
        <div
          data-testid="inline-personalization"
          contentEditable={false}
          style={{
            position: 'absolute',
            top: '-14px',
            right: '4px',
            zIndex: 30,
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border)',
            // Vysouvací panel, ne ovládací prvek: rádius 10 px a měkký stín
            // z tokenu `--shadow-flyout`, tedy tentýž, jaký má vysouvací panel
            // bočního menu. Je to jediný stín, který systém povoluje.
            borderRadius: 'var(--radius-surface)',
            boxShadow: 'var(--shadow-flyout)',
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
        >
          <PersonalizationMenu editor={editor} fieldCatalog={props.fieldCatalog} />
        </div>
      )}
      <EditorContent editor={editor} style={props.style} />
    </div>
  );
}
