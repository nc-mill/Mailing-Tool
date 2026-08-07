'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { FileText, SquarePen } from '@mlain/ui/icons';

/**
 * CO UVIDÍ NÁVŠTĚVNÍK PO JEDNOM KROKU. Trojice voleb z oddílu 2.1 plánu
 * `docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md`.
 *
 * JE TO JEDNA VOLBA, NE TŘI NEZÁVISLÁ POLE, a proto je hodnota rozlišené
 * sjednocení, ne trojice `templateId`, `redirectUrl` a `mode`. Kdyby to byla
 * tři pole vedle sebe, dala by se nastavit vlastní stránka i přesměrování
 * naráz; návštěvník by pak dostal 303 na cizí web a pečlivě navržená stránka
 * by nikdy nikoho nepotkala. Typ tomu brání dřív než obrazovka.
 */
export type PageChoiceValue =
  | { mode: 'default' }
  | { mode: 'page'; templateId: string }
  | { mode: 'redirect'; redirectUrl: string };

export type PageOption = { id: string; name: string };

/** Sentinel „nevybráno". Prázdnou hodnotu si `Select` z radix-ui drží pro sebe. */
const NONE = 'none';

/**
 * Jeden řádek karty „Stránky pro návštěvníka".
 *
 * Řádky se chovají STEJNĚ na formuláři i na seznamu schválně: je to táž otázka
 * („co se ukáže potom") položená na dvou obrazovkách a dvě různá uspořádání by
 * znamenala, že se uživatel musí učit dvakrát totéž.
 */
export function PageChoice({
  name,
  title,
  hint,
  value,
  options,
  canEdit,
  editHref,
  redirectSupported = true,
  creating = false,
  onChange,
  onCreate,
}: {
  /** Prefix pro `id` a `data-testid`, například `form-thanks`. */
  name: string;
  title: string;
  hint?: string;
  value: PageChoiceValue;
  /** Celá knihovna stránek projektu. Výběr je u každého vlastníka zvlášť (0.3 plánu). */
  options: PageOption[];
  canEdit: boolean;
  editHref: (templateId: string) => string;
  /**
   * Dá se z téhle obrazovky nastavit přesměrování? Na formuláři jen u děkovací
   * stránky: přesměrování po potvrzení a pro už přihlášené bydlí na seznamu,
   * protože se na ty stránky chodí z odkazu v e-mailu.
   */
  redirectSupported?: boolean;
  creating?: boolean;
  onChange: (next: PageChoiceValue) => void;
  onCreate: () => void;
}) {
  const t = useTranslations('forms.pages');

  /*
   * Rozepsaná volba se drží LOKÁLNĚ, dokud nedává smysl ji uložit. Přepnutí na
   * „vlastní stránka" bez vybrané stránky a na „přesměrovat" bez adresy nemá co
   * zapsat: uložit v tu chvíli `null` by tiše smazalo předchozí nastavení jen
   * proto, že uživatel klikl na jinou volbu a rozmyslel si to.
   */
  const [mode, setMode] = useState(value.mode);
  const [templateId, setTemplateId] = useState(
    value.mode === 'page' ? value.templateId : (null as string | null),
  );
  const [redirectUrl, setRedirectUrl] = useState(
    value.mode === 'redirect' ? value.redirectUrl : '',
  );
  const [invalid, setInvalid] = useState(false);

  function selectMode(next: PageChoiceValue['mode']) {
    setMode(next);
    setInvalid(false);
    if (next === 'default') {
      onChange({ mode: 'default' });
      return;
    }
    if (next === 'page' && templateId !== null) {
      onChange({ mode: 'page', templateId });
      return;
    }
    if (next === 'redirect' && redirectUrl.trim() !== '') {
      commitRedirect(redirectUrl);
    }
  }

  /**
   * Adresa musí být ABSOLUTNÍ. Uložená hodnota jde rovnou do hlavičky `Location`
   * veřejné trasy, takže „example.com/dekujeme" prohlížeč vyhodnotí vůči NAŠÍ
   * doméně a člověk skončí na naší neexistující stránce. Je to tatáž kontrola
   * jako u přesměrování na detailu seznamu.
   */
  function commitRedirect(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange({ mode: 'redirect', redirectUrl: trimmed });
  }

  /*
   * NEPODPOROVANÁ VOLBA SE NENABÍZÍ VŮBEC, ani zašedle.
   *
   * Formulář má vlastní `redirect_url` právě jednu, pro děkovací stránku; kam
   * poslat člověka po potvrzení a když už přihlášený je, bydlí na SEZNAMU.
   * Původně tu proto zůstávala vypnutá volba s větou, kde se to nastavuje.
   * Zadavatel to 7. 8. 2026 odmítl: „proč je tu možnost, když nejde vybrat,
   * je to matoucí". Má pravdu. Vypnutý ovládací prvek je slib, který obrazovka
   * nesplní, a člověk na něj kliká, než si přečte vysvětlení pod ním.
   *
   * Informace se NEZTRÁCÍ, přesunula se do nápovědy celého kroku (`hint`),
   * kde je čtená jako věta, ne jako nedostupná nabídka.
   */
  const choices = [
    { value: 'default' as const, label: t('modeDefault'), hint: t('modeDefaultHint') },
    { value: 'page' as const, label: t('modePage'), hint: t('modePageHint') },
    ...(redirectSupported
      ? [{ value: 'redirect' as const, label: t('modeRedirect'), hint: t('modeRedirectHint') }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-[var(--spacing-stack)]" data-testid={`${name}-row`}>
      <div className="flex flex-col gap-1.5">
        <span className="text-ui font-semibold text-text">{title}</span>
        {hint === undefined ? null : <span className="text-meta text-text-muted">{hint}</span>}
      </div>

      <RadioGroup
        name={`${name}-mode`}
        value={mode}
        className="gap-[var(--spacing-stack)]"
        onValueChange={(next: string) => selectMode(next as PageChoiceValue['mode'])}
      >
        {choices.map((choice) => (
          <div key={choice.value} className="flex items-start gap-3">
            <RadioGroupItem
              value={choice.value}
              id={`${name}-${choice.value}`}
              aria-labelledby={`${name}-label-${choice.value}`}
              className="mt-1"
              // Vypnutá volba se SCHOVAT nesmí: kdo hledá přesměrování po
              // potvrzení, musí se z obrazovky dozvědět, kde se nastavuje,
              // ne dojít k závěru, že to produkt neumí.
              disabled={!canEdit || (choice.value === 'redirect' && !redirectSupported)}
            />
            <div className="flex flex-col gap-1.5">
              <span
                id={`${name}-label-${choice.value}`}
                className="text-ui font-semibold text-text"
              >
                {choice.label}
              </span>
              <span className="text-meta text-text-muted">{choice.hint}</span>
            </div>
          </div>
        ))}
      </RadioGroup>

      {mode === 'page' ? (
        <div className="flex flex-col gap-[var(--spacing-stack)] pl-7">
          {options.length === 0 ? (
            <p className="text-meta text-text-muted" data-testid={`${name}-empty`}>
              {t('empty')}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5" data-testid={`${name}-select`}>
              <span aria-hidden className="text-sm font-semibold text-text">
                {t('select')}
              </span>
              <Select
                value={templateId ?? NONE}
                onValueChange={(next) => {
                  setTemplateId(next === NONE ? null : next);
                  if (next !== NONE) onChange({ mode: 'page', templateId: next });
                }}
                placeholder={t('selectNone')}
                aria-label={t('select')}
              >
                <SelectItem value={NONE}>{t('selectNone')}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
            {templateId === null ? null : (
              <Link
                href={editHref(templateId)}
                className="inline-flex items-center gap-[var(--spacing-inline)] text-ui"
                data-testid={`${name}-edit`}
              >
                <SquarePen aria-hidden className="icon-sm shrink-0" />
                {t('edit')}
              </Link>
            )}
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                data-testid={`${name}-create`}
                pending={creating}
                pendingLabel={t('creating')}
                onClick={onCreate}
              >
                <FileText aria-hidden className="icon-sm" />
                {t('create')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {mode === 'redirect' ? (
        <div className="pl-7">
          <Field
            label={t('redirectUrl')}
            hint={t('redirectUrlHint')}
            {...(invalid ? { error: t('redirectInvalid') } : {})}
          >
            <Input
              type="url"
              value={redirectUrl}
              placeholder="https://"
              // Adresa se čte po znacích, proto mono. Stejně jako na seznamu.
              className="font-mono"
              data-testid={`${name}-redirect`}
              disabled={!canEdit}
              onChange={(event) => setRedirectUrl(event.target.value)}
              onBlur={() => commitRedirect(redirectUrl)}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Uložený stav na volbu. Přednost má PŘESMĚROVÁNÍ: kdyby v datech bylo obojí
 * (třeba ze staršího nastavení přes API), návštěvník skončí na cizí adrese
 * a obrazovka to musí říct pravdivě, ne ukázat stránku, kterou nikdo neuvidí.
 */
export function pageChoiceOf(input: {
  templateId: string | null;
  redirectUrl: string | null;
}): PageChoiceValue {
  if (input.redirectUrl !== null && input.redirectUrl !== '') {
    return { mode: 'redirect', redirectUrl: input.redirectUrl };
  }
  if (input.templateId !== null) return { mode: 'page', templateId: input.templateId };
  return { mode: 'default' };
}
