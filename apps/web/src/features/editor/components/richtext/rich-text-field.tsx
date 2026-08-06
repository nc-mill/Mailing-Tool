'use client';

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
import { useEffect, useMemo } from 'react';
import type { RichText } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { richTextToTiptap, tiptapToRichText } from '../../model/richtext';
import { PersonalizationExtension } from './personalization-extension';
import { RichTextToolbar } from './toolbar';

export function RichTextField(props: {
  id: string;
  value: RichText;
  onChange: (next: RichText) => void;
  allowLists: boolean;
  singleParagraph?: boolean;
  autoFocus?: boolean;
  fieldCatalog: FieldCatalog;
}) {
  const t = useTranslations('editor');

  const extensions = useMemo(
    () => [
      Document.extend(props.singleParagraph ? { content: 'paragraph' } : {}),
      Paragraph.extend({
        addAttributes: () => ({ align: { default: null } }),
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
      // `autofocus` je natvrdo `false`. Prop `autoFocus` znamená „tohle je první
      // pole panelu", ne „vezmi si fokus". Kdyby si ho pole vzalo samo, každý
      // výběr bloku na plátně by fokus odsál do textu a klávesová cesta z úkolu 14
      // by přestala fungovat: šipky by psaly do textu místo chození po stromu.
      // Fokus sem přenese až operace „Upravit obsah" (Enter), která hledá
      // `[data-autofocus]` uvnitř `#editor-properties`.
      autofocus: false,
      // `role="textbox"` doplňuje tenhle plán: ProseMirror ho sám nenastavuje,
      // takže by pole pro čtečku nebylo textovým vstupem, jen editovatelným divem.
      editorProps: {
        attributes: {
          id: props.id,
          role: 'textbox',
          'aria-multiline': props.singleParagraph ? 'false' : 'true',
          'aria-label': t('richtext.label'),
          ...(props.autoFocus ? { 'data-autofocus': '' } : {}),
        },
      },
      onUpdate: ({ editor: instance }) => {
        props.onChange(tiptapToRichText(instance.getJSON() as never));
      },
    },
    [extensions],
  );

  useEffect(() => {
    // `editor.isDestroyed` je nutná podmínka, ne opatrnost navíc. Při přepnutí
    // vybraného bloku se pole odpojí a Tiptap instanci zruší, ale efekt se ještě
    // jednou spustí nad zrušenou instancí. `editor.commands` na ní sáhne na
    // `view`, které je už null, a výjimka shodí celé plátno.
    if (!editor || editor.isDestroyed) return;
    const current = tiptapToRichText(editor.getJSON() as never);
    if (JSON.stringify(current) !== JSON.stringify(props.value)) {
      editor.commands.setContent(richTextToTiptap(props.value), { emitUpdate: false });
    }
  }, [editor, props.value]);

  if (!editor)
    return (
      <div
        className="h-24 rounded-[var(--radius-control)] border border-border bg-surface-muted"
        aria-hidden
      />
    );

  return (
    <div className="rounded-[var(--radius-control)] border border-border">
      <RichTextToolbar
        editor={editor}
        allowLists={props.allowLists}
        fieldCatalog={props.fieldCatalog}
      />
      <EditorContent editor={editor} className="prose-sm min-h-24 p-2 focus-within:outline-none" />
    </div>
  );
}
