'use client';

import type { RichText } from '../../../model/document-types';
import { RichTextField } from '../../richtext/rich-text-field';
import type { ControlProps } from '../prop-field';

export function RichTextControl({
  descriptor,
  value,
  onChange,
  id,
  autoFocus,
  fieldCatalog,
}: ControlProps) {
  if (descriptor.kind !== 'richtext') return <></>;
  return (
    <RichTextField
      id={id}
      autoFocus={autoFocus === true}
      allowLists={descriptor.allowLists}
      singleParagraph={descriptor.singleParagraph === true}
      fieldCatalog={fieldCatalog}
      value={(value ?? [{ t: 'p', children: [] }]) as RichText}
      onChange={onChange}
    />
  );
}
