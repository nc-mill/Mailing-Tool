'use client';

import { Button } from '@mlain/ui/components/button';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FieldCatalog } from '../../model/field-catalog';
import { Bold, Italic, Link2, List, ListOrdered, Strikethrough, Underline } from '../icons';
import { validateHref } from '../properties/controls/link-control';
import { PersonalizationMenu } from './personalization-menu';

export function RichTextToolbar(props: {
  editor: Editor;
  allowLists: boolean;
  fieldCatalog: FieldCatalog;
}) {
  const t = useTranslations('editor');
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const { editor } = props;

  const marks = [
    {
      id: 'bold',
      icon: Bold,
      label: 'richtext.bold',
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      id: 'italic',
      icon: Italic,
      label: 'richtext.italic',
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      id: 'underline',
      icon: Underline,
      label: 'richtext.underline',
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      id: 'strike',
      icon: Strikethrough,
      label: 'richtext.strike',
      run: () => editor.chain().focus().toggleStrike().run(),
    },
  ];

  return (
    /*
     * LIŠTA JE JEDNA ŘADA A NELÁME SE.
     *
     * Dřív měla `flex-wrap` a ovládání se lámalo do čtyř řádků: lišta visí nad
     * blokem a šířku jí dává blok, který může být úzký sloupec. Řádek proto má
     * `flex-nowrap` a obal v `inline-rich-text.tsx` šířku `max-content`, aby se
     * lišta roztáhla podle obsahu, ne podle bloku pod ní.
     *
     * Zadávání odkazu je vlastní řádek pod lištou, ne položka v ní: má textové
     * pole a dvě tlačítka, takže by v jedné řadě lištu roztáhlo přes celé okno.
     */
    <div className="flex flex-col">
      <div
        role="toolbar"
        aria-label={t('richtext.toolbar')}
        className="flex flex-nowrap items-center gap-1 p-1"
      >
        {marks.map((mark) => (
          <Button
            key={mark.id}
            variant="ghost"
            size="sm"
            className="size-[var(--size-control-xs)] min-h-[var(--size-control-xs)] px-0"
            aria-label={t(mark.label)}
            aria-pressed={editor.isActive(mark.id)}
            onClick={mark.run}
          >
            <mark.icon aria-hidden className="icon-sm" />
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="size-[var(--size-control-xs)] min-h-[var(--size-control-xs)] px-0"
          aria-label={t('richtext.link')}
          aria-pressed={editor.isActive('link')}
          onClick={() => setLinkDraft(String(editor.getAttributes('link').href ?? ''))}
        >
          <Link2 aria-hidden className="icon-sm" />
        </Button>
        {props.allowLists ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="size-[var(--size-control-xs)] min-h-[var(--size-control-xs)] px-0"
              aria-label={t('richtext.bulletList')}
              aria-pressed={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List aria-hidden className="icon-sm" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-[var(--size-control-xs)] min-h-[var(--size-control-xs)] px-0"
              aria-label={t('richtext.orderedList')}
              aria-pressed={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered aria-hidden className="icon-sm" />
            </Button>
          </>
        ) : null}
        {/* Personalizace je jiná třída akce než tučné písmo: nemění vzhled
            výběru, vkládá do textu údaj o příjemci. Svislá čárka to odděluje,
            aby se mezi formátováním neztratila. */}
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
        <PersonalizationMenu editor={editor} fieldCatalog={props.fieldCatalog} />
      </div>
      {linkDraft !== null ? (
        <form
          className="flex gap-1 border-t border-border p-1"
          /*
           * ESC ZAVÍRÁ JEN TENHLE ŘÁDEK, ne psaní celého textu.
           *
           * Naměřená vada: Esc v poli pro adresu ukončil psaní celého odstavce.
           * Plátno má na Esc dva kroky (opustit psaní, pak odznačit blok)
           * a událost z tohohle pole k němu probublává, přičemž první krok se
           * na cíl neptal.
           *
           * ZASTAVUJE SE TO TADY, `stopPropagation`, ne výjimkou na plátně.
           * Zkusil jsem to napřed tam a naměřil jsem v prohlížeči regresi:
           * s výjimkou pro vlastní obsluhu potřeboval odchod z psaní TŘI stisky
           * místo jednoho, protože Tiptap na Escape nejdřív jen odebere fokus
           * z `contenteditable` a psaní ukončí až druhý stisk, který na plátno
           * dojde z obalu bloku. Dvoukrokový Escape na plátně tak zůstává celý
           * beze změny; zavřít řádek s odkazem je práce toho, komu řádek patří.
           *
           * Odkaz se přitom NENASTAVUJE ani neruší: Esc je návrat z rozepsané
           * změny, ne její potvrzení. Fokus se vrací do textu, jinak by po
           * zavření řádku zůstal na zmizelém poli a spadl na `<body>`.
           */
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setLinkDraft(null);
            editor.chain().focus().run();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (validateHref(linkDraft) !== 'ok') return;
            editor.chain().focus().setLink({ href: linkDraft }).run();
            setLinkDraft(null);
          }}
        >
          <input
            aria-label={t('richtext.linkUrl')}
            className="min-h-[var(--size-control-sm)] w-56 rounded-[var(--radius-control)] border border-border-strong bg-field px-2 text-sm"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
          />
          <Button type="submit" size="sm">
            {t('richtext.linkApply')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setLinkDraft(null);
            }}
          >
            {t('richtext.linkRemove')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
