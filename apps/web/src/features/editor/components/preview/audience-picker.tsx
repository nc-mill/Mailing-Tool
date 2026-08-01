'use client';

import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ContactSummary, EditorPorts, PreviewData } from '../../ports/types';

export function AudiencePicker(props: {
  ports: EditorPorts;
  value: PreviewData;
  onChange: (data: PreviewData) => void;
}) {
  const t = useTranslations('editor');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ContactSummary[]>([]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
      <label className="text-sm">
        {t('preview.viewAs')}
        <Input
          className="ml-2 inline-block w-56"
          value={query}
          aria-label={t('preview.viewAs')}
          onChange={async (event) => {
            const next = event.target.value;
            setQuery(next);
            setFound(next.length >= 2 ? await props.ports.searchContacts(next) : []);
          }}
        />
      </label>
      {found.length > 0 ? (
        <ul className="flex gap-1">
          {found.map((contact) => (
            <li key={contact.id}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  props.onChange({ type: 'contact', contactId: contact.id });
                  setFound([]);
                  setQuery(contact.name);
                }}
              >
                {contact.name || contact.email}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          const contact = await props.ports.randomContact();
          if (contact) {
            props.onChange({ type: 'contact', contactId: contact.id });
            setQuery(contact.name);
          }
        }}
      >
        {t('preview.randomContact')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          props.onChange({ type: 'sample', variant: 'no_name' });
          setQuery('');
        }}
      >
        {t('preview.noNameContact')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          props.onChange({ type: 'sample', variant: 'default' });
          setQuery('');
        }}
      >
        {t('preview.sampleData')}
      </Button>
    </div>
  );
}
