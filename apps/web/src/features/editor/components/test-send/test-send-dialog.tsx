'use client';

import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EditorPorts, PreviewData } from '../../ports/types';

const MAX_RECIPIENTS = 5;

/**
 * ODCHYLKA OD PLÁNU: obsah nese `DialogBody` a tlačítka `DialogFooter`.
 * `DialogContent` v obalu P05 není a pozice tlačítek je v celé aplikaci pevná:
 * vlevo ústup, vpravo potvrzení.
 */
export function TestSendDialog(props: {
  open: boolean;
  templateId: string;
  ports: EditorPorts;
  flush: () => Promise<void>;
  onClose: () => void;
  previewData?: PreviewData;
}) {
  const t = useTranslations('editor');
  const [raw, setRaw] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const recipients = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    setDone(false);
    if (recipients.length === 0) {
      setProblem(t('testSend.noRecipients'));
      return;
    }
    if (recipients.length > MAX_RECIPIENTS) {
      setProblem(t('testSend.tooMany', { max: MAX_RECIPIENTS }));
      return;
    }
    setProblem(null);
    await props.flush();
    const result = await props.ports.testSend({
      templateId: props.templateId,
      recipients,
      previewData: props.previewData ?? { type: 'sample', variant: 'default' },
    });
    if (result.ok) {
      setDone(true);
      return;
    }
    setProblem(
      result.code === 'rate_limited'
        ? t('testSend.rateLimited', { minutes: Math.ceil((result.retryAfter ?? 0) / 60) })
        : t('testSend.failed', { code: result.code }),
    );
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogTitle>{t('testSend.title')}</DialogTitle>
      <DialogBody>
        <label className="block text-sm">
          {t('testSend.recipients')}
          <Input
            value={raw}
            aria-label={t('testSend.recipients')}
            onChange={(event) => setRaw(event.target.value)}
          />
        </label>
        <p className="text-meta text-text-muted">
          {t('testSend.recipientsHint', { max: MAX_RECIPIENTS })}
        </p>
        {/*
          Přepínač „přidat předponu [TEST]" tu BYL a je pryč. Rozhodnutí D21
          plánu P13 prefix ruší: testovací e-mail má dorazit přesně v té podobě,
          v jaké ho dostanou příjemci. Server ten klíč od té chvíle nepřijímá
          (`.strict()`), takže ho rozhraní posílalo do 422 a uživatel viděl jen
          „Test se nepodařilo odeslat".
        */}
        <p className="text-meta text-text-muted">{t('testSend.explain')}</p>
        {problem ? (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="text-sm">
            {t('testSend.success')}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter
        retreat={
          <Button variant="ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
        }
        confirm={
          <Button variant="primary" onClick={submit}>
            {t('testSend.submit')}
          </Button>
        }
      />
    </Dialog>
  );
}
