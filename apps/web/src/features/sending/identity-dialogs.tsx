'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Alert } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, WarningIcon } from '@/lib/ui/status-icons';
import { useRegionLabel } from './provider-region-panel';
import type { EmailIdentityView, IdentityResult, ProductionAccessResult } from './actions';

/**
 * Dvě věci, které se u Amazonu dosud daly vyřídit jen v jeho konzoli:
 * ověření adresy odesílatele a žádost o vyřazení z testovacího režimu.
 *
 * Jsou v jednom souboru schválně. Otevírají se z jednoho řádku seznamu, obě
 * pracují s týmž odesílacím účtem, obě mluví o REGIONU toho účtu a obě po sobě
 * nechávají obrazovku načíst data znovu. Oddělit je by znamenalo dva soubory,
 * které se stejně musí měnit spolu.
 *
 * Co obě dialogy říkají nahlas a vždycky: tohle NEDĚLÁME MY, dělá to Amazon.
 * Potvrzovací e-mail posílá on, žádost posuzuje jeho podpora a obojí je vázané
 * na jeden konkrétní region. Uživatel, který to neví, hledá náš e-mail v naší
 * schránce a náš výsledek v naší aplikaci.
 */

/** Odznak stavu adresy. Neznámý stav je neutrální, ne selhání. */
function IdentityBadge({ status }: { status: EmailIdentityView['status'] }) {
  const t = useTranslations('campaigns.sending.identity');
  const tone =
    status === 'verified'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'pending'
          ? 'accent'
          : 'neutral';
  const icon = status === 'verified' ? CheckIcon : status === 'failed' ? WarningIcon : ClockIcon;
  return (
    <span data-testid="identity-status" data-status={status}>
      <Badge tone={tone} icon={icon}>
        {t(`state.${status}`)}
      </Badge>
    </span>
  );
}

/**
 * Ověření adresy odesílatele přímo z naší aplikace.
 *
 * Volá `CreateEmailIdentity` v regionu účtu, takže uživatel nemusí do konzole
 * Amazonu vůbec. Adresa, kterou už účet zná, NENÍ chyba: jediná správná reakce
 * je přečíst si její stav a ukázat ho, protože jinak by uživatel opravoval
 * adresu, se kterou není nic špatně.
 */
export function VerifyIdentityDialog({
  providerName,
  region,
  open,
  onOpenChange,
  onSubmit,
  onRefresh,
}: {
  providerName: string;
  /** Region účtu. Stojí v nadpisu i v textu, protože ověření platí jen v něm. */
  region: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (email: string) => Promise<IdentityResult>;
  onRefresh: (email: string) => Promise<IdentityResult>;
}) {
  const t = useTranslations('campaigns.sending.identity');
  const label = useRegionLabel();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<EmailIdentityView | null>(null);

  /** Kontrola v prohlížeči je pohodlí. Rozhoduje server, který kopíruje pravidlo AWS. */
  const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  async function submit() {
    const value = email.trim();
    if (!looksLikeEmail(value)) {
      setFieldError(t('emailInvalid'));
      return;
    }
    setFieldError(null);
    setFailure(null);
    setPending(true);
    try {
      const r = await onSubmit(value);
      if (r.status === 'error') {
        setFailure(r.detail === '' ? t('failed') : r.detail);
        return;
      }
      setResult(r.identity);
    } finally {
      setPending(false);
    }
  }

  async function refresh() {
    if (!result) return;
    setRefreshing(true);
    setFailure(null);
    try {
      const r = await onRefresh(result.email);
      if (r.status === 'error') {
        setFailure(r.detail === '' ? t('failed') : r.detail);
        return;
      }
      setResult(r.identity);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('title', { name: providerName })}</DialogTitle>
      <DialogBody>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <p className="text-text-muted">{t('explanation')}</p>

          {/* Region NENÍ podrobnost. Ověření platí výhradně v něm a uživatel,
              který si ověří adresu v jiném regionu, než ze kterého odesíláme,
              stráví hledáním příčiny dny. Doslova. */}
          {region !== null && region !== '' && (
            <Alert tone="info" data-testid="identity-region">
              {t('regionNote', { region: label(region) })}
            </Alert>
          )}

          {/* Kdo ten e-mail posílá a jak dlouho odkaz platí. Bez téhle věty ho
              uživatel hledá mezi našimi zprávami a čeká na něj bez konce. */}
          <Alert tone="warning" data-testid="identity-who-sends">
            {t('whoSends')}
          </Alert>

          <Field label={t('emailLabel')} {...(fieldError === null ? {} : { error: fieldError })}>
            <Input
              type="email"
              data-testid="identity-email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldError(null);
              }}
            />
          </Field>

          {result && (
            <div className="flex flex-col gap-2" data-testid="identity-result">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono">{result.email}</span>
                <IdentityBadge status={result.status} />
              </div>
              <p className="text-sm text-text-muted">
                {result.verified
                  ? t('resultVerified')
                  : result.already_existed
                    ? t('resultAlreadyExisted')
                    : t('resultPending')}
              </p>
              <div>
                <Button
                  data-testid="identity-refresh"
                  pending={refreshing}
                  onClick={() => void refresh()}
                >
                  {t('refresh')}
                </Button>
              </div>
            </div>
          )}

          {failure !== null && (
            <Alert tone="error" data-testid="identity-error">
              {failure}
            </Alert>
          )}
        </div>
      </DialogBody>

      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
        }
        confirm={
          <Button
            variant="primary"
            data-testid="identity-submit"
            pending={pending}
            pendingLabel={t('submitting')}
            onClick={() => void submit()}
          >
            {t('submit')}
          </Button>
        }
      />
    </Dialog>
  );
}

const MAIL_TYPES = ['MARKETING', 'TRANSACTIONAL'] as const;
type MailType = (typeof MAIL_TYPES)[number];

/**
 * Žádost o vyřazení z testovacího režimu (`PutAccountDetails`).
 *
 * Ověřeno v dokumentaci SESv2 (4. 8. 2026): API to umí a příručka SES tuhle
 * cestu sama nabízí i přes AWS CLI. Amazon chce povinně dva údaje, druh pošty
 * a adresu webu; ostatní je nepovinné.
 *
 * Dialog říká PŘEDEM tři věci, které uživatel jinak zjistí až za pochodu:
 * žádost posuzuje člověk a první odpověď přijde do 24 hodin, během posuzování
 * nejde údaje změnit ani podat druhou žádost, a schválení platí JEN PRO REGION,
 * ze kterého se žádalo.
 */
export function ProductionAccessDialog({
  providerName,
  region,
  open,
  onOpenChange,
  onSubmit,
}: {
  providerName: string;
  region: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    mailType: MailType;
    websiteUrl: string;
    additionalContactEmails: string[];
  }) => Promise<ProductionAccessResult>;
}) {
  const t = useTranslations('campaigns.sending.productionAccess');
  const label = useRegionLabel();
  const [mailType, setMailType] = useState<MailType>('MARKETING');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [contact, setContact] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    const url = websiteUrl.trim();
    if (url === '') {
      setErrors({ websiteUrl: t('required') });
      return;
    }
    setErrors({});
    setFailure(null);
    setPending(true);
    try {
      const r = await onSubmit({
        mailType,
        websiteUrl: url,
        additionalContactEmails: contact.trim() === '' ? [] : [contact.trim()],
      });
      if (r.status === 'error') {
        // 409 znamená „jednu žádost už posuzujeme", ne chybu ve vstupu, a musí
        // mít vlastní větu: uživatel jinak opravuje formulář, se kterým je
        // všechno v pořádku.
        setFailure(
          r.reason === 'production_access_review_in_progress'
            ? t('alreadyUnderReview')
            : r.detail === ''
              ? t('failed')
              : r.detail,
        );
        return;
      }
      setSubmitted(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('title', { name: providerName })}</DialogTitle>
      <DialogBody>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <p className="text-text-muted">{t('explanation')}</p>

          {region !== null && region !== '' && (
            <Alert tone="warning" data-testid="production-access-region">
              {t('regionNote', { region: label(region) })}
            </Alert>
          )}

          {/* Co bude Amazon chtít vědět a co se stane pak. Řečené předem, ne až
              chybovou hláškou při druhém pokusu. */}
          <Alert tone="info" data-testid="production-access-expectations">
            <span className="flex flex-col gap-2">
              <span>{t('whatAmazonWants')}</span>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                <li>{t('wantsMailType')}</li>
                <li>{t('wantsWebsite')}</li>
                <li>{t('wantsContact')}</li>
              </ul>
              <span>{t('review')}</span>
              <span>{t('noEditsDuringReview')}</span>
            </span>
          </Alert>

          {submitted ? (
            <Alert tone="success" data-testid="production-access-sent">
              {t('sent')}
            </Alert>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-sm font-medium text-text">{t('mailTypeLabel')}</legend>
                <RadioGroup
                  value={mailType}
                  onValueChange={(next) => setMailType(next as MailType)}
                  aria-label={t('mailTypeLabel')}
                  className="gap-3"
                >
                  {MAIL_TYPES.map((kind) => (
                    <div key={kind} className="flex items-start gap-3">
                      <RadioGroupItem
                        value={kind}
                        id={`mail-type-${kind}`}
                        data-testid={`mail-type-${kind}`}
                        aria-label={t(
                          kind === 'MARKETING' ? 'mailTypeMarketing' : 'mailTypeTransactional',
                        )}
                        className="mt-1 shrink-0"
                      />
                      <label htmlFor={`mail-type-${kind}`} className="cursor-pointer">
                        <span className="block text-sm font-medium text-text">
                          {t(kind === 'MARKETING' ? 'mailTypeMarketing' : 'mailTypeTransactional')}
                        </span>
                        <span className="block text-sm text-text-muted">
                          {t(
                            kind === 'MARKETING'
                              ? 'mailTypeMarketingHint'
                              : 'mailTypeTransactionalHint',
                          )}
                        </span>
                      </label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>

              <Field
                label={t('websiteLabel')}
                hint={t('websiteHint')}
                {...(errors['websiteUrl'] === undefined ? {} : { error: errors['websiteUrl'] })}
              >
                <Input
                  data-testid="production-access-website"
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
                />
              </Field>

              <Field
                label={t('contactLabel')}
                hint={t('contactHint')}
                optionalLabel={t('optional')}
              >
                <Input
                  type="email"
                  data-testid="production-access-contact"
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                />
              </Field>
            </>
          )}

          {failure !== null && (
            <Alert tone="error" data-testid="production-access-error">
              {failure}
            </Alert>
          )}
        </div>
      </DialogBody>

      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {submitted ? t('close') : t('cancel')}
          </Button>
        }
        // Po odeslání tu potvrzovací tlačítko NENÍ: druhá žádost během posuzování
        // skončí u Amazonu na 409 a nabízet ji znamená slibovat něco, co nejde.
        confirm={
          submitted ? null : (
            <Button
              variant="primary"
              data-testid="production-access-submit"
              pending={pending}
              pendingLabel={t('submitting')}
              onClick={() => void submit()}
            >
              {t('submit')}
            </Button>
          )
        }
      />
    </Dialog>
  );
}
