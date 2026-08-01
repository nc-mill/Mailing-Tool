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
    <div
      role="toolbar"
      aria-label={t('richtext.toolbar')}
      className="flex flex-wrap gap-1 border-b border-border p-1"
    >
      {marks.map((mark) => (
        <Button
          key={mark.id}
          variant="ghost"
          size="sm"
          className="min-h-8 px-2"
          aria-label={t(mark.label)}
          aria-pressed={editor.isActive(mark.id)}
          onClick={mark.run}
        >
          <mark.icon aria-hidden className="size-4" />
        </Button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="min-h-8 px-2"
        aria-label={t('richtext.link')}
        aria-pressed={editor.isActive('link')}
        onClick={() => setLinkDraft(String(editor.getAttributes('link').href ?? ''))}
      >
        <Link2 aria-hidden className="size-4" />
      </Button>
      {props.allowLists ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-8 px-2"
            aria-label={t('richtext.bulletList')}
            aria-pressed={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List aria-hidden className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-8 px-2"
            aria-label={t('richtext.orderedList')}
            aria-pressed={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered aria-hidden className="size-4" />
          </Button>
        </>
      ) : null}
      <PersonalizationMenu editor={editor} fieldCatalog={props.fieldCatalog} />
      {linkDraft !== null ? (
        <form
          className="flex w-full gap-1 p-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (validateHref(linkDraft) !== 'ok') return;
            editor.chain().focus().setLink({ href: linkDraft }).run();
            setLinkDraft(null);
          }}
        >
          <input
            aria-label={t('richtext.linkUrl')}
            className="h-8 flex-1 rounded border border-border px-2 text-sm"
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
